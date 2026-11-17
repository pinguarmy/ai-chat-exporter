// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { conversationToMarkdown } from '../../../src/core/export-markdown'
import { conversationToHtml } from '../../../src/core/export-html'
import type { ExportOptions } from '../../../src/core/types'

let ClaudeParser: typeof import('../../../src/contents/claude-parser').ClaudeParser
const options = {
  includeMetadata: true,
  includeUploadedFiles: true,
  exportArtifacts: true,
  exportedAt: 0
} as ExportOptions

// Synthetic reproduction of the redacted message shape supplied in issue #25.
function detail() {
  return {
    uuid: 'attachment-conversation',
    current_leaf_message_uuid: 'a2',
    chat_messages: [
      {
        uuid: 'u1',
        sender: 'human',
        content: [{ type: 'text', text: 'Review these files' }],
        attachments: [
          {
            id: 'file-1',
            file_name: 'notes.md',
            file_type: 'text/markdown',
            extracted_content: '# Uploaded notes'
          }
        ]
      },
      { uuid: 'a1', parent_message_uuid: 'u1', sender: 'assistant', text: 'First reply' },
      {
        uuid: 'u2',
        parent_message_uuid: 'a1',
        sender: 'human',
        content: [{ type: 'text', text: '' }],
        attachments: [
          {
            id: 'file-2',
            file_name: 'README-213.txt',
            file_type: 'text/plain',
            extracted_content: 'Uploaded text body'
          },
          { id: 'file-3', file_name: 'empty.txt', file_type: 'text/plain' },
          null
        ]
      },
      { uuid: 'a2', parent_message_uuid: 'u2', sender: 'assistant', text: 'Second reply' }
    ]
  }
}

beforeAll(async () => {
  vi.stubGlobal('chrome', {
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn() } },
    runtime: { onMessage: { addListener: vi.fn() } }
  })
  ;({ ClaudeParser } = await import('../../../src/contents/claude-parser'))
})

beforeEach(() => {
  document.body.innerHTML =
    '<script>https://claude.ai/api/organizations/11111111-1111-4111-8111-111111111111/chat_conversations</script>'
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('/chat_conversations/attachment-conversation')
        ? { ok: true, status: 200, json: async () => detail() }
        : { ok: false, status: 404, json: async () => ({}) }
    )
  )
})

describe('Claude uploaded text attachments (issue #25)', () => {
  it('retains message order, per-turn filenames, extracted content, and metadata-only files', async () => {
    const conversation = await new ClaudeParser().fetchConversationDetail('attachment-conversation')
    expect(conversation?.messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
    expect(conversation?.messages[2]).toMatchObject({
      role: 'user',
      content: '',
      attachments: [
        { type: 'file', name: 'README-213.txt', url: '', uploaded: true },
        { type: 'file', name: 'empty.txt', url: '', uploaded: true }
      ]
    })
    expect(conversation?.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'document',
          title: 'README-213.txt',
          content: 'Uploaded text body',
          mimeType: 'text/plain',
          uploaded: true
        })
      ])
    )
    const markdown = conversationToMarkdown(conversation!, options)
    expect(markdown).toContain('**Visible messages:** 4')
    expect(markdown.indexOf('notes.md')).toBeLessThan(markdown.indexOf('First reply'))
    expect(markdown.indexOf('README-213.txt')).toBeGreaterThan(markdown.indexOf('First reply'))
    expect(markdown.indexOf('README-213.txt')).toBeLessThan(markdown.indexOf('Second reply'))
    expect(markdown).toContain('empty.txt')
    expect(markdown).toContain('Uploaded text body')
    await expect(markdown).toMatchFileSnapshot(
      '../../fixtures/exports/claude-uploaded-attachments.md'
    )
    const html = conversationToHtml(conversation!, options)
    expect(html).toContain('README-213.txt')
    expect(html).toContain('Uploaded text body')
    expect(html.indexOf('README-213.txt')).toBeLessThan(html.indexOf('Second reply'))
  })

  it('honors upload exclusion without losing the user turn or typed text', async () => {
    const conversation = await new ClaudeParser().fetchConversationDetail('attachment-conversation')
    for (const render of [conversationToMarkdown, conversationToHtml]) {
      const output = render(conversation!, { ...options, includeUploadedFiles: false })
      expect(output).toContain('Review these files')
      expect(output).not.toContain('README-213.txt')
      expect(output).not.toContain('notes.md')
      expect(output).not.toContain('Uploaded text body')
    }
    expect(conversation?.messages).toHaveLength(4)
  })
})
