import { beforeAll, describe, expect, it, vi } from 'vitest'
import fixture from './fixtures/providers/claude/2026-08-24-normal.json'
import { extractClaudeDisplayArtifact } from '../src/lib/claude-artifact'
import { conversationToHtml } from '../src/lib/export-html'
import { conversationToMarkdown } from '../src/lib/export-markdown'
import type { Conversation, ExportOptions } from '../src/lib/types'
let ClaudeParser: typeof import('../src/contents/claude-parser').ClaudeParser
beforeAll(async () => {
  vi.stubGlobal('chrome', { storage: { local: { get: vi.fn(async () => ({})), set: vi.fn() } }, runtime: { onMessage: { addListener: vi.fn() } } })
  ;({ ClaudeParser } = await import('../src/contents/claude-parser'))
})
const options: ExportOptions = { format: 'markdown', includeMetadata: false, includeCodeBlocks: true, includeImages: false, exportArtifacts: true }
describe('Claude display-source artifacts', () => {
  it('retains captured real display source blocks in the selected branch', async () => {
    document.body.innerHTML = '<script>https://claude.ai/api/organizations/11111111-1111-4111-8111-111111111111/chat_conversations</script>'
    let count = 0
    for (const detail of (fixture as any).payload.raw.details) {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => detail })))
      const conversation = await new ClaudeParser().fetchConversationDetail(detail.uuid)
      expect(conversation?.verification?.transcript.verified).toBe(true)
      const expected = detail.chat_messages.flatMap((message: any) => (message.content || []).map(extractClaudeDisplayArtifact).filter(Boolean))
      count += conversation?.artifacts?.filter(a => a.title?.startsWith('Displayed ')).length || 0
      // The provider fixture currently has one branch; expected payloads must
      // survive extraction, not be executed or flattened into chat text.
      for (const artifact of expected) expect(conversation?.artifacts).toContainEqual(artifact)
    }
    expect(count).toBeGreaterThan(0)
  })
  it('keeps active HTML as readable escaped source in preview/PDF and Markdown', () => {
    const content = '<script>window.syntheticExecution = true</script><h1>Artifact</h1>'
    const artifact = extractClaudeDisplayArtifact({ type: 'tool_result', display_content: { type: 'json_block', json_block: JSON.stringify({ language: 'html', code: content }) } })!
    const conversation: Conversation = { id: 'synthetic', title: 'Artifact', platform: 'claude', url: '', messages: [{ id: 'm', role: 'assistant', content: 'Source follows.' }], artifacts: [artifact] }
    const html = conversationToHtml(conversation, options)
    expect(new DOMParser().parseFromString(html, 'text/html').querySelector('script')).toBeNull()
    expect(html).toContain('&lt;script&gt;')
    expect(conversationToMarkdown(conversation, options)).toContain(content)
  })
})
