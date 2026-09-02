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
