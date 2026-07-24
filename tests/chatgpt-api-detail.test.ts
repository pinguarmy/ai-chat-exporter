import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
type ChatGPTParserConstructor = typeof import('../src/contents/chatgpt-parser').ChatGPTParser

const storage: Record<string, unknown> = {}
const mockChrome = {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[]) => {
        const requested = Array.isArray(keys) ? keys : [keys]
        return Object.fromEntries(requested.map(key => [key, storage[key]]))
      }),
      set: vi.fn(async (items: Record<string, unknown>) => Object.assign(storage, items)),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key]
      })
    }
  },
  runtime: { onMessage: { addListener: vi.fn() } }
}

let ChatGPTParser: ChatGPTParserConstructor

function response(status: number, data: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => data
  }
}

describe('ChatGPT API detail parser', () => {
  beforeAll(async () => {
    vi.stubGlobal('chrome', mockChrome)
    ;({ ChatGPTParser } = await import('../src/contents/chatgpt-parser'))
  })

  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(storage)) delete storage[key]
  })

  it('refreshes an expired list token before retrying the API request', async () => {
    storage.chatGPTAccessToken = 'expired-token'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(401, {}))
      .mockResolvedValueOnce(response(200, { accessToken: 'fresh-token' }))
      .mockResolvedValueOnce(response(200, { items: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(new ChatGPTParser().fetchAllConversations()).resolves.toEqual([])

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer expired-token')
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer fresh-token')
  })

  it('retries a detail request with a refreshed token and exports only the active branch', async () => {
    storage.chatGPTAccessToken = 'expired-token'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(401, {}))
      .mockResolvedValueOnce(response(200, { accessToken: 'fresh-token' }))
      .mockResolvedValueOnce(response(200, {
        id: 'conversation-id',
        title: 'A branched chat',
        current_node: 'active-answer',
        mapping: {
          root: { parent: null, children: ['user-question'] },
          'user-question': {
            parent: 'root',
            children: ['abandoned-answer', 'active-answer'],
            message: {
              id: 'user-question',
              author: { role: 'user' },
              content: { parts: ['Which answer is current?'] }
            }
          },
          'abandoned-answer': {
            parent: 'user-question',
            children: [],
            message: {
              id: 'abandoned-answer',
              author: { role: 'assistant' },
              content: { parts: ['This regenerated answer must not be exported.'] }
            }
          },
          'active-answer': {
            parent: 'user-question',
            children: [],
            message: {
              id: 'active-answer',
              author: { role: 'assistant' },
              content: { parts: ['This is the active answer.'] }
            }
          }
        }
      }))
    vi.stubGlobal('fetch', fetchMock)

    const conversation = await new ChatGPTParser().fetchConversationDetail('conversation-id')

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer expired-token')
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer fresh-token')
    expect(conversation?.messages.map(message => [message.role, message.content])).toEqual([
      ['user', 'Which answer is current?'],
      ['assistant', 'This is the active answer.']
    ])
  })
})
