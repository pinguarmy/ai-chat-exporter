import { beforeAll, describe, expect, it, vi } from 'vitest'
import chatgptFixture from '../../fixtures/providers/chatgpt/2026-08-24-normal.json'
import { conversationToHtml } from '../../../src/core/export-html'
import { conversationToMarkdown } from '../../../src/core/export-markdown'
import { mergeRenderedImageAttachments } from '../../../src/providers/parser-fallback'
import type { Conversation, ExportOptions } from '../../../src/core/types'

let ChatGPTParser: typeof import('../../../src/contents/chatgpt-parser').ChatGPTParser
const options = { includeCodeBlocks: true, includeImages: true, includeMetadata: false } as ExportOptions
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

beforeAll(async () => {
  vi.stubGlobal('chrome', { storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(), remove: vi.fn() } }, runtime: { onMessage: { addListener: vi.fn() } } })
  ;({ ChatGPTParser } = await import('../../../src/contents/chatgpt-parser'))
})

async function parseParts(parts: unknown[], role = 'user') {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ok(String(url).includes('/api/auth/session')
    ? { accessToken: 'test-token' }
    : { id: 'synthetic', current_node: 'image-turn', mapping: { 'image-turn': { parent: null, message: { id: 'image-turn', author: { role }, content: { parts } } } } })))
  return (await new ChatGPTParser().fetchConversationDetail('synthetic'))!
}

function documentFor(conversation: Conversation) {
  return new DOMParser().parseFromString(conversationToHtml(conversation, options), 'text/html')
}

describe('export content regressions', () => {
  it.each([
    ['python', 'def greet():\n    if True:\n        print("hello")\n    return 1'],
    ['yaml', 'parent:\n    child:\n        - value'],
    ['make', 'build:\n\tprintf "two  spaces"\n\n\n\tprintf done'],
  ])('preserves exact fenced %s whitespace in HTML used by PDF', (language, code) => {
    const conversation: Conversation = { id: 'code', title: 'Code', url: 'https://example.com', platform: 'claude', messages: [{ id: 'answer', role: 'assistant', content: `\`\`\`${language}\n${code}\n\`\`\`` }] }
    expect(documentFor(conversation).querySelector('pre code')?.textContent).toBe(code)
    expect(conversationToMarkdown(conversation, options)).toContain(code)
  })

  it('retains all seven active-branch image parts from the real sanitized ChatGPT capture', async () => {
    let pointerCount = 0
    for (const detail of (chatgptFixture as any).payload.details) {
      vi.stubGlobal('fetch', vi.fn(async (url: string) => ok(String(url).includes('/api/auth/session') ? { accessToken: 'test-token' } : detail)))
      const parsed = await new ChatGPTParser().fetchConversationDetail(detail.conversation_id)
      expect(parsed?.verification?.transcript.verified).toBe(true)
      let id = detail.current_node
      const visited = new Set<string>()
      while (id && !visited.has(id)) {
        visited.add(id)
        const node = detail.mapping[id]
        if (!node) break
        const message = node.message
        if (message && ['user', 'assistant'].includes(message.author?.role) && !message.metadata?.is_visually_hidden_from_conversation && (!message.recipient || message.recipient === 'all')) {
          const pointers = (message.content?.parts || []).filter((part: any) => part?.content_type === 'image_asset_pointer')
          if (pointers.length) {
            pointerCount += pointers.length
            const output = parsed?.messages.find(turn => turn.id === message.id)
            expect(output?.attachments?.filter(a => a.type === 'image')).toHaveLength(pointers.length)
            expect(output?.attachments?.every(a => a.url === '')).toBe(true)
          }
        }
        id = node.parent
      }
      expect(JSON.stringify(parsed?.messages)).not.toContain('sediment://')
      expect(conversationToHtml(parsed!, options)).not.toContain('sediment://')
    }
    expect(pointerCount).toBe(7)
  })

  it.each(['user', 'assistant'])('retains an image-only %s turn without disclosing or fetching its asset handle', async role => {
    const parsed = await parseParts([{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://private-file', name: 'Reference image' }], role)
    expect(parsed.messages).toHaveLength(1)
    expect(parsed.messages[0]).toMatchObject({ content: '', attachments: [{ type: 'image', name: 'Reference image', url: '', uploaded: role === 'user' }] })
    const doc = documentFor(parsed)
    expect(doc.querySelector('img')).toBeNull()
    expect(doc.body.textContent).toContain('Reference image (image unavailable)')
    expect(JSON.stringify(parsed.messages)).not.toContain('private-file')
    expect(conversationToHtml(parsed, options)).not.toContain('private-file')
    expect(vi.mocked(fetch).mock.calls.map(call => String(call[0])).some(url => url.includes('sediment:'))).toBe(false)
  })

  it.each(['sediment://private-file', 'javascript:alert(1)', 'https://user:secret@example.com/image.png'])('does not treat an unsafe pointer URL as a renderable image: %s', async url => {
    const parsed = await parseParts([{ content_type: 'image_asset_pointer', url, asset_pointer: 'sediment://private-file' }])
    expect(parsed.messages[0].attachments?.[0].url).toBe('')
    expect(documentFor(parsed).querySelector('img')).toBeNull()
  })

  it('honors the image toggle for unresolved image placeholders', async () => {
    const parsed = await parseParts([{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://private-file' }])
    const html = conversationToHtml(parsed, { ...options, includeImages: false })
    expect(html).not.toContain('image unavailable')
    expect(new DOMParser().parseFromString(html, 'text/html').querySelector('img')).toBeNull()
  })

  it('does not borrow a DOM image from a different image-only turn', async () => {
    const parsed = await parseParts([{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://private-file' }])
    const rendered: Conversation = { ...parsed, messages: [{ id: 'different-turn', role: 'user', content: '', attachments: [{ type: 'image', url: 'https://images.example/unrelated.png' }] }] }
    const merged = mergeRenderedImageAttachments(parsed, rendered)!
    expect(documentFor(merged).querySelector('img')).toBeNull()
    expect(documentFor(merged).body.textContent).toContain('image unavailable')
  })

  it('renders an explicit HTTP(S) pointer image URL without rendering the private handle', async () => {
    const parsed = await parseParts([{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://private-file', image_url: { url: 'https://images.example/photo.png' } }])
    expect(documentFor(parsed).querySelector('img')?.getAttribute('src')).toBe('https://images.example/photo.png')
    expect(conversationToHtml(parsed, options)).not.toContain('sediment:')
  })

  it('keeps existing image_file and image_url paths working', async () => {
    const parsed = await parseParts([
      { type: 'image_file', name: 'File image', file: { url: 'https://images.example/one.png' } },
      { type: 'image_url', image_url: { url: 'https://images.example/two.png' } },
    ])
    expect([...documentFor(parsed).querySelectorAll('img')].map(image => image.getAttribute('src'))).toEqual(['https://images.example/one.png', 'https://images.example/two.png'])
  })

  it('keeps unmatched image slots when DOM enriches only part of a multi-image turn', async () => {
    const parsed = await parseParts([
      { content_type: 'image_asset_pointer', asset_pointer: 'sediment://first' },
      { content_type: 'image_asset_pointer', asset_pointer: 'sediment://second' },
    ])
    const rendered: Conversation = { ...parsed, messages: [{ id: 'image-turn', role: 'user', content: '', attachments: [{ type: 'image', url: 'https://images.example/one.png', name: 'Image', uploaded: true }] }] }
    const merged = mergeRenderedImageAttachments(parsed, rendered)!
    expect(merged.messages[0].attachments).toHaveLength(2)
    expect(documentFor(merged).querySelectorAll('img')).toHaveLength(1)
    expect(documentFor(merged).querySelectorAll('.attachments')).toHaveLength(1)
    const repeated = mergeRenderedImageAttachments(merged, rendered)!
    expect(repeated.messages[0].attachments).toEqual(merged.messages[0].attachments)
  })

  it('allows a confidently ID-matched DOM image to enrich an image-only turn', async () => {
    const parsed = await parseParts([{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://private-file' }])
    const rendered: Conversation = { ...parsed, messages: [{ id: 'image-turn', role: 'user', content: '', attachments: [{ type: 'image', url: 'https://images.example/resolved.png', name: 'Image', uploaded: true }] }] }
    const merged = mergeRenderedImageAttachments(parsed, rendered)!
    expect(documentFor(merged).querySelectorAll('img')).toHaveLength(1)
    expect(documentFor(merged).querySelector('img')?.getAttribute('src')).toBe('https://images.example/resolved.png')
    // The shared merge path should replace the unresolved slot, not display
    // the same provider image once as a placeholder and once as a DOM image.
    expect(documentFor(merged).body.textContent).not.toContain('image unavailable')
  })
})
