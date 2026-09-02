import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GeminiParser,
  normalizeGeminiSingletonCredential,
  pruneGeminiCredentialMap,
  resolveCurrentGeminiConversation,
  selectGeminiCredential,
  validateGeminiCredentialPayload,
} from '../src/contents/gemini-parser'
import { ProviderRateLimitError } from '../src/lib/provider-rate-limit'

const credentials: Record<string, any> = {
  gemini_credentials: {
    at: 'test-auth-token',
    sid: '123456789'
  }
}

function detailResponse() {
  const payload = [
    [
      [
        ['c_433bb1a9c5f0177a', 'r_new'],
        null,
        [['Question two']],
        [[[null, ['Answer two with **Markdown**.']]]],
        [200, 0]
      ],
      [
        ['c_433bb1a9c5f0177a', 'r_old'],
        null,
        [['Question one']],
        [[[null, ['Answer one.']]]],
        [100, 0]
      ]
    ],
    null,
    null,
    []
  ]
  const outer = [['wrb.fr', 'hNvQHb', JSON.stringify(payload), null, null, null, 'generic']]
  return `)]}'\n${JSON.stringify(outer).length}\n${JSON.stringify(outer)}\n`
}

function batchResponse(rpcId: string, payload: unknown) {
  const outer = [['wrb.fr', rpcId, JSON.stringify(payload), null, null, null, 'generic']]
  return `)]}'\n${JSON.stringify(outer).length}\n${JSON.stringify(outer)}\n`
}

function readGeminiRequestArgs(options: RequestInit): unknown[] {
  const body = new URLSearchParams(String(options.body))
  const request = JSON.parse(body.get('f.req') || '[]')
  return JSON.parse(request[0][0][1])
}

describe('Gemini detail API parser', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.title = ''
    window.history.replaceState({}, '', '/app/not-the-requested-chat')
    credentials.gemini_credentials = {
      at: 'test-auth-token',
      sid: '123456789'
    }
    delete credentials.gemini_credentials_map

    // Credentials now live in chrome.storage.session when available; mirror
    // the local mock so migration is a no-op and reads see `credentials`.
    ;(globalThis as any).chrome = {
      storage: {
        get session() {
          return this.local
        },
        local: {
          get: vi.fn(async () => credentials),
          set: vi.fn(async () => {}),
          remove: vi.fn(async () => {})
        }
      },
      runtime: { getURL: vi.fn((path: string) => `chrome-extension://test/${path}`) }
    }
  })

  it('selects the newest credential for the active account slot', () => {
    expect(selectGeminiCredential({
      old: { at: 'old-token', sid: 'old-session', accountSlot: 'u1', lastUsed: 10 },
      newest: { at: 'new-token', sid: 'new-session', accountSlot: 'u1', lastUsed: 20 },
      other: { at: 'other-token', sid: 'other-session', accountSlot: 'u2', lastUsed: 30 },
    }, 'u1')).toMatchObject({ at: 'new-token', sid: 'new-session' })
    expect(selectGeminiCredential({ other: { at: 'other-token', accountSlot: 'u2' } }, 'u1')).toBeNull()
  })

  it('rejects malformed or stale page-world credentials and caps retained valid sessions', () => {
    const now = 1_000_000_000
    expect(validateGeminiCredentialPayload({
      at: 'valid-token', sid: '123', accountSlot: 'u1', lastUsed: now
    }, now)).toMatchObject({ accountSlot: 'u1' })
    expect(validateGeminiCredentialPayload({
      at: 'x'.repeat(4097), sid: '123', accountSlot: 'u1', lastUsed: now
    }, now)).toBeNull()
    expect(validateGeminiCredentialPayload({
      at: 'valid-token', sid: 'not-a-session', accountSlot: 'u1', lastUsed: now
    }, now)).toBeNull()
    expect(validateGeminiCredentialPayload({
      at: 'valid-token', sid: '123', accountSlot: 'u1', lastUsed: now - 24 * 60 * 60 * 1000 - 1
    }, now)).toBeNull()

    const map = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [
      String(index), { at: `token-${index}`, sid: String(index), accountSlot: `u${index}`, lastUsed: now - index }
    ])) as Record<string, any>
    map.stale = { at: 'stale-token', sid: '99', accountSlot: 'u99', lastUsed: now - 24 * 60 * 60 * 1000 - 1 }
    const pruned = pruneGeminiCredentialMap(map, now)
    expect(Object.keys(pruned)).toHaveLength(8)
    expect(pruned['0']).toBeDefined()
    expect(pruned['9']).toBeUndefined()
    expect(pruned.stale).toBeUndefined()
  })

  it('migrates a legacy singleton once, then expires it on the same TTL', () => {
    const now = 1_000_000_000
    expect(normalizeGeminiSingletonCredential({ at: 'legacy-token', sid: '123' }, now)).toEqual({
      at: 'legacy-token', sid: '123', lastUsed: now
    })
    expect(normalizeGeminiSingletonCredential({
      at: 'stale-token', sid: '123', lastUsed: now - 24 * 60 * 60 * 1000 - 1
    }, now)).toBeUndefined()
    expect(normalizeGeminiSingletonCredential({ at: 'bad', sid: 'not-a-session' }, now)).toBeUndefined()
  })

  it('recovers an incomplete current DOM conversation through the typed detail API', async () => {
    const domConversation = {
      id: 'current', title: 'Current', url: 'https://gemini.google.com/app/current', platform: 'gemini' as const,
      messages: [{ id: 'dom-user', role: 'user' as const, content: 'Question' }]
    }
    const apiConversation = {
      ...domConversation,
      messages: [
        { id: 'api-user', role: 'user' as const, content: 'Question' },
        { id: 'api-assistant', role: 'assistant' as const, content: 'Answer' }
      ]
    }
    const fakeParser = {
      parseCurrentConversation: vi.fn(async () => domConversation),
      fetchConversationDetail: vi.fn(async () => apiConversation),
    } as unknown as GeminiParser

    await expect(resolveCurrentGeminiConversation(fakeParser, 'current', 'Requested')).resolves.toEqual(apiConversation)
    expect(fakeParser.fetchConversationDetail).toHaveBeenCalledWith('current', 'Requested')
  })

  it('uses the current detail RPC and extracts only the four typed turn fields', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => detailResponse()
    }))
    vi.stubGlobal('fetch', fetchMock)

    const conversation = await new GeminiParser().fetchConversationDetail(
      'c_433bb1a9c5f0177a',
      'Requested title'
    )

    expect(conversation?.id).toBe('433bb1a9c5f0177a')
    expect(conversation?.title).toBe('Requested title')
    expect(conversation?.messages.map(message => [message.role, message.content])).toEqual([
      ['user', 'Question one'],
      ['assistant', 'Answer one.'],
      ['user', 'Question two'],
      ['assistant', 'Answer two with **Markdown**.']
    ])

    const [url, options] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('rpcids=hNvQHb')
    const body = new URLSearchParams(String((options as RequestInit).body))
    const request = JSON.parse(body.get('f.req') || '[]')
    expect(request[0][0][0]).toBe('hNvQHb')
    expect(JSON.parse(request[0][0][1])).toEqual([
      'c_433bb1a9c5f0177a', 1000, null, 1, [1], [4], null, 1
    ])
    expect(conversation?.createdAt).toBe(100_000)
  })

  it('uses the matching account slot for both Gemini credentials', async () => {
    window.history.replaceState({}, '', '/u/1/app/not-the-requested-chat')
    credentials.gemini_credentials = { at: 'fallback-token', sid: 'fallback-session' }
    credentials.gemini_credentials_map = {
      u1: { at: 'slot-token', sid: '-123456789', accountSlot: 'u1' }
    }
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => detailResponse()
    }))
    vi.stubGlobal('fetch', fetchMock)

    await new GeminiParser().fetchConversationDetail('433bb1a9c5f0177a', 'Requested title')

    const [url, options] = fetchMock.mock.calls[0]
    expect(new URL(String(url)).searchParams.get('f.sid')).toBe('-123456789')
    const body = new URLSearchParams(String((options as RequestInit).body))
    expect(body.get('at')).toBe('slot-token')
  })

  it('strips the ordinary hyphenated Gemini title suffix', () => {
    document.title = 'Conversation title - Gemini'

    expect(new GeminiParser().getConversationTitle()).toBe('Conversation title')
  })

  it('parses batchexecute conversation lists and normalizes c_ identifiers', async () => {
    const payload = [null, null, [[
      'c_1234567890abcdef', 'Conversation title', null, null, null, [1_717_000_000, 500_000_000]
    ]]]
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => batchResponse('MaZiqc', payload)
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { conversations } = await new GeminiParser().fetchAllConversationsWithStatus()

    expect(conversations).toEqual([{
      id: '1234567890abcdef',
      title: 'Conversation title',
      url: 'https://gemini.google.com/app/1234567890abcdef',
      platform: 'gemini',
      updatedAt: 1_717_000_000_500
    }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const modes = fetchMock.mock.calls
      .map(([, options]) => readGeminiRequestArgs(options as RequestInit))
      .map(args => args[2]?.[0])
      .sort()
    expect(modes).toEqual([0, 1])
    for (const [, options] of fetchMock.mock.calls) {
      const body = new URLSearchParams(String((options as RequestInit).body))
      const request = JSON.parse(body.get('f.req') || '[]')
      expect(request[0][0][0]).toBe('MaZiqc')
      expect(readGeminiRequestArgs(options as RequestInit)[0]).toBe(25)
    }
    const [firstUrl] = fetchMock.mock.calls[0]
    expect(new URL(String(firstUrl)).searchParams.has('bl')).toBe(false)
  })

  it('falls back to a deduplicated sidebar list when Gemini credentials are unavailable', async () => {
    delete credentials.gemini_credentials
    delete credentials.gemini_credentials_map
    delete (window as any).__WIZ_global_data
    window.history.replaceState({}, '', '/app/current')
    document.body.innerHTML = `
      <nav>
        <a href="/app/id_with-1">Valid chat</a>
        <a href="/app/id_with-1">Duplicate chat</a>
        <a href="/app/empty-title"></a>
      </nav>
    `
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const parser = new GeminiParser()
    const result = await parser.fetchAllConversationsWithStatus()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(parser.isAuthenticationRequired()).toBe(true)
    expect(result).toMatchObject({ source: 'sidebar', complete: false })
    expect(result.conversations).toEqual([
      expect.objectContaining({
        id: 'id_with-1',
        title: 'Valid chat',
        platform: 'gemini',
      }),
      expect.objectContaining({
        id: 'empty-title',
        title: 'Untitled Conversation',
        platform: 'gemini',
      }),
    ])
    expect(result.conversations.every(item => item.url.includes('/app/'))).toBe(true)
  })

  it('uses Gemini\'s live at input when no previously hooked credential exists', async () => {
    delete credentials.gemini_credentials
    document.body.innerHTML = '<input name="at" value="page-token" />'
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => batchResponse('MaZiqc', [null, null, []])
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await new GeminiParser().fetchAllConversationsWithStatus()

    expect(result).toMatchObject({ source: 'api', complete: true, conversations: [] })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [, options] of fetchMock.mock.calls) {
      const body = new URLSearchParams(String((options as RequestInit).body))
      expect(body.get('at')).toBe('page-token')
    }
  })

  it('marks a repeated list continuation as partial instead of pretending sidebar rows are complete', async () => {
    const fetchMock = vi.fn(async (_url: string, options: RequestInit) => {
      const args = readGeminiRequestArgs(options)
      const mode = args[2]?.[0]
      const payload = mode === 0
        ? [null, 'repeated-token', [['c_1234567890abcdef', 'Conversation title']]]
        : [null, null, []]
      return {
      ok: true,
        text: async () => batchResponse('MaZiqc', payload)
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await new GeminiParser().fetchAllConversationsWithStatus()

    expect(result).toMatchObject({ source: 'api', complete: false })
    expect(result.conversations).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('surfaces a batchexecute 429 as the safe rate-limit signal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => '',
    })))

    await expect(new GeminiParser().fetchConversationDetail('433bb1a9c5f0177a', 'Requested title'))
      .rejects.toBeInstanceOf(ProviderRateLimitError)
  })
})
