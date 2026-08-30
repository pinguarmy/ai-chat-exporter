/**
 * DeepSeek Parser Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ProviderRateLimitError } from '../src/lib/provider-rate-limit'

// Mock DOM utilities
vi.mock('../src/lib/dom-utils', () => ({
  generateId: () => 'test-id-deepseek',
  extractTextContent: (element: Element | null) => element?.textContent?.trim() || '',
  extractTextWithBreaks: (element: Element | null) => element?.textContent?.trim() || '',
  extractTextWithMedia: (element: Element | null) => element?.textContent?.trim() || '',
  extractCodeBlocks: () => [],
  extractImages: () => [],
  cleanText: (text: string) => text.replace(/\s+/g, ' ').trim(),
  stripProviderArtifacts: (text: string) => text,
}))

describe('DeepSeek Parser', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.title = ''
  })

  describe('isConversationPage', () => {
    it('should detect conversation page with data-message-author-role', () => {
      document.body.innerHTML = `
        <div data-message-author-role="user">Hello</div>
        <div data-message-author-role="assistant">Hi there</div>
      `
      
      const hasMessages = document.querySelectorAll('[data-message-author-role]').length > 0
      expect(hasMessages).toBe(true)
    })

    it('should detect conversation page with message classes', () => {
      document.body.innerHTML = `
        <div class="message-content">User message</div>
        <div class="message-content">Assistant response</div>
      `
      
      const hasMessages = document.querySelectorAll('[class*="message"]').length > 0
      expect(hasMessages).toBe(true)
    })

    it('should detect conversation page via URL pattern /a/chat/s/', () => {
      const pathname = '/a/chat/s/abc123-def456'
      const match = pathname.match(/\/a\/chat\/s\/[A-Za-z0-9_-]+/)
      expect(match).not.toBeNull()
    })

    it('should detect conversation page via URL pattern /chat/', () => {
      const pathname = '/chat/abc123def456'
      const match = pathname.match(/\/chat\/[A-Za-z0-9_-]+/)
      expect(match).not.toBeNull()
    })

    it('should return false for non-conversation pages', () => {
      document.body.innerHTML = `
        <div>Just a regular page</div>
      `
      
      const hasMessages = document.querySelectorAll('[data-message-author-role]').length > 0
      const hasMessageClasses = document.querySelectorAll('[class*="message"]').length > 0
      expect(hasMessages || hasMessageClasses).toBe(false)
    })

    it('should handle empty DOM', () => {
      document.body.innerHTML = ''
      
      const hasMessages = document.querySelectorAll('[data-message-author-role]').length > 0
      expect(hasMessages).toBe(false)
    })
  })

  describe('Message Parsing', () => {
    it('should extract user messages', () => {
      document.body.innerHTML = `
        <div data-message-author-role="user">
          <div class="content">Hello, how are you?</div>
        </div>
      `
      
      const userMessage = document.querySelector('[data-message-author-role="user"]')
      expect(userMessage).not.toBeNull()
      expect(userMessage?.textContent).toContain('Hello, how are you?')
    })

    it('should extract assistant messages', () => {
      document.body.innerHTML = `
        <div data-message-author-role="assistant">
          <div class="markdown">I'm doing well, thank you!</div>
        </div>
      `
      
      const assistantMessage = document.querySelector('[data-message-author-role="assistant"]')
      expect(assistantMessage).not.toBeNull()
      expect(assistantMessage?.textContent).toContain("I'm doing well, thank you!")
    })

    it('should handle messages with code blocks', () => {
      document.body.innerHTML = `
        <div data-message-author-role="assistant">
          <div class="markdown">
            Here's some code:
            <pre><code>const x = 1;</code></pre>
          </div>
        </div>
      `
      
      const codeBlock = document.querySelector('pre code')
      expect(codeBlock).not.toBeNull()
      expect(codeBlock?.textContent).toBe('const x = 1;')
    })

    it('should handle messages with images', () => {
      document.body.innerHTML = `
        <div data-message-author-role="assistant">
          <div class="markdown">
            <img src="https://example.com/image.png" alt="Test image" />
          </div>
        </div>
      `
      
      const image = document.querySelector('img')
      expect(image).not.toBeNull()
      expect(image?.getAttribute('src')).toBe('https://example.com/image.png')
    })

    it('should handle empty messages', () => {
      document.body.innerHTML = `
        <div data-message-author-role="user"></div>
      `
      
      const message = document.querySelector('[data-message-author-role="user"]')
      expect(message).not.toBeNull()
      expect(message?.textContent?.trim()).toBe('')
    })

    it('should handle multi-turn conversations', () => {
      document.body.innerHTML = `
        <div data-message-author-role="user">First question</div>
        <div data-message-author-role="assistant">First answer</div>
        <div data-message-author-role="user">Second question</div>
        <div data-message-author-role="assistant">Second answer</div>
      `
      
      const userMessages = document.querySelectorAll('[data-message-author-role="user"]')
      const assistantMessages = document.querySelectorAll('[data-message-author-role="assistant"]')
      
      expect(userMessages.length).toBe(2)
      expect(assistantMessages.length).toBe(2)
    })
  })

  describe('Title Extraction', () => {
    it('should extract title from document.title with DeepSeek suffix', () => {
      document.title = 'My Conversation Title - DeepSeek'
      
      const pageTitle = document.title.replace(/\s*[-–|]\s*DeepSeek.*$/i, '').trim()
      expect(pageTitle).toBe('My Conversation Title')
    })

    it('should extract title from document.title with pipe separator', () => {
      document.title = 'My Chat | DeepSeek'
      
      const pageTitle = document.title.replace(/\s*[-–|]\s*DeepSeek.*$/i, '').trim()
      expect(pageTitle).toBe('My Chat')
    })

    it('should fallback to first user message', () => {
      document.body.innerHTML = `
        <div data-message-author-role="user">
          <div>What is machine learning?</div>
        </div>
      `
      
      const firstUserMsg = document.querySelector('[data-message-author-role="user"]')
      const text = firstUserMsg?.textContent?.trim() || ''
      expect(text).toContain('What is machine learning?')
    })

    it('should handle missing title', () => {
      document.body.innerHTML = '<div>Just content</div>'
      
      const title = document.querySelector('h1')?.textContent
      expect(title).toBeUndefined()
    })
  })

  describe('Special Characters', () => {
    it('should handle HTML entities', () => {
      document.body.innerHTML = `
        <div data-message-author-role="user">
          <div>Test &amp; special &lt;characters&gt;</div>
        </div>
      `
      
      const content = document.querySelector('[data-message-author-role="user"]')?.textContent
      expect(content).toContain('&')
      expect(content).toContain('<')
      expect(content).toContain('>')
    })

    it('should handle unicode characters', () => {
      document.body.innerHTML = `
        <div data-message-author-role="user">
          <div>Hello 世界 🌍</div>
        </div>
      `
      
      const content = document.querySelector('[data-message-author-role="user"]')?.textContent
      expect(content).toContain('世界')
      expect(content).toContain('🌍')
    })

    it('should handle very long messages', () => {
      const longText = 'A'.repeat(10000)
      document.body.innerHTML = `
        <div data-message-author-role="user">
          <div>${longText}</div>
        </div>
      `
      
      const content = document.querySelector('[data-message-author-role="user"]')?.textContent
      expect(content?.length).toBeGreaterThanOrEqual(10000)
    })
  })

  describe('API URL Construction', () => {
    it('should construct correct conversation detail API URL', () => {
      const chatSessionId = 'abc123-def456-ghi789'
      const apiUrl = `https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=${chatSessionId}`
      
      expect(apiUrl).toContain('chat.deepseek.com')
      expect(apiUrl).toContain('api/v0/chat/history_messages')
      expect(apiUrl).toContain(`chat_session_id=${chatSessionId}`)
    })

    it('should extract chat_session_id from URL', () => {
      const pathname = '/a/chat/s/abc123-def456-012345'
      const match = pathname.match(/\/a\/chat\/s\/([A-Za-z0-9_-]+)/)
      
      expect(match).not.toBeNull()
      expect(match?.[1]).toBe('abc123-def456-012345')
    })

    it('should extract chat_session_id from /chat/ URL', () => {
      const pathname = '/chat/abc123def456'
      const match = pathname.match(/\/chat\/([A-Za-z0-9_-]+)/)
      
      expect(match).not.toBeNull()
      expect(match?.[1]).toBe('abc123def456')
    })

    it('should extract underscored DeepSeek session ids', () => {
      const pathname = '/a/chat/s/id_fd5eb4ad'
      const match = pathname.match(/\/a\/chat\/s\/([A-Za-z0-9_-]+)/)

      expect(match?.[1]).toBe('id_fd5eb4ad')
    })
  })

  describe('Domain Validation', () => {
    it('should match deepseek.com domain', () => {
      const url = new URL('https://deepseek.com/')
      expect(url.hostname).toBe('deepseek.com')
    })

    it('should match chat.deepseek.com domain', () => {
      const url = new URL('https://chat.deepseek.com/')
      expect(url.hostname).toBe('chat.deepseek.com')
    })

    it('should not match other domains', () => {
      const url = new URL('https://notdeepseek.com/')
      expect(url.hostname).not.toBe('deepseek.com')
      expect(url.hostname).not.toBe('chat.deepseek.com')
    })
  })

  it('marks a DeepSeek DOM snapshot as unverified', async () => {
    ;(globalThis as any).chrome = {
      runtime: { onMessage: { addListener: vi.fn() } },
      storage: { local: { set: vi.fn() } },
    }
    document.body.innerHTML = `
      <div data-message-author-role="user">Question</div>
      <div data-message-author-role="assistant">Answer</div>
    `
    const { DeepSeekParser } = await import('../src/contents/deepseek-parser')
    const conversation = await new DeepSeekParser().parseCurrentConversation()
    expect(conversation).toMatchObject({
      source: 'dom',
      sourceCompleteness: 'unverified',
      verification: { transcript: { verified: false, method: 'dom-unverified' } },
    })
  })

  it('keeps REQUEST/RESPONSE fragments and drops THINK/TOOL_SEARCH', async () => {
    ;(globalThis as any).chrome = {
      runtime: { onMessage: { addListener: vi.fn() } },
      storage: { local: { set: vi.fn() } },
    }
    const { DeepSeekParser } = await import('../src/contents/deepseek-parser')
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        data: {
          biz_data: {
            chat_messages: [
              {
                message_id: 1,
                role: 'USER',
                fragments: [{ type: 'REQUEST', content: 'Visible question' }],
              },
              {
                message_id: 2,
                role: 'ASSISTANT',
                fragments: [
                  { type: 'THINK', content: 'hidden chain of thought' },
                  { type: 'TOOL_SEARCH', content: null, queries: [{ query: 'private query' }] },
                  { type: 'RESPONSE', content: 'Visible answer' },
                ],
              },
            ],
          },
        },
      }),
    })))

    const conversation = await new DeepSeekParser().fetchConversationDetail('conversation-id')
    expect(conversation?.messages.map(message => [message.role, message.content])).toEqual([
      ['user', 'Visible question'],
      ['assistant', 'Visible answer'],
    ])
    expect(JSON.stringify(conversation)).not.toContain('hidden chain of thought')
    expect(JSON.stringify(conversation)).not.toContain('private query')
    expect(conversation).toMatchObject({
      source: 'api',
      sourceCompleteness: 'verified',
      verification: { transcript: { verified: true, method: 'provider-api-complete' } },
    })
  })

  it('extracts DeepSeek session metadata from the API envelope', async () => {
    ;(globalThis as any).chrome = {
      runtime: { onMessage: { addListener: vi.fn() } },
      storage: { local: { set: vi.fn() } },
    }
    const { DeepSeekParser } = await import('../src/contents/deepseek-parser')
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        data: {
          biz_data: {
            chat_session: {
              id: 'id_fd5eb4ad',
              title: 'DeepSeek Conversation Title',
              inserted_at: 1700003000,
              model_type: 'deepseek-chat',
            },
            chat_messages: [
              { message_id: 1, role: 'USER', fragments: [{ type: 'REQUEST', content: 'Hello' }] },
            ],
          },
        },
      }),
    })))

    const conversation = await new DeepSeekParser().fetchConversationDetail('id_fd5eb4ad')
    expect(conversation).toMatchObject({
      title: 'DeepSeek Conversation Title',
      createdAt: 1700003000000,
      modelName: 'deepseek-chat',
    })
  })

  it('preserves code indentation in DeepSeek API transcripts', async () => {
    ;(globalThis as any).chrome = {
      runtime: { onMessage: { addListener: vi.fn() } },
      storage: { local: { set: vi.fn() } },
    }
    const codeContent = '```python\ndef calculate():\n    if True:\n        return 42\n```'
    const { DeepSeekParser } = await import('../src/contents/deepseek-parser')
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        data: {
          biz_data: {
            chat_messages: [{
              message_id: 1,
              role: 'ASSISTANT',
              fragments: [{ type: 'RESPONSE', content: codeContent }],
            }],
          },
        },
      }),
    })))

    const conversation = await new DeepSeekParser().fetchConversationDetail('test-id')
    expect(conversation?.messages[0]?.content).toContain('    if True:\n        return 42')
  })

  it('does not truncate DeepSeek DOM paragraphs that use text-* classes', async () => {
    ;(globalThis as any).chrome = {
      runtime: { onMessage: { addListener: vi.fn() } },
      storage: { local: { set: vi.fn() } },
    }
    document.body.innerHTML = `
      <div data-message-author-role="assistant">
        <div class="content">
          <p>First paragraph of the response.</p>
          <p class="text-secondary">Second paragraph with text class.</p>
        </div>
      </div>
    `
    const { DeepSeekParser } = await import('../src/contents/deepseek-parser')
    const conversation = await new DeepSeekParser().parseCurrentConversation()
    expect(conversation?.messages[0]?.content).toContain('First paragraph of the response.')
    expect(conversation?.messages[0]?.content).toContain('Second paragraph with text class.')
  })

  it('marks a successful empty DeepSeek history as a complete API list', async () => {
    ;(globalThis as any).chrome = {
      runtime: { onMessage: { addListener: vi.fn() } },
      storage: { local: { set: vi.fn() } },
    }
    const { DeepSeekParser } = await import('../src/contents/deepseek-parser')
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        data: { biz_data: { chat_sessions: [], has_more: false } },
      }),
    })))

    const parser = new DeepSeekParser()
    const conversations = await parser.fetchAllConversations()
    expect(conversations).toEqual([])
    expect(parser.getConversationListMeta()).toMatchObject({ source: 'api', complete: true })
  })

  it('converts DeepSeek Unix-second list timestamps and keeps underscored session ids', async () => {
    ;(globalThis as any).chrome = {
      runtime: { onMessage: { addListener: vi.fn() } },
      storage: { local: { set: vi.fn() } },
    }
    const { DeepSeekParser } = await import('../src/contents/deepseek-parser')
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        data: {
          biz_data: {
            chat_sessions: [
              { id: 'id_fd5eb4ad', title: 'Synthetic title 1', created_at: 1700003180 },
            ],
            has_more: false,
          },
        },
      }),
    })))

    const parser = new DeepSeekParser()
    const conversations = await parser.fetchAllConversations()
    expect(conversations).toEqual([
      expect.objectContaining({
        id: 'id_fd5eb4ad',
        createdAt: 1700003180000,
        platform: 'deepseek',
      }),
    ])
    expect(parser.getConversationListMeta()).toMatchObject({ source: 'api', complete: true })
  })

  it('surfaces a 429 detail response as the safe rate-limit signal', async () => {
    ;(globalThis as any).chrome = {
      runtime: { onMessage: { addListener: vi.fn() } },
      storage: { local: { set: vi.fn() } },
    }
    const { DeepSeekParser } = await import('../src/contents/deepseek-parser')
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({}),
    })))

    await expect(new DeepSeekParser().fetchConversationDetail('conversation-id'))
      .rejects.toBeInstanceOf(ProviderRateLimitError)
  })
})
