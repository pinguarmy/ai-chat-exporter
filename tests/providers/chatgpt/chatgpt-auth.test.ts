import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type ChatGPTParserConstructor = typeof import('../../../src/contents/chatgpt-parser').ChatGPTParser

const storageLocal = {
  get: vi.fn(async () => ({ chatGPTAccessToken: 'legacy-token-must-not-be-read' })),
  set: vi.fn(async () => {}),
  remove: vi.fn(async () => {})
}

let ChatGPTParser: ChatGPTParserConstructor

function response(status: number, data: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => data
  }
}

describe('ChatGPT API authentication', () => {
  beforeAll(async () => {
    vi.stubGlobal('chrome', {
      storage: { local: storageLocal },
      runtime: { onMessage: { addListener: vi.fn() } }
    })
    ;({ ChatGPTParser } = await import('../../../src/contents/chatgpt-parser'))
  })

  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('uses memory-only token caching and removes the legacy local key', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, { accessToken: 'memory-token' }))
      .mockResolvedValueOnce(response(200, { items: [] }))
      .mockResolvedValueOnce(response(200, { items: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const parser = new ChatGPTParser()
    await parser.fetchAllConversations()
    await parser.fetchAllConversations()

    expect(storageLocal.remove).toHaveBeenCalledWith('chatGPTAccessToken')
    expect(storageLocal.get).not.toHaveBeenCalled()
    expect(storageLocal.set).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      'https://chatgpt.com/api/auth/session',
      'https://chatgpt.com/backend-api/conversations?offset=0&limit=100&order=updated',
      'https://chatgpt.com/backend-api/conversations?offset=0&limit=100&order=updated'
    ])
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include' })
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ credentials: 'include' })
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer memory-token')
  })

  it('uses the legacy host for session, list, and generated conversation URLs', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, { accessToken: 'legacy-origin-token' }))
      .mockResolvedValueOnce(
        response(200, {
          items: [{ id: 'conversation-1', title: 'Legacy host chat' }]
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    const conversations = await new ChatGPTParser('https://chat.openai.com').fetchAllConversations()

    expect(fetchMock.mock.calls[0][0]).toBe('https://chat.openai.com/api/auth/session')
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://chat.openai.com/backend-api/conversations?offset=0&limit=100&order=updated'
    )
    expect(conversations[0].url).toBe('https://chat.openai.com/c/conversation-1')
  })

  it('falls back to the canonical host for an unrecognized origin', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, { accessToken: 'canonical-token' }))
      .mockResolvedValueOnce(response(200, { items: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await new ChatGPTParser('https://attacker.example').fetchAllConversations()

    expect(fetchMock.mock.calls[0][0]).toBe('https://chatgpt.com/api/auth/session')
    expect(fetchMock.mock.calls[1][0]).toContain('https://chatgpt.com/backend-api/conversations')
  })
})
