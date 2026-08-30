import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { isConversationExportable } from '../src/lib/conversation-integrity'
import { ProviderRateLimitError } from '../src/lib/provider-rate-limit'
type ChatGPTParserConstructor = typeof import('../src/contents/chatgpt-parser').ChatGPTParser
type ResolveChatGptActiveBranch = typeof import('../src/contents/chatgpt-parser').resolveChatGptActiveBranch

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
let resolveChatGptActiveBranch: ResolveChatGptActiveBranch
let runtimeListener: (message: any, sender: any, sendResponse: (response: any) => void) => boolean | void

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
    ;({ ChatGPTParser, resolveChatGptActiveBranch } = await import('../src/contents/chatgpt-parser'))
    runtimeListener = mockChrome.runtime.onMessage.addListener.mock.calls.at(-1)?.[0]
  })

  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(storage)) delete storage[key]
    document.body.innerHTML = ''
    window.history.replaceState({}, '', '/')
  })

  it('refreshes an expired list token before retrying the API request', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, { accessToken: 'expired-token' }))
      .mockResolvedValueOnce(response(401, {}))
      .mockResolvedValueOnce(response(200, { accessToken: 'fresh-token' }))
      .mockResolvedValueOnce(response(200, { items: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(new ChatGPTParser().fetchAllConversations()).resolves.toEqual([])

    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer expired-token')
    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe('Bearer fresh-token')
    expect(mockChrome.storage.local.get).not.toHaveBeenCalled()
    expect(mockChrome.storage.local.set).not.toHaveBeenCalled()
  })

  it('labels a later-page list failure as incomplete and falls back to the sidebar', async () => {
    const apiItems = Array.from({ length: 100 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      title: `API conversation ${index}`
    }))
    document.body.innerHTML = `
      <nav><a href="/c/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb">Visible fallback</a></nav>
    `
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(200, { accessToken: 'token' }))
      .mockResolvedValueOnce(response(200, { items: apiItems }))
      .mockResolvedValueOnce(response(500, {})))

    const parser = new ChatGPTParser()
    const conversations = await parser.fetchAllConversations()

    expect(conversations).toEqual([
      expect.objectContaining({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        title: 'Visible fallback'
      })
    ])
    expect(parser.getConversationListMeta()).toEqual({ source: 'sidebar', complete: false })
  })

  it('retries a detail request with a refreshed token and exports only the active branch', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, { accessToken: 'expired-token' }))
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

    const conversation = await new ChatGPTParser('https://chat.openai.com')
      .fetchConversationDetail('conversation-id')

    expect(fetchMock.mock.calls[0][0]).toBe('https://chat.openai.com/api/auth/session')
    expect(fetchMock.mock.calls[1][0]).toBe('https://chat.openai.com/backend-api/conversation/conversation-id')
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ credentials: 'include' })
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer expired-token')
    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe('Bearer fresh-token')
    expect(conversation?.url).toBe('https://chat.openai.com/c/conversation-id')
    expect(conversation?.messages.map(message => [message.role, message.content])).toEqual([
      ['user', 'Which answer is current?'],
      ['assistant', 'This is the active answer.']
    ])
    expect(conversation).toMatchObject({
      source: 'api',
      sourceCompleteness: 'verified',
      verification: {
        provider: 'chatgpt',
        source: 'api',
        transcript: {
          verified: true,
          method: 'active-branch-root-chain',
          reasons: ['active_branch_root_chain'],
        },
      },
    })
  })

  it('excludes ChatGPT assistant checkpoints hidden from the visible conversation', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(200, { accessToken: 'token' }))
      .mockResolvedValueOnce(response(200, {
        id: 'conversation-id',
        current_node: 'answer',
        mapping: {
          root: { parent: null, children: ['question'] },
          question: {
            parent: 'root',
            children: ['checkpoint'],
            message: { id: 'question', author: { role: 'user' }, content: { parts: ['Question'] } }
          },
          checkpoint: {
            parent: 'question',
            children: ['answer'],
            message: {
              id: 'checkpoint',
              author: { role: 'assistant' },
              content: { parts: ['Internal CI progress update'] },
              metadata: { is_visually_hidden_from_conversation: true }
            }
          },
          answer: {
            parent: 'checkpoint',
            children: [],
            message: { id: 'answer', author: { role: 'assistant' }, content: { parts: ['Visible final answer'] } }
          }
        }
      })))

    const conversation = await new ChatGPTParser().fetchConversationDetail('conversation-id')

    expect(conversation?.messages.map(message => message.content)).toEqual([
      'Question',
      'Visible final answer'
    ])
    expect(conversation).toMatchObject({
      sourceCompleteness: 'verified',
      verification: {
        transcript: { verified: true, method: 'active-branch-root-chain', reasons: ['active_branch_root_chain'] },
      },
    })
  })

  it('extracts structured ChatGPT references and removes private markers from message text', async () => {
    const validMarker = '\uE200filecite\uE202turn2file0\uE202L10-L12\uE201'
    const hiddenMarker = '\uE200filecite\uE202turn7file0\uE202L2-L2\uE201'
    const memoryMarker = '\uE200memcite\uE201'
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(200, { accessToken: 'token' }))
      .mockResolvedValueOnce(response(200, {
        id: 'conversation-id',
        current_node: 'answer',
        mapping: {
          root: { parent: null, children: ['question'] },
          question: {
            parent: 'root',
            children: ['answer'],
            message: { id: 'question', author: { role: 'user' }, content: { parts: ['Question'] } }
          },
          answer: {
            parent: 'question',
            children: [],
            message: {
              id: 'answer',
              author: { role: 'assistant' },
              content: { parts: [`Result${validMarker} hidden${hiddenMarker} memory${memoryMarker}`] },
              metadata: {
                content_references: [
                  {
                    matched_text: validMarker,
                    type: 'file',
                    name: 'QA Report.md',
                    cloud_doc_url: 'https://example.com/qa report%29.md'
                  },
                  { matched_text: hiddenMarker, type: 'hidden', invalid: true }
                ]
              }
            }
          }
        }
      })))

    const conversation = await new ChatGPTParser().fetchConversationDetail('conversation-id')

    expect(conversation?.messages[1].content).toBe('Result hidden memory')
    expect(conversation?.messages[1].content).not.toMatch(/[\uE000-\uF8FF]/)
    expect(conversation?.messages[1].references).toEqual([
      {
        type: 'file',
        title: 'QA Report.md',
        url: 'https://example.com/qa%20report%29.md',
        private: false
      }
    ])
  })

  it('verifies a long linear current-node chain without message-count heuristics', () => {
    const mapping: Record<string, any> = {
      root: { parent: null, message: null }
    }
    let parent = 'root'
    for (let index = 0; index < 80; index++) {
      const id = `node-${index}`
      mapping[id] = { parent, message: { id, create_time: index } }
      parent = id
    }

    const result = resolveChatGptActiveBranch(mapping, 'node-79')
    expect(result.complete).toBe(true)
    expect(result.nodes).toHaveLength(81)
  })

  it('rejects a current branch whose parent is missing', () => {
    const result = resolveChatGptActiveBranch({
      tail: { parent: 'missing', message: { id: 'tail' } }
    }, 'tail')

    expect(result.complete).toBe(false)
    expect(result.issue).toBe('missing_parent')
  })

  it('rejects a cycle in the current branch', () => {
    const result = resolveChatGptActiveBranch({
      first: { parent: 'second' },
      second: { parent: 'first' }
    }, 'second')

    expect(result.complete).toBe(false)
    expect(result.issue).toBe('cycle')
  })

  it('does not certify a fallback leaf when current_node is absent', () => {
    const result = resolveChatGptActiveBranch({
      root: { parent: null },
      answer: { parent: 'root', message: { create_time: 2 } }
    }, undefined)

    expect(result.nodes).toHaveLength(2)
    expect(result.complete).toBe(false)
    expect(result.issue).toBe('current_node_missing')
  })

  it('stops current export when a balanced API branch has a missing parent', async () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    window.history.replaceState({}, '', `/c/${id}`)
    document.body.innerHTML = `
      <div data-message-author-role="user" data-message-id="dom-user">Tail question</div>
      <div data-message-author-role="assistant" data-message-id="dom-answer">Tail answer</div>
    `
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(200, { accessToken: 'token' }))
      .mockResolvedValueOnce(response(200, {
        id,
        current_node: 'api-answer',
        mapping: {
          'api-user': {
            parent: 'missing-parent',
            message: {
              id: 'api-user',
              author: { role: 'user' },
              content: { parts: ['Tail question'] }
            }
          },
          'api-answer': {
            parent: 'api-user',
            message: {
              id: 'api-answer',
              author: { role: 'assistant' },
              content: { parts: ['Tail answer'] }
            }
          }
        }
      })))

    const responsePayload = await new Promise<any>((resolve) => {
      expect(runtimeListener({ type: 'PARSE_CONVERSATION', data: { forceVerify: true } }, {}, resolve)).toBe(true)
    })

    expect(responsePayload.data).toBeUndefined()
    expect(responsePayload.error).toContain('verifiably complete active branch')
    expect(responsePayload.meta).toMatchObject({
      apiDetailRequired: true,
      pageFallbackSupported: false,
      domMessageCount: 2,
      apiMessageCount: 2,
      apiIntegrityReasons: expect.arrayContaining(['source_unverified'])
    })
  })

  it('marks a broken API mapping as explicitly unexportable', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, { accessToken: 'token' }))
      .mockResolvedValueOnce(response(200, {
        id: 'conversation-id',
        current_node: 'answer',
        mapping: {
          user: {
            parent: 'missing-parent',
            message: { id: 'user', author: { role: 'user' }, content: { parts: ['Question'] } }
          },
          answer: {
            parent: 'user',
            message: { id: 'answer', author: { role: 'assistant' }, content: { parts: ['Answer'] } }
          }
        }
      }))
    vi.stubGlobal('fetch', fetchMock)

    const conversation = await new ChatGPTParser().fetchConversationDetail('conversation-id')

    expect(conversation).toMatchObject({
      source: 'api',
      sourceCompleteness: 'unverified',
      verification: {
        provider: 'chatgpt',
        source: 'api',
        transcript: {
          verified: false,
          method: 'active-branch-root-chain',
          reasons: ['missing_parent'],
        },
      },
    })
    expect(conversation?.messages).toHaveLength(2)
    expect(isConversationExportable(conversation)).toBe(false)
  })

  it('treats a flat messages payload as an authoritative API transcript', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(200, { accessToken: 'token' }))
      .mockResolvedValueOnce(response(200, {
        id: 'conversation-id',
        title: 'Flat payload',
        messages: [
          { id: 'user', author: { role: 'user' }, content: { parts: ['Question'] } },
          { id: 'answer', author: { role: 'assistant' }, content: { parts: ['Answer'] } },
        ],
      })))

    const conversation = await new ChatGPTParser().fetchConversationDetail('conversation-id')

    expect(conversation).toMatchObject({
      source: 'api',
      sourceCompleteness: 'verified',
      verification: {
        transcript: {
          verified: true,
          method: 'provider-api-complete',
          reasons: ['flat_authoritative_messages'],
        },
      },
    })
    expect(conversation?.messages.map(message => message.content)).toEqual(['Question', 'Answer'])
    expect(isConversationExportable(conversation)).toBe(true)
  })

  it('strips private citation tokens from a flat messages payload', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(200, { accessToken: 'token' }))
      .mockResolvedValueOnce(response(200, {
        id: 'conversation-id',
        title: 'Cited payload',
        messages: [
          {
            id: 'answer',
            author: { role: 'assistant' },
            content: { parts: ['Answer\uE000filecite123\uE000'] },
            metadata: {
              citations: [{ type: 'custom_connector', title: 'Internal wiki', url: 'https://wiki.corp/page' }],
            },
          },
        ],
      })))

    const conversation = await new ChatGPTParser().fetchConversationDetail('conversation-id')
    expect(conversation?.messages[0]?.content).toBe('Answer')
    expect(conversation?.messages[0]?.content).not.toContain('\uE000')
    expect(conversation?.messages[0]?.references).toEqual([
      expect.objectContaining({
        type: 'unknown',
        title: 'Internal wiki',
        url: 'https://wiki.corp/page',
        private: true,
      }),
    ])
  })

  it('preserves code block indentation in ChatGPT API detail content', async () => {
    const pythonCode = 'def add(a, b):\n    return a + b'
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(200, { accessToken: 'token' }))
      .mockResolvedValueOnce(response(200, {
        id: 'conv-indent',
        current_node: 'n-1',
        mapping: {
          'n-1': {
            id: 'n-1',
            parent: null,
            children: [],
            message: {
              id: 'n-1',
              author: { role: 'assistant' },
              content: { parts: ['```python\n' + pythonCode + '\n```'] },
            },
          },
        },
      })))

    const conversation = await new ChatGPTParser().fetchConversationDetail('conv-indent')
    expect(conversation?.messages[0]?.content).toContain(pythonCode)
  })

  it('parses ISO string create_time in conversation lists', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(200, { accessToken: 'token' }))
      .mockResolvedValueOnce(response(200, {
        items: [{
          id: 'conv-iso',
          title: 'Test ISO Date',
          create_time: '2023-11-15T15:58:20.000Z',
        }],
      })))

    const conversations = await new ChatGPTParser().fetchAllConversations()
    expect(conversations[0]?.createdAt).toBe(new Date('2023-11-15T15:58:20.000Z').getTime())
  })

  it('surfaces a 429 detail response as the safe rate-limit signal', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, { accessToken: 'token' }))
      .mockResolvedValueOnce(response(429, {}))
    vi.stubGlobal('fetch', fetchMock)

    await expect(new ChatGPTParser().fetchConversationDetail('conversation-id'))
      .rejects.toBeInstanceOf(ProviderRateLimitError)
  })
})
