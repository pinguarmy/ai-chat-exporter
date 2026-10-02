import { afterEach, describe, expect, it, vi } from 'vitest'
import { readConversationHistory } from '../src/lib/provider-read'
import { localizeProviderError } from '../src/lib/provider-errors'
import type { Locale } from '../src/lib/i18n'

afterEach(() => vi.useRealTimers())

describe('bounded account history reads', () => {
  it('keeps a successful empty account distinct from sidebar fallback', async () => {
    const send = vi.fn(async () => ({ data: [], meta: { source: 'api', complete: true } }))
    expect(await readConversationHistory(send)).toEqual({ data: [], meta: { source: 'api', complete: true } })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('returns incomplete sidebar history when the account request stalls and ignores its late reply', async () => {
    vi.useFakeTimers()
    let finish!: (value: any) => void
    const sidebar = [{ id: 'visible', platform: 'chatgpt' }]
    const send = vi.fn(type => type === 'FETCH_ALL_CONVERSATIONS'
      ? new Promise<any>(resolve => { finish = resolve })
      : Promise.resolve({ data: sidebar }))
    const pending = readConversationHistory(send, 100)
    await vi.advanceTimersByTimeAsync(100)
    const result = await pending
    expect(result).toEqual({ data: sidebar, error: 'Provider read timed out', meta: { source: 'sidebar', complete: false, authRequired: false } })
    finish({ data: [{ id: 'late' }], meta: { source: 'api', complete: true } })
    await Promise.resolve()
    expect(result.data).toEqual(sidebar)
  })

  it('settles when both the history API and sidebar channel stall', async () => {
    vi.useFakeTimers()
    const pending = readConversationHistory(() => new Promise(() => {}), 100)
    const rejected = expect(pending).rejects.toThrow('Provider read timed out')
    await vi.advanceTimersByTimeAsync(5_100)
    await rejected
  })

  it('preserves an expired-login signal through sidebar fallback', async () => {
    const result = await readConversationHistory(async type => type === 'FETCH_ALL_CONVERSATIONS'
      ? { error: 'Authentication required', meta: { authRequired: true } }
      : { data: [] })
    expect(result.meta).toMatchObject({ authRequired: true, complete: false })
  })
})

describe('provider error localization', () => {
  it('translates provider verification, timeout and unknown failures into every supported language', () => {
    const errors = [
      'ChatGPT did not return a verifiably complete active branch. Export was stopped.',
      'Claude did not return a verifiably complete conversation.',
      'Provider read timed out',
      'Could not establish connection. Receiving end does not exist.',
    ]
    for (const locale of ['zh-CN', 'zh-TW', 'de', 'ja', 'ko'] as Locale[]) {
      for (const message of errors) expect(localizeProviderError(message, locale)).not.toBe(message)
    }
    expect(localizeProviderError(errors[0], 'zh-CN')).toContain('无法验证 ChatGPT 对话的完整性')
  })
})
