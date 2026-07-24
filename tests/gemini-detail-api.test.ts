import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GeminiParser } from '../src/contents/gemini-parser'

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

    ;(globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn(async () => credentials),
          set: vi.fn(async () => {}),
          remove: vi.fn(async () => {})
        }
      },
      runtime: { getURL: vi.fn((path: string) => `chrome-extension://test/${path}`) }
    }
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
    expect(request[0][0]).toBe('hNvQHb')
    expect(JSON.parse(request[0][1])[0]).toBe('c_433bb1a9c5f0177a')
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
    const payload = [null, null, [['c_1234567890abcdef', 'Conversation title']]]
    const outer = [['wrb.fr', 'MaZiqc', JSON.stringify(payload), null, null, null, 'generic']]
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => `)]}'\n${JSON.stringify(outer).length}\n${JSON.stringify(outer)}\n`
    })))

    const conversations = await new GeminiParser().fetchAllConversations()

    expect(conversations).toEqual([{
      id: '1234567890abcdef',
      title: 'Conversation title',
      url: 'https://gemini.google.com/app/1234567890abcdef',
      platform: 'gemini'
    }])
  })

  it('stops pagination when Gemini repeats a page token', async () => {
    const payload = [null, 'repeated-token', [['c_1234567890abcdef', 'Conversation title']]]
    const outer = [['wrb.fr', 'MaZiqc', JSON.stringify(payload), null, null, null, 'generic']]
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => `)]}'\n${JSON.stringify(outer).length}\n${JSON.stringify(outer)}\n`
    }))
    vi.stubGlobal('fetch', fetchMock)

    const conversations = await new GeminiParser().fetchAllConversations()

    expect(conversations).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
