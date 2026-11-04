/**
 * DeepSeek Parser Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ProviderRateLimitError } from '../src/lib/provider-rate-limit'
import { renderableMessageReferences } from '../src/lib/message-references'

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
      sourceCompleteness: 'unverified',
      verification: { transcript: { verified: false, method: 'provider-api-incomplete' } },
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

  describe('resolveDeepSeekMessageChain — parent_id chain traversal', () => {
    it('does not verify missing or invalid parent values or ambiguous duplicate IDs', async () => {
      ;(globalThis as any).chrome = { runtime: { onMessage: { addListener: vi.fn() } } }
      const { resolveDeepSeekMessageChain } = await import('../src/contents/deepseek-parser')
      const message = (parent_id: unknown) => ({ message_id: 1, parent_id, role: 'USER', fragments: [{ type: 'REQUEST', content: 'Synthetic' }] })
      for (const parent of [undefined, false, '', {}, NaN, Infinity]) {
        expect(resolveDeepSeekMessageChain([message(parent)], { current_message_id: 1 }).chainComplete).toBe(false)
      }
      const duplicate = [message(null), message(null)]
      expect(resolveDeepSeekMessageChain(duplicate, { current_message_id: 1 }).chainComplete).toBe(false)
      expect(resolveDeepSeekMessageChain([message(null), { ...message(null), message_id: 2 }, { ...message(null), message_id: 2 }], { current_message_id: 1 }).chainComplete).toBe(false)
    })

    it('follows current_message_id → parent_id chain and marks verified', async () => {
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
                id: 'sess-1',
                title: 'Chain test',
                current_message_id: 3,
                inserted_at: 1700003000,
              },
              chat_messages: [
                { message_id: 1, parent_id: null, role: 'USER', fragments: [{ type: 'REQUEST', content: 'Q1' }] },
                { message_id: 2, parent_id: 1, role: 'ASSISTANT', fragments: [{ type: 'RESPONSE', content: 'A1' }] },
                { message_id: 3, parent_id: 2, role: 'USER', fragments: [{ type: 'REQUEST', content: 'Q2' }] },
              ],
            },
          },
        }),
      })))

      const conversation = await new DeepSeekParser().fetchConversationDetail('sess-1')
      expect(conversation?.messages.map(m => [m.role, m.content])).toEqual([
        ['user', 'Q1'],
        ['assistant', 'A1'],
        ['user', 'Q2'],
      ])
      expect(conversation).toMatchObject({
        sourceCompleteness: 'verified',
        verification: { transcript: { verified: true, method: 'provider-api-complete' } },
      })
    })

    it('excludes sibling regeneration branches not on the selected chain', async () => {
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
              chat_session: { id: 'sess-2', current_message_id: 4 },
              chat_messages: [
                { message_id: 1, parent_id: null, role: 'USER', fragments: [{ type: 'REQUEST', content: 'Question' }] },
                { message_id: 2, parent_id: 1, role: 'ASSISTANT', fragments: [{ type: 'RESPONSE', content: 'First attempt' }] },
                { message_id: 3, parent_id: 1, role: 'ASSISTANT', fragments: [{ type: 'RESPONSE', content: 'Regenerated answer' }] },
                { message_id: 4, parent_id: 3, role: 'USER', fragments: [{ type: 'REQUEST', content: 'Follow-up' }] },
              ],
            },
          },
        }),
      })))

      const conversation = await new DeepSeekParser().fetchConversationDetail('sess-2')
      const contents = conversation?.messages.map(m => m.content) || []
      expect(contents).toEqual(['Question', 'Regenerated answer', 'Follow-up'])
      expect(contents).not.toContain('First attempt')
    })

    it('marks unverified when current_message_id points to missing message (broken link)', async () => {
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
              chat_session: { id: 'sess-3', current_message_id: 99 },
              chat_messages: [
                { message_id: 1, parent_id: null, role: 'USER', fragments: [{ type: 'REQUEST', content: 'Q' }] },
              ],
            },
          },
        }),
      })))

      const conversation = await new DeepSeekParser().fetchConversationDetail('sess-3')
      expect(conversation?.messages).toEqual([])
      expect(conversation).toMatchObject({
        sourceCompleteness: 'unverified',
        verification: { transcript: { verified: false } },
      })
    })

    it('marks unverified when parent_id chain has a cycle', async () => {
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
              chat_session: { id: 'sess-4', current_message_id: 2 },
              chat_messages: [
                { message_id: 1, parent_id: 2, role: 'USER', fragments: [{ type: 'REQUEST', content: 'Q' }] },
                { message_id: 2, parent_id: 1, role: 'ASSISTANT', fragments: [{ type: 'RESPONSE', content: 'A' }] },
              ],
            },
          },
        }),
      })))

      const conversation = await new DeepSeekParser().fetchConversationDetail('sess-4')
      expect(conversation).toMatchObject({
        sourceCompleteness: 'unverified',
        verification: { transcript: { verified: false, method: 'provider-api-incomplete' } },
      })
    })

    it('flat messages without parent_id/current_message_id fall back unverified', async () => {
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
                { message_id: 1, role: 'USER', fragments: [{ type: 'REQUEST', content: 'Q' }] },
                { message_id: 2, role: 'ASSISTANT', fragments: [{ type: 'RESPONSE', content: 'A' }] },
              ],
            },
          },
        }),
      })))

      const conversation = await new DeepSeekParser().fetchConversationDetail('test-id')
      expect(conversation?.messages.map(m => m.content)).toEqual(['Q', 'A'])
      expect(conversation).toMatchObject({
        sourceCompleteness: 'unverified',
        verification: { transcript: { verified: false, method: 'provider-api-incomplete' } },
      })
    })

    it('matches real fixture structure: integer message_id/parent_id with null root', async () => {
      ;(globalThis as any).chrome = {
        runtime: { onMessage: { addListener: vi.fn() } },
        storage: { local: { set: vi.fn() } },
      }
      const { DeepSeekParser } = await import('../src/contents/deepseek-parser')
      // Matches the real sanitized fixture shape exactly
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          msg: '',
          data: {
            biz_code: 0,
            biz_msg: '',
            biz_data: {
              chat_session: {
                id: 'id_fd5eb4ad',
                title: 'Sanitized conversation',
                title_type: 'generated',
                model_type: 'deepseek_chat',
                pinned: false,
                updated_at: 1700003180,
                seq_id: 209032185,
                agent: '',
                version: 2,
                is_empty: false,
                current_message_id: 1,
                inserted_at: 1700003000,
              },
              chat_messages: [
                {
                  message_id: 2,
                  parent_id: null,
                  model: '',
                  role: 'USER',
                  thinking_enabled: false,
                  ban_edit: false,
                  ban_regenerate: false,
                  status: 'pending',
                  incomplete_message: false,
                  accumulated_token_usage: 0,
                  feedback: '',
                  inserted_at: 1700003060,
                  search_enabled: false,
                  fragments: [{ type: 'REQUEST', content: 'User question' }],
                  has_pending_fragment: false,
                },
                {
                  message_id: 1,
                  parent_id: 2,
                  model: '',
                  role: 'ASSISTANT',
                  thinking_enabled: false,
                  ban_edit: false,
                  ban_regenerate: false,
                  status: 'pending',
                  incomplete_message: false,
                  accumulated_token_usage: 0,
                  feedback: '',
                  inserted_at: 1700003120,
                  search_enabled: false,
                  fragments: [{ type: 'RESPONSE', content: 'Assistant reply' }],
                  conversation_mode: '',
                },
              ],
              cache_control: '',
              cache_reset_at: 1700003240,
            },
          },
        }),
      })))

      const conversation = await new DeepSeekParser().fetchConversationDetail('id_fd5eb4ad')
      // Chain: current=1 → parent=2 → parent=null (root). Reversed: 2,1
      expect(conversation?.messages.map(m => [m.id, m.role, m.content])).toEqual([
        ['2', 'user', 'User question'],
        ['1', 'assistant', 'Assistant reply'],
      ])
      expect(conversation).toMatchObject({
        title: 'Sanitized conversation',
        modelName: 'deepseek_chat',
        sourceCompleteness: 'verified',
        verification: { transcript: { verified: true, method: 'provider-api-complete' } },
      })
    })
  })

  describe('extractDeepSeekWebReferences — TOOL_SEARCH source extraction', () => {
    it('applies reference privacy modes without including search metadata', async () => {
      ;(globalThis as any).chrome = { runtime: { onMessage: { addListener: vi.fn() } } }
      const { extractDeepSeekWebReferences } = await import('../src/contents/deepseek-parser')
      const refs = extractDeepSeekWebReferences({ fragments: [{ type: 'TOOL_SEARCH', queries: ['secret query'], results: [
        { title: 'Public', url: 'https://user:password@example.com/a', snippet: 'secret snippet' },
        { title: 'Private', url: 'https://docs.google.com/document/d/123', snippet: 'secret snippet' },
        { title: 'Public', url: 'https://example.com/a' },
      ] }, { type: 'THINK', content: 'secret thought' }] })
      expect(refs).toHaveLength(2)
      expect(JSON.stringify(refs)).not.toMatch(/secret|password/)
      expect(renderableMessageReferences(refs, 'off')).toEqual([])
      expect(renderableMessageReferences(refs, 'titles')).toEqual([{ title: 'Public' }, { title: 'Private' }])
      expect(renderableMessageReferences(refs, 'safe-links')).toEqual([{ title: 'Public', url: 'https://example.com/a' }, { title: 'Private' }])
    })

    it('extracts public web references from TOOL_SEARCH results', async () => {
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
              chat_session: { id: 's1', current_message_id: 2 },
              chat_messages: [
                {
                  message_id: 1, parent_id: null, role: 'USER',
                  fragments: [{ type: 'REQUEST', content: 'Search for X' }],
                },
                {
                  message_id: 2, parent_id: 1, role: 'ASSISTANT',
                  fragments: [
                    { type: 'THINK', content: 'hidden reasoning' },
                    {
                      type: 'TOOL_SEARCH',
                      content: null,
                      queries: [{ query: 'private search query' }],
                      results: [
                        { url: 'https://example.com/article', title: 'Example Article', snippet: 'A snippet', site_name: 'Example.com', cite_index: null, published_at: 1700000000, site_icon: '', query_indexes: [0], provider: null },
                        { url: 'https://docs.example.org/guide', title: 'Guide Page', snippet: 'Another snippet', site_name: 'Docs', cite_index: null, published_at: 1700000100, site_icon: '', query_indexes: [0], provider: null },
                      ],
                    },
                    { type: 'RESPONSE', content: 'Here is the answer with sources.' },
                  ],
                },
              ],
            },
          },
        }),
      })))

      const conversation = await new DeepSeekParser().fetchConversationDetail('s1')
      const assistant = conversation?.messages.find(m => m.role === 'assistant')
      expect(assistant?.references).toEqual([
        { type: 'web', title: 'Example Article', url: 'https://example.com/article', private: false, source: 'Example.com' },
        { type: 'web', title: 'Guide Page', url: 'https://docs.example.org/guide', private: false, source: 'Docs' },
      ])
      // User message should have no references
      const user = conversation?.messages.find(m => m.role === 'user')
      expect(user?.references).toBeUndefined()
      // THINK content and queries must not appear anywhere
      expect(JSON.stringify(conversation)).not.toContain('hidden reasoning')
      expect(JSON.stringify(conversation)).not.toContain('private search query')
    })

    it('flags private connector URLs in references', async () => {
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
              chat_session: { id: 's2', current_message_id: 2 },
              chat_messages: [
                { message_id: 1, parent_id: null, role: 'USER', fragments: [{ type: 'REQUEST', content: 'Q' }] },
                {
                  message_id: 2, parent_id: 1, role: 'ASSISTANT',
                  fragments: [
                    {
                      type: 'TOOL_SEARCH', content: null, queries: [],
                      results: [
                        { url: 'https://docs.google.com/document/d/123', title: 'Private Doc', snippet: '', site_name: '', cite_index: null, published_at: 0, site_icon: '', query_indexes: [], provider: null },
                      ],
                    },
                    { type: 'RESPONSE', content: 'Answer' },
                  ],
                },
              ],
            },
          },
        }),
      })))

      const conversation = await new DeepSeekParser().fetchConversationDetail('s2')
      const refs = conversation?.messages.find(m => m.role === 'assistant')?.references
      expect(refs).toEqual([
        expect.objectContaining({ type: 'web', title: 'Private Doc', private: true }),
      ])
    })

    it('skips results without valid HTTP URL or title', async () => {
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
              chat_session: { id: 's3', current_message_id: 2 },
              chat_messages: [
                { message_id: 1, parent_id: null, role: 'USER', fragments: [{ type: 'REQUEST', content: 'Q' }] },
                {
                  message_id: 2, parent_id: 1, role: 'ASSISTANT',
                  fragments: [
                    {
                      type: 'TOOL_SEARCH', content: null, queries: [],
                      results: [
                        { url: 'ftp://invalid.example.com', title: 'FTP Source', snippet: '' },
                        { url: '', title: 'No URL', snippet: '' },
                        { url: 'https://valid.example.com', title: '', snippet: '' },
                        { url: 'https://good.example.com', title: 'Good Source', snippet: '' },
                      ],
                    },
                    { type: 'RESPONSE', content: 'A' },
                  ],
                },
              ],
            },
          },
        }),
      })))

      const conversation = await new DeepSeekParser().fetchConversationDetail('s3')
      const refs = conversation?.messages.find(m => m.role === 'assistant')?.references
      expect(refs).toEqual([
        expect.objectContaining({ title: 'Good Source', url: 'https://good.example.com/' }),
      ])
    })

    it('deduplicates identical references', async () => {
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
              chat_session: { id: 's4', current_message_id: 2 },
              chat_messages: [
                { message_id: 1, parent_id: null, role: 'USER', fragments: [{ type: 'REQUEST', content: 'Q' }] },
                {
                  message_id: 2, parent_id: 1, role: 'ASSISTANT',
                  fragments: [
                    {
                      type: 'TOOL_SEARCH', content: null, queries: [],
                      results: [
                        { url: 'https://example.com/page', title: 'Same Page', snippet: '' },
                        { url: 'https://example.com/page', title: 'Same Page', snippet: '' },
                      ],
                    },
                    { type: 'RESPONSE', content: 'A' },
                  ],
                },
              ],
            },
          },
        }),
      })))

      const conversation = await new DeepSeekParser().fetchConversationDetail('s4')
      const refs = conversation?.messages.find(m => m.role === 'assistant')?.references
      expect(refs).toHaveLength(1)
    })
  })
})
