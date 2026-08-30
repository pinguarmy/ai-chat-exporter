import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('provider parsers call production methods', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.title = ''
    window.history.replaceState({}, '', '/')
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => {}),
          remove: vi.fn(async () => {}),
        },
      },
      runtime: {
        onMessage: { addListener: vi.fn() },
        getURL: vi.fn((path: string) => path),
      },
      tabs: { sendMessage: vi.fn() },
      alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
      downloads: { onDeterminingFilename: { addListener: vi.fn() } },
    })
  })

  it.each([
    {
      name: 'ChatGPT',
      platform: 'chatgpt',
      path: '/c/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title: 'Smoke - ChatGPT',
      html: '<main><div data-message-author-role="user" data-message-id="u">Question</div><div data-message-author-role="assistant" data-message-id="a"><div class="markdown">Answer</div></div></main>',
      load: async () => (await import('../src/contents/chatgpt-parser')).ChatGPTParser,
    },
    {
      name: 'DeepSeek',
      platform: 'deepseek',
      path: '/a/chat/s/abc123-def456',
      title: 'Smoke - DeepSeek',
      html: '<main><div data-message-author-role="user" data-message-id="u">Question</div><div data-message-author-role="assistant" data-message-id="a">Answer</div></main>',
      load: async () => (await import('../src/contents/deepseek-parser')).DeepSeekParser,
    },
    {
      name: 'Grok',
      platform: 'grok',
      path: '/chat/non-hex-id',
      title: 'Smoke - Grok',
      html: '<main><div data-message-author-role="user" data-message-id="u">Question</div><div data-message-author-role="assistant" data-message-id="a">Answer</div></main>',
      load: async () => (await import('../src/contents/grok-parser')).GrokParser,
    },
    {
      name: 'Claude',
      platform: 'claude',
      path: '/chat/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title: 'Smoke | Claude',
      html: '<main><div data-testid="user-message">Question</div><div data-testid="assistant-message"><div class="prose">Answer</div></div></main>',
      load: async () => (await import('../src/contents/claude-parser')).ClaudeParser,
    },
    {
      name: 'Gemini',
      platform: 'gemini',
      path: '/app/gem_123',
      title: 'Smoke - Gemini',
      html: '<main><user-query>Question</user-query><model-response>Answer</model-response></main>',
      load: async () => (await import('../src/contents/gemini-parser')).GeminiParser,
    },
  ])('uses the $name parser instead of querying its fixture', async ({ load, platform, path, title, html }) => {
    window.history.replaceState({}, '', path)
    document.title = title
    document.body.innerHTML = html
    const Parser = await load()
    const parser = new Parser()
    expect(parser.isConversationPage()).toBe(true)
    await expect(parser.parseCurrentConversation()).resolves.toMatchObject({
      platform,
      title: 'Smoke',
      messages: [
        { role: 'user', content: 'Question' },
        { role: 'assistant', content: 'Answer' },
      ],
    })
    window.history.replaceState({}, '', '/')
    document.body.innerHTML = '<div>regular page</div>'
    document.title = 'regular page'
    expect(parser.isConversationPage()).toBe(false)
  })
})
