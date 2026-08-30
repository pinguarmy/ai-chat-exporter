import { describe, expect, it } from 'vitest'
import {
  claudeElementToMarkdown,
  extractClaudeMessageMarkdown
} from '../src/lib/claude-rich-text'

describe('Claude rich text extraction', () => {
  it('converts semantic answer HTML to structured Markdown', () => {
    document.body.innerHTML = `
      <div id="answer">
        <h2>Visual overhaul:</h2>
        <p>Keep the <strong>important</strong> details and <em>spacing</em>.</p>
        <ul>
          <li>First item</li>
          <li>Second item</li>
        </ul>
        <blockquote><p>A quoted note</p></blockquote>
        <p>Use <code>npm test</code> before shipping.</p>
        <pre><code class="language-ts">const answer = 42\nconsole.log(answer)</code></pre>
        <button class="copy-action">Copy</button>
      </div>
    `

    const markdown = claudeElementToMarkdown(document.querySelector('#answer')!)

    expect(markdown).toContain('## Visual overhaul:')
    expect(markdown).toContain('Keep the **important** details and *spacing*.')
    expect(markdown).toContain('- First item\n- Second item')
    expect(markdown).toContain('> A quoted note')
    expect(markdown).toContain('Use `npm test` before shipping.')
    expect(markdown).toContain('```ts\nconst answer = 42\nconsole.log(answer)\n```')
    expect(markdown).not.toContain('Copy')
  })

  it('preserves tables, links, nested lists, and safe link filtering', () => {
    document.body.innerHTML = `
      <div id="answer">
        <ol>
          <li>Parent<ul><li>Child</li></ul></li>
        </ol>
        <table>
          <thead><tr><th>Item</th><th>State</th></tr></thead>
          <tbody><tr><td>Export</td><td>Ready</td></tr></tbody>
        </table>
        <p><a href="https://example.com/docs">Docs</a> <a href="javascript:alert(1)">unsafe</a></p>
      </div>
    `

    const markdown = claudeElementToMarkdown(document.querySelector('#answer')!)

    expect(markdown).toContain('1. Parent\n  - Child')
    expect(markdown).toContain('| Item | State |\n| --- | --- |\n| Export | Ready |')
    expect(markdown).toContain('[Docs](https://example.com/docs) unsafe')
    expect(markdown).not.toContain('javascript:')
  })

  it('keeps rendered images inline instead of discarding them from the transcript', () => {
    document.body.innerHTML = `
      <div id="answer">
        <p>Before chart.</p>
        <img data-original="https://images.example/chart-full.png" src="placeholder.png" alt="Benchmark chart" />
        <p>After chart.</p>
      </div>
    `

    const markdown = claudeElementToMarkdown(document.querySelector('#answer')!)

    expect(markdown).toContain('![Benchmark chart](https://images.example/chart-full.png)')
    expect(markdown.indexOf('Before chart.')).toBeLessThan(markdown.indexOf('![Benchmark chart]'))
    expect(markdown.indexOf('![Benchmark chart]')).toBeLessThan(markdown.indexOf('After chart.'))
  })

  it('does not duplicate Claude API text when both content blocks and top-level text exist', () => {
    const markdown = extractClaudeMessageMarkdown({
      uuid: 'msg-segmented',
      sender: 'assistant',
      text: 'Section 1\n\nSection 2',
      content: [
        { type: 'text', text: 'Section 1' },
        { type: 'thinking', thinking: 'internal note' },
        { type: 'text', text: 'Section 2' },
      ],
    })
    expect(markdown).toBe('Section 1\n\nSection 2')
  })

  it('keeps visible API Markdown while excluding thinking and tool blocks', () => {
    const markdown = extractClaudeMessageMarkdown({
      uuid: 'assistant-1',
      sender: 'assistant',
      content: [
        { type: 'thinking', thinking: 'internal reasoning must not be exported' },
        { type: 'text', text: '## Visual overhaul:\n\n- Preserve this list\n\n```ts\nconst ready = true\n```' },
        { type: 'tool_use', name: 'computer', input: { content: 'Ran 3 commands' } }
      ]
    })

    expect(markdown).toBe('## Visual overhaul:\n\n- Preserve this list\n\n```ts\nconst ready = true\n```')
    expect(markdown).not.toContain('internal reasoning')
    expect(markdown).not.toContain('Ran 3 commands')
  })

  it('supports nested message content objects used by API variants', () => {
    expect(extractClaudeMessageMarkdown({
      role: 'user',
      message: { content: { parts: [{ text: 'Please keep the paragraphs.' }] } }
    })).toBe('Please keep the paragraphs.')
  })
})
