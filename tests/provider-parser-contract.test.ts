import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderParser } from '../src/lib/providers/provider-parser'
import type { ParserRuntimeParser } from '../src/lib/parser-runtime'

const REQUIRED_METHODS = [
  'isConversationPage',
  'parseCurrentConversation',
  'getConversationTitle',
  'getConversationList',
  'fetchConversationDetail',
  'isAuthenticationRequired'
] as const

describe('ProviderParser contract', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.title = ''
    window.history.replaceState({}, '', '/')
    vi.stubGlobal('chrome', {
      storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) } },
      runtime: { onMessage: { addListener: vi.fn() }, getURL: vi.fn((path: string) => path) },
      tabs: { sendMessage: vi.fn() },
      alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
      downloads: { onDeterminingFilename: { addListener: vi.fn() } },
    })
  })

  it.each([
    ['ChatGPT', async (): Promise<ProviderParser> => new (await import('../src/contents/chatgpt-parser')).ChatGPTParser()],
    ['Claude', async (): Promise<ProviderParser> => new (await import('../src/contents/claude-parser')).ClaudeParser()],
    ['DeepSeek', async (): Promise<ProviderParser> => new (await import('../src/contents/deepseek-parser')).DeepSeekParser()],
    ['Gemini', async (): Promise<ProviderParser> => new (await import('../src/contents/gemini-parser')).GeminiParser()],
    ['Grok', async (): Promise<ProviderParser> => new (await import('../src/contents/grok-parser')).GrokParser()],
  ])('%s parser fulfils the shared contract', async (_name, create) => {
    const parser = await create()
    for (const method of REQUIRED_METHODS) {
      expect(typeof parser[method], method).toBe('function')
    }
    expect(parser.isAuthenticationRequired()).toBe(false)
    expect(parser.getConversationList()).toEqual([])
    // Optional capabilities are either absent or callable, never some other shape.
    for (const optional of ['fetchAllConversations', 'getConversationListMeta', 'capturePageSnapshot'] as const) {
      expect(['undefined', 'function']).toContain(typeof parser[optional])
    }
  })

  it('exposes the optional capabilities each provider actually has', async () => {
    const gemini = new (await import('../src/contents/gemini-parser')).GeminiParser()
    expect(typeof gemini.capturePageSnapshot).toBe('function')
    expect(gemini.fetchAllConversations).toBeUndefined()

    const grok = new (await import('../src/contents/grok-parser')).GrokParser()
    expect(typeof grok.fetchAllConversations).toBe('function')
    expect(grok.getConversationListMeta?.()).toEqual({ source: 'sidebar', complete: false })
  })

  it('keeps ParserRuntimeParser as the same contract', () => {
    const runtimeView: ParserRuntimeParser = {} as ProviderParser
    const providerView: ProviderParser = runtimeView
    expect(providerView).toBe(runtimeView)
  })
})
