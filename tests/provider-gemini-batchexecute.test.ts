import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildGeminiBatchExecuteBody,
  buildGeminiBatchExecuteUrl,
  buildGeminiRpcRequest,
  extractGeminiListPageToken,
  extractGeminiMessagesFromDetailPayload,
  mergeGeminiConversationListItems,
  parseGeminiConversationListPayload,
  parseGeminiRpcPayload
} from '../src/providers/gemini/batchexecute'
import {
  clearStoredGeminiCredentialsForAccount,
  getGeminiAccountSlot,
  resetGeminiCredentialMigrationForTests,
  storeGeminiCredentialFromPage,
  readStoredGeminiCredentials
} from '../src/providers/gemini/credentials'

describe('Gemini batchexecute encoding', () => {
  it('builds the three-level request envelope with JSON-encoded args', () => {
    expect(JSON.parse(buildGeminiRpcRequest('MaZiqc', [25, null, [1, null, 1]]))).toEqual([
      [['MaZiqc', '[25,null,[1,null,1]]', null, 'generic']]
    ])
  })

  it('builds the URL with rpcids, source-path and f.sid and the form body with the token', () => {
    const url = new URL(buildGeminiBatchExecuteUrl('hNvQHb', '/app/abc', '-123'))
    expect(url.origin + url.pathname).toBe('https://gemini.google.com/_/BardChatUi/data/batchexecute')
    expect(url.searchParams.get('rpcids')).toBe('hNvQHb')
    expect(url.searchParams.get('source-path')).toBe('/app/abc')
    expect(url.searchParams.get('f.sid')).toBe('-123')
    expect(url.searchParams.get('rt')).toBe('c')

    const body = new URLSearchParams(buildGeminiBatchExecuteBody('[[["x"]]]', 'tok:en'))
    expect(body.get('f.req')).toBe('[[["x"]]]')
    expect(body.get('at')).toBe('tok:en')
  })
})

describe('Gemini batchexecute decoding', () => {
  const frame = (rpcId: string, inner: unknown) =>
    `)]}'\n\n123\n${JSON.stringify([['wrb.fr', rpcId, JSON.stringify(inner), null, null, null, 'generic']])}\n25\n[["e",4,null,null,128]]`

  it('decodes only the requested rpc id from length-prefixed frames', () => {
    const text = `${frame('other', ['no'])}\n${frame('MaZiqc', ['yes'])}`
    expect(parseGeminiRpcPayload(text, 'MaZiqc')).toEqual(['yes'])
    expect(parseGeminiRpcPayload(text, 'hNvQHb')).toBeNull()
  })

  it('returns null for diagnostic-only or malformed text without throwing', () => {
    expect(parseGeminiRpcPayload(")]}'\n\n12\n[[not json", 'MaZiqc')).toBeNull()
    expect(parseGeminiRpcPayload('', 'MaZiqc')).toBeNull()
  })

  it('reads the list cursor from the two known positions only', () => {
    expect(extractGeminiListPageToken([[], 'next'])).toBe('next')
    expect(extractGeminiListPageToken([[null, 'nested']])).toBe('nested')
    expect(extractGeminiListPageToken([[null, 'nested'], 'top'])).toBe('top')
    expect(extractGeminiListPageToken([[], '  '])).toBeNull()
    expect(extractGeminiListPageToken([[], 42])).toBeNull()
    expect(extractGeminiListPageToken('nope')).toBeNull()
  })

  it('finds conversation rows anywhere, strips the c_ prefix and keeps seconds+nanos activity time', () => {
    const payload = [[['c_abc', 'First', null, null, null, [1700000000, 500_000_000]], ['not-a-conv', 'x']], [['c_def', 'Second']]]
    expect(parseGeminiConversationListPayload(payload)).toEqual([
      { id: 'abc', title: 'First', url: 'https://gemini.google.com/app/abc', platform: 'gemini', updatedAt: 1700000000500 },
      { id: 'def', title: 'Second', url: 'https://gemini.google.com/app/def', platform: 'gemini' }
    ])
  })

  it('rejects ids with characters outside the conversation id alphabet', () => {
    expect(parseGeminiConversationListPayload([['c_bad id', 'T'], ['c_', 'T']])).toEqual([])
  })

  it('merges list streams by id, preferring the row that carries a timestamp', () => {
    const base = { title: 't', url: 'u', platform: 'gemini' as const }
    const merged = mergeGeminiConversationListItems([
      { ...base, id: 'a' },
      { ...base, id: 'a', updatedAt: 5 },
      { ...base, id: 'b', updatedAt: 1 },
      { ...base, id: 'b', updatedAt: 9 }
    ])
    expect(merged.map(i => [i.id, i.updatedAt])).toEqual([['a', 5], ['b', 1]])
  })

  describe('detail payload', () => {
    // Turns arrive newest first; each is [ [conv, responseId], _, [[userText]], [[[_, [assistantMd]]]], [seconds] ]
    const turn = (responseId: string, user: string, assistant: string, seconds: number) => [
      ['c_x', responseId], null, [[user]], [[[null, [assistant]]]], [seconds]
    ]

    it('reverses the newest-first turns into display order with user before assistant', () => {
      const payload = [[turn('r2', 'second question', 'second answer', 200), turn('r1', 'first question', 'first answer', 100)]]
      const messages = extractGeminiMessagesFromDetailPayload(payload)
      expect(messages.map(m => [m.id, m.role, m.content, m.timestamp])).toEqual([
        ['r1-user', 'user', 'first question', 100000],
        ['r1', 'assistant', 'first answer', 100000],
        ['r2-user', 'user', 'second question', 200000],
        ['r2', 'assistant', 'second answer', 200000]
      ])
    })

    it('skips blank sides and malformed turns instead of inventing content', () => {
      const payload = [[turn('r1', '  ', 'only answer', 1), 'garbage', turn('r0', 'only question', '', 1)]]
      expect(extractGeminiMessagesFromDetailPayload(payload).map(m => `${m.role}:${m.content}`))
        .toEqual(['user:only question', 'assistant:only answer'])
    })

    it('returns no messages for payloads without the turns array', () => {
      expect(extractGeminiMessagesFromDetailPayload(null)).toEqual([])
      expect(extractGeminiMessagesFromDetailPayload([{}])).toEqual([])
    })
  })
})

describe('Gemini credential storage helpers', () => {
  const store: Record<string, unknown> = {}
  const area = {
    get: vi.fn(async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys]
      return Object.fromEntries(list.filter(k => k in store).map(k => [k, store[k]]))
    }),
    set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(store, items) }),
    remove: vi.fn(async (keys: string | string[]) => { for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k] })
  }

  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key]
    resetGeminiCredentialMigrationForTests()
    vi.stubGlobal('chrome', { storage: { session: area, local: { get: vi.fn(async () => ({})), set: vi.fn(), remove: vi.fn() } } })
    window.history.replaceState({}, '', '/app')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('derives the account slot from /u/N/ and defaults otherwise', () => {
    expect(getGeminiAccountSlot()).toBe('default')
    window.history.replaceState({}, '', '/u/2/app/abc')
    expect(getGeminiAccountSlot()).toBe('u2')
  })

  it('ignores payloads that fail validation and never stores them', async () => {
    await storeGeminiCredentialFromPage({ at: 'x'.repeat(5000), accountSlot: 'default', lastUsed: Date.now() })
    await storeGeminiCredentialFromPage({ at: 'tok', accountSlot: 'evil slot', lastUsed: Date.now() })
    await storeGeminiCredentialFromPage('not an object')
    expect(area.set).not.toHaveBeenCalled()
  })

  it('stores a valid credential in both the singleton and the account map', async () => {
    await storeGeminiCredentialFromPage({ at: 'tok', sid: '-42', accountSlot: 'u1', lastUsed: Date.now() })
    const { credentials, credentialsMap } = await readStoredGeminiCredentials()
    expect(credentials?.at).toBe('tok')
    expect(Object.values(credentialsMap).map(c => c.accountSlot)).toEqual(['u1'])
  })

  it('clears only the credentials for the demonstrably invalid account slot', async () => {
    await storeGeminiCredentialFromPage({ at: 'one', sid: '1', accountSlot: 'u0', lastUsed: Date.now() })
    await storeGeminiCredentialFromPage({ at: 'two', sid: '2', accountSlot: 'u1', lastUsed: Date.now() })
    await clearStoredGeminiCredentialsForAccount('u0')
    const { credentialsMap } = await readStoredGeminiCredentials()
    expect(Object.values(credentialsMap).map(c => c.accountSlot)).toEqual(['u1'])
  })

  it('does not throw when storage is unavailable', async () => {
    resetGeminiCredentialMigrationForTests()
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn(async () => { throw new Error('boom') }), set: vi.fn(), remove: vi.fn() } } })
    await expect(clearStoredGeminiCredentialsForAccount('u0')).resolves.toBeUndefined()
    await expect(storeGeminiCredentialFromPage({ at: 'tok', accountSlot: 'default', lastUsed: Date.now() })).resolves.toBeUndefined()
  })
})
