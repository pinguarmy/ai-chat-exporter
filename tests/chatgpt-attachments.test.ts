import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type ChatGPTParserConstructor = typeof import('../src/contents/chatgpt-parser').ChatGPTParser

let ChatGPTParser: ChatGPTParserConstructor

describe('ChatGPT attachment completeness', () => {
  beforeAll(async () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => {}),
          remove: vi.fn(async () => {})
        }
      },
      runtime: {
        onMessage: { addListener: vi.fn() }
      }
    })

    ;({ ChatGPTParser } = await import('../src/contents/chatgpt-parser'))
  })

  beforeEach(() => {
    document.body.innerHTML = ''
    document.title = ''
  })

  it('retains a file-only user turn from the conversation API', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ accessToken: 'test-token' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'conversation-1',
          current_node: 'user-file',
          mapping: {
            'user-file': {
              id: 'user-file',
              parent: null,
              children: [],
              message: {
                id: 'user-file',
                author: { role: 'user' },
                content: {
                  parts: [{ type: 'file', name: 'brief.pdf', file: { url: 'https://files.example/brief.pdf' } }]
                }
              }
            }
          }
        })
      }))

    const conversation = await new ChatGPTParser().fetchConversationDetail('conversation-1')

    expect(conversation?.messages).toHaveLength(1)
    expect(conversation?.messages[0]).toMatchObject({
      role: 'user',
      content: '',
      attachments: [{
        type: 'file',
        name: 'brief.pdf',
        url: 'https://files.example/brief.pdf',
        uploaded: true
      }]
    })
  })

  it('treats ChatGPT image_file parts as images, not uploaded files', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ accessToken: 'test-token' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'conversation-image-file',
          current_node: 'user-image',
          mapping: {
            'user-image': {
              id: 'user-image',
              parent: null,
              children: [],
              message: {
                id: 'user-image',
                author: { role: 'user' },
                content: {
                  parts: [{ type: 'image_file', name: 'photo.png', file: { url: 'https://images.example/photo.png' } }]
                }
              }
            }
          }
        })
      }))

    const conversation = await new ChatGPTParser().fetchConversationDetail('conversation-image-file')

    expect(conversation?.messages[0]?.attachments).toEqual([
      expect.objectContaining({
        type: 'image',
        url: 'https://images.example/photo.png',
        uploaded: true,
      }),
    ])
  })

  it('retains an image-only assistant turn without marking it as a user upload', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ accessToken: 'test-token' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'conversation-2',
          current_node: 'assistant-image',
          mapping: {
            'assistant-image': {
              id: 'assistant-image',
              parent: null,
              children: [],
              message: {
                id: 'assistant-image',
                author: { role: 'assistant' },
                content: {
                  parts: [{ type: 'image_url', image_url: { url: 'https://images.example/generated.png' } }]
                }
              }
            }
          }
        })
      }))

    const conversation = await new ChatGPTParser().fetchConversationDetail('conversation-2')

    expect(conversation?.messages).toHaveLength(1)
    expect(conversation?.messages[0]).toMatchObject({
      role: 'assistant',
      content: '',
      attachments: [{
        type: 'image',
        url: 'https://images.example/generated.png',
        uploaded: false
      }]
    })
  })

  it('maps rendered image attachments from the normalized message role', async () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="user" data-message-id="user-image">
          <div class="content">My reference<img src="https://images.example/reference.png" alt="Reference"></div>
        </div>
        <div data-message-author-role="assistant" data-message-id="assistant-image">
          <div class="content">Generated result<img src="https://images.example/result.png" alt="Result"></div>
        </div>
      </main>
    `

    const conversation = await new ChatGPTParser().parseCurrentConversation()

    expect(conversation?.messages[0].attachments?.[0]).toMatchObject({
      url: 'https://images.example/reference.png',
      uploaded: true
    })
    expect(conversation?.messages[1].attachments?.[0]).toMatchObject({
      url: 'https://images.example/result.png',
      uploaded: false
    })
  })
})
