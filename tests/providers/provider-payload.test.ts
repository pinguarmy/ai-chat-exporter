import { beforeAll, describe, expect, it, vi } from 'vitest'
import { isJsonRecord, readPath } from '../../src/core/provider-payload'
import { settingsDifference } from '../../src/platform/settings-store'
import { extractGeminiMessagesFromDetailPayload } from '../../src/providers/gemini/batchexecute'
import { redactShareText } from '../../src/core/share-redaction'

type DeepSeekHistoryParser = typeof import('../../src/contents/deepseek-parser').parseDeepSeekHistoryPage
let parseDeepSeekHistoryPage: DeepSeekHistoryParser

beforeAll(async () => {
  // Importing a content script registers its runtime listener.
  vi.stubGlobal('chrome', {
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) } },
    runtime: { onMessage: { addListener: vi.fn() }, getURL: vi.fn((path: string) => path) },
  })
  ;({ parseDeepSeekHistoryPage } = await import('../../src/contents/deepseek-parser'))
})

describe('isJsonRecord', () => {
  it('accepts plain objects only', () => {
    expect(isJsonRecord({})).toBe(true)
    expect(isJsonRecord({ a: 1 })).toBe(true)
    expect(isJsonRecord([])).toBe(false)
    expect(isJsonRecord(null)).toBe(false)
    expect(isJsonRecord('text')).toBe(false)
    expect(isJsonRecord(undefined)).toBe(false)
  })
})

describe('readPath', () => {
  it('reads nested members like optional chaining', () => {
    expect(readPath({ a: { b: { c: 7 } } }, 'a', 'b', 'c')).toBe(7)
    expect(readPath({ a: { b: 1 } }, 'a', 'x', 'c')).toBeUndefined()
  })

  it('returns undefined when any step is not an object', () => {
    expect(readPath(null, 'a')).toBeUndefined()
    expect(readPath({ a: 'str' }, 'a', 'length')).toBeUndefined()
    expect(readPath({ a: [1, 2] }, 'a', '0')).toBeUndefined()
  })

  it('returns the value itself for an empty path', () => {
    const value = { a: 1 }
    expect(readPath(value)).toBe(value)
  })
})

describe('settingsDifference', () => {
  it('keeps only changed keys and recurses into nested objects', () => {
    const before = { a: 1, b: { x: 1, y: 2 }, c: 'same' }
    const after = { a: 2, b: { x: 1, y: 3 }, c: 'same' }
    expect(settingsDifference(before, after)).toEqual({ a: 2, b: { y: 3 } })
  })

  it('returns an empty object when nothing changed', () => {
    expect(settingsDifference({ a: [1, 2] }, { a: [1, 2] })).toEqual({})
  })

  it('replaces arrays wholesale rather than diffing them', () => {
    expect(settingsDifference({ a: [1, 2] }, { a: [1, 3] })).toEqual({ a: [1, 3] })
  })
})

describe('extractGeminiMessagesFromDetailPayload', () => {
  it('returns no messages for payloads that are not turn arrays', () => {
    expect(extractGeminiMessagesFromDetailPayload(null)).toEqual([])
    expect(extractGeminiMessagesFromDetailPayload({ 0: [] })).toEqual([])
    expect(extractGeminiMessagesFromDetailPayload([null])).toEqual([])
  })

  it('reverses newest-first turns and ignores malformed ones', () => {
    const turn = (id: string, user: string, assistant: string, seconds: number) => [
      ['c', id],
      null,
      [[user]],
      [[[null, [assistant]]]],
      [seconds]
    ]
    const payload = [[turn('r2', 'second?', 'second!', 20), 'garbage', turn('r1', 'first?', 'first!', 10)]]
    const messages = extractGeminiMessagesFromDetailPayload(payload)
    expect(messages.map(m => [m.id, m.role, m.content, m.timestamp])).toEqual([
      ['r1-user', 'user', 'first?', 10_000],
      ['r1', 'assistant', 'first!', 10_000],
      ['r2-user', 'user', 'second?', 20_000],
      ['r2', 'assistant', 'second!', 20_000]
    ])
  })
})

describe('parseDeepSeekHistoryPage', () => {
  it('tolerates non-object payloads', () => {
    expect(parseDeepSeekHistoryPage(null)).toEqual({ items: [], nextCursor: undefined, hasMore: false })
    expect(parseDeepSeekHistoryPage('oops')).toEqual({ items: [], nextCursor: undefined, hasMore: false })
  })

  it('unwraps nested envelopes and reads the cursor', () => {
    const page = parseDeepSeekHistoryPage({ data: { biz_data: { chat_sessions: [{ id: 'a' }], next_cursor: 'n1' } } })
    expect(page.items).toEqual([{ id: 'a' }])
    expect(page.nextCursor).toBe('n1')
    expect(page.hasMore).toBe(true)
  })

  it('honours an explicit has_more flag over cursor presence', () => {
    const page = parseDeepSeekHistoryPage({ items: [{ id: 'a' }], cursor: 'c', has_more: false })
    expect(page.hasMore).toBe(false)
  })
})

describe('redactShareText', () => {
  it('counts each redaction once and is idempotent', () => {
    const first = redactShareText('token=abc123 and Authorization: Bearer xyz')
    expect(first.replacements).toBe(2)
    expect(first.text).toContain('token=[REDACTED]')
    const second = redactShareText(first.text)
    expect(second.replacements).toBe(0)
    expect(second.text).toBe(first.text)
  })
})
