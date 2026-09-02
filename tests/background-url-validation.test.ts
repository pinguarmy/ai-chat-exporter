/**
 * Background worker message-surface hardening tests.
 * The worker must only navigate to known provider HTTPS URLs and only answer
 * messages from this extension's own contexts.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'

beforeAll(async () => {
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'test-extension-id',
      onInstalled: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn() },
    },
    alarms: {
      create: vi.fn(),
      get: vi.fn((_name: string, callback: (alarm?: unknown) => void) => callback(undefined)),
      onAlarm: { addListener: vi.fn() },
    },
  })
})

describe('provider conversation URL validation', () => {
  it('accepts https URLs on supported provider hosts', async () => {
    const { isProviderConversationUrl } = await import('../src/background')

    expect(isProviderConversationUrl('https://chatgpt.com/c/abc123')).toBe(true)
    expect(isProviderConversationUrl('https://claude.ai/chat/abc')).toBe(true)
    expect(isProviderConversationUrl('https://gemini.google.com/app/abc')).toBe(true)
    expect(isProviderConversationUrl('https://chat.deepseek.com/a/chat/s/abc')).toBe(true)
    expect(isProviderConversationUrl('https://grok.com/c/abc')).toBe(true)
  })

  it('rejects non-https, non-provider, and malformed URLs', async () => {
    const { isProviderConversationUrl } = await import('../src/background')

    expect(isProviderConversationUrl('http://chatgpt.com/c/abc')).toBe(false)
    expect(isProviderConversationUrl('javascript:alert(1)')).toBe(false)
    expect(isProviderConversationUrl('file:///etc/passwd')).toBe(false)
    expect(isProviderConversationUrl('https://evil.example.com/c/abc')).toBe(false)
    // Look-alike hosts must not pass a substring check.
    expect(isProviderConversationUrl('https://chatgpt.com.evil.example/c/abc')).toBe(false)
    expect(isProviderConversationUrl('https://sub.claude.ai/chat/abc')).toBe(false)
    expect(isProviderConversationUrl('not a url')).toBe(false)
    expect(isProviderConversationUrl('')).toBe(false)
    expect(isProviderConversationUrl(undefined)).toBe(false)
  })
})

describe('session storage access level', () => {
  it('opens chrome.storage.session to content scripts', async () => {
    // The Gemini credential bridge runs as a content script, and the session
    // area is trusted-context-only until this call is made. Without it the
    // parser silently falls back to on-disk chrome.storage.local.
    const setAccessLevel = vi.fn(async () => undefined)
    vi.stubGlobal('chrome', {
      ...(globalThis as any).chrome,
      storage: { session: { setAccessLevel } },
    })

    const { allowContentScriptSessionStorage } = await import('../src/background')
    await expect(allowContentScriptSessionStorage()).resolves.toBe(true)
    expect(setAccessLevel).toHaveBeenCalledWith({
      accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS',
    })
  })

  it('reports failure instead of throwing when the API is missing or rejects', async () => {
    const { allowContentScriptSessionStorage } = await import('../src/background')

    vi.stubGlobal('chrome', { ...(globalThis as any).chrome, storage: {} })
    await expect(allowContentScriptSessionStorage()).resolves.toBe(false)

    vi.stubGlobal('chrome', {
      ...(globalThis as any).chrome,
      storage: { session: { setAccessLevel: vi.fn(async () => { throw new Error('unsupported') }) } },
    })
    await expect(allowContentScriptSessionStorage()).resolves.toBe(false)
  })
})

describe('scheduled conversation list retry', () => {
  const listOf = (n: number) => ({ data: Array.from({ length: n }, (_, i) => ({ id: `c${i}` })) })

  it('retries an empty list while the page is still hydrating', async () => {
    // waitForContentScript only proves DETECT_PLATFORM answers. A provider
    // whose list comes from sidebar DOM can still be empty at that moment, and
    // the fixed post-load delay that used to hide this is gone.
    const { fetchScheduledConversationList } = await import('../src/background')
    const sendMessage = vi.fn()
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce(listOf(3))

    const result = await fetchScheduledConversationList(1, undefined, 3, 0, sendMessage)

    expect(result).toEqual(listOf(3))
    expect(sendMessage).toHaveBeenCalledTimes(2)
  })

  it('returns immediately on a real answer instead of burning retries', async () => {
    const { fetchScheduledConversationList } = await import('../src/background')

    for (const settled of [
      listOf(1),
      { error: 'Rate limited' },
      { meta: { authRequired: true } },
    ]) {
      const sendMessage = vi.fn().mockResolvedValue(settled)
      await expect(fetchScheduledConversationList(1, undefined, 3, 0, sendMessage))
        .resolves.toEqual(settled)
      expect(sendMessage).toHaveBeenCalledTimes(1)
    }
  })

  it('survives a throwing send and still reports the last response', async () => {
    const { fetchScheduledConversationList } = await import('../src/background')
    const sendMessage = vi.fn()
      .mockRejectedValueOnce(new Error('Receiving end does not exist'))
      .mockResolvedValueOnce(listOf(2))

    await expect(fetchScheduledConversationList(1, undefined, 3, 0, sendMessage))
      .resolves.toEqual(listOf(2))
  })

  it('gives up after the configured attempts', async () => {
    const { fetchScheduledConversationList } = await import('../src/background')
    const sendMessage = vi.fn().mockResolvedValue({ data: [] })

    const result = await fetchScheduledConversationList(1, undefined, 3, 0, sendMessage)

    expect(result).toEqual({ data: [] })
    expect(sendMessage).toHaveBeenCalledTimes(3)
  })
})
