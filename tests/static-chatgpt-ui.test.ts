import { describe, it, expect } from 'vitest'
import { conversationToHtml, formatHtmlContent } from '../src/lib/export-html'
import { preparePreviewMessage } from '../src/lib/preview-message'
import { renderStaticChatGptUi } from '../src/lib/static-chatgpt-ui'
import type { Conversation } from '../src/lib/types'

export const cards = `<grid columns={3} gap={2}>
<grid-item>
<box background="surface-secondary" radius="lg" padding={3} gap={1}>
<caption>DSH 版本</caption>
<title size="lg" color="default">0.2.1-rc.2</title>
</box>
</grid-item>
<grid-item>
<box background="surface-secondary" radius="lg" padding={3} gap={1}>
<caption>当前服务连续运行</caption>
<title size="lg" color="default">约 16 小时</title>
</box>
</grid-item>
<grid-item>
<box background="surface-secondary" radius="lg" padding={3} gap={1}>
<caption>进程实际内存 RSS</caption>
<title size="lg" color="default">约 604 MiB</title>
</box>
</grid-item>
</grid>`
const conversation: Conversation = {
  id: 'ui-example', title: 'Static UI example', platform: 'chatgpt', url: 'https://example.invalid/',
  messages: [{ id: 'a', role: 'assistant', content: cards }],
}
const options = { format: 'pdf' as const, includeMetadata: false, includeCodeBlocks: true, includeImages: false }
function dom(html: string): HTMLDivElement {
  const root = document.createElement('div'); root.innerHTML = html; return root
}

describe('ChatGPT static card export', () => {
  it('reproduces the old literal markup without the explicit provider opt-in', () => {
    expect(dom(formatHtmlContent(cards)).textContent).toContain('<grid columns={3}')
  })
  it('renders three inert cards in ChatGPT assistant PDF HTML', () => {
    const root = dom(conversationToHtml(conversation, options))
    expect(root.querySelectorAll('.ace-static-ui-grid-item')).toHaveLength(3)
    expect(root.querySelector('.content')?.textContent).not.toContain('<grid')
    expect(root.querySelector('.content')?.textContent).toContain('约 604 MiB')
    expect(root.querySelector('.ace-static-ui-grid')?.getAttribute('style')).toContain('display:flex')
    expect(root.querySelectorAll('grid, box, title').length).toBe(1) // document title only
  })
  it('uses the same renderer in preview', () => {
    const prepared = preparePreviewMessage(conversation.messages[0], { platform: 'chatgpt' })
    expect(dom(prepared.contentHtml).querySelectorAll('.ace-static-ui-grid-item')).toHaveLength(3)
  })
  it('keeps user messages, other providers, inline code and code examples verbatim', () => {
    for (const conv of [
      { ...conversation, platform: 'claude' as const },
      { ...conversation, messages: [{ ...conversation.messages[0], role: 'user' as const }] },
      { ...conversation, messages: [{ ...conversation.messages[0], content: '```jsx\n' + cards + '\n```' }] },
      { ...conversation, messages: [{ ...conversation.messages[0], content: '```chatgpt interactive UI\n' + cards + '\n```' }] },
      { ...conversation, messages: [{ ...conversation.messages[0], content: '`<grid columns={3}>`' }] },
      { ...conversation, messages: [{ ...conversation.messages[0], content: '```text\n```not a closing fence\n' + cards + '\n```' }] },
      { ...conversation, messages: [{ ...conversation.messages[0], content: '`\n' + cards + '\n`' }] },
      { ...conversation, messages: [{ ...conversation.messages[0], content: 'Before\n\n    <box><caption>Indented code example</caption></box>' }] },
    ]) expect(dom(conversationToHtml(conv, options)).querySelector('.ace-static-ui')).toBeNull()
  })
  it('renders a complete grid but preserves the supplied orphan closing box as readable source', () => {
    const content = cards + '\n</box>'
    const root = dom(conversationToHtml({ ...conversation, messages: [{ ...conversation.messages[0], content }] }, options))
    expect(root.querySelectorAll('.ace-static-ui-grid-item')).toHaveLength(3)
    expect(root.querySelector('.content')?.textContent).toContain('</box>')
  })
  it('renders supported layouts even when code export is disabled and preserves surrounding Markdown', () => {
    const content = '## Before\n\n' + cards + '\n\nAfter $x^2$'
    const root = dom(conversationToHtml({ ...conversation, messages: [{ ...conversation.messages[0], content }] }, { ...options, includeCodeBlocks: false }))
    expect(root.querySelector('h2')?.textContent).toBe('Before')
    expect(root.querySelectorAll('.ace-static-ui-grid-item')).toHaveLength(3)
    expect(root.querySelector('math')).not.toBeNull()
  })
})

describe('strict static layout grammar', () => {
  it.each([
    '<box onclick="alert(1)"><caption>x</caption></box>',
    '<box style="background:url(https://evil.invalid)"><caption>x</caption></box>',
    '<box {...props}><caption>x</caption></box>',
    '<grid columns={alert(1)}><grid-item></grid-item></grid>',
    '<grid columns={99}><grid-item></grid-item></grid>',
    '<box><script>alert(1)</script></box>',
    '<box><caption>{fetch("https://evil.invalid")}</caption></box>',
    '<box><title size="lg" size="sm">x</title></box>',
    '<box><caption>x</box></caption>',
    '<box><img src="https://evil.invalid"></box>',
    '<box><grid-item></grid-item></box>',
  ])('rejects unsupported syntax without executing or dropping it: %s', source => {
    expect(renderStaticChatGptUi(source)).toBeNull()
  })
  it('escapes entity-looking text and produces no active HTML', () => {
    const root = dom(renderStaticChatGptUi('<box><caption>&lt;img src=x onerror=alert(1)&gt;</caption></box>')!)
    expect(root.querySelector('img')).toBeNull()
    expect(root.textContent).toContain('&lt;img')
  })
  it('keeps rejected block text literal without Markdown image requests or source loss', () => {
    const source = '<box unknown="x"><caption>**literal** ![tracking](https://example.invalid/tracker.png) ![LOST](javascript:alert)</caption></box>'
    const root = dom(formatHtmlContent(source, true))
    expect(root.querySelector('img')).toBeNull()
    expect(root.textContent).toBe(source)
  })
  it('rejects many unmatched opening brackets in bounded time', () => {
    const start = performance.now()
    expect(renderStaticChatGptUi('<box>' + '<'.repeat(63_000))).toBeNull()
    expect(performance.now() - start).toBeLessThan(500)
  })
  it('limits parser input size and depth', () => {
    expect(renderStaticChatGptUi('<box>'.repeat(30) + '</box>'.repeat(30))).toBeNull()
    expect(renderStaticChatGptUi('<box><caption>' + 'a'.repeat(65_000) + '</caption></box>')).toBeNull()
  })
})
