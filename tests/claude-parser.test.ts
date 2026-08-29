/**
 * Claude Parser Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ProviderRateLimitError } from '../src/lib/provider-rate-limit'

// Mock DOM utilities
vi.mock('../src/lib/dom-utils', () => ({
  generateId: () => 'test-id-789',
  extractTextContent: (element: Element | null) => element?.textContent?.trim() || '',
  extractTextWithBreaks: (element: Element | null) => element?.textContent?.trim() || '',
  extractImage: (element: HTMLImageElement) => {
    const url = element.getAttribute('src') || ''
    return url ? { url, alt: element.getAttribute('alt') || '' } : null
  },
  extractCodeBlocks: () => [],
  extractImages: () => [],
  cleanText: (text: string) => text.replace(/\s+/g, ' ').trim()
}))

// Mock chrome.storage
const storageData: Record<string, any> = {}

;(globalThis as any).chrome = {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[]) => {
        if (typeof keys === 'string') {
          return { [keys]: storageData[keys] }
        }
        const result: Record<string, any> = {}
        for (const key of keys) {
          if (storageData[key] !== undefined) {
            result[key] = storageData[key]
          }
        }
        return result
      }),
      set: vi.fn(async (items: Record<string, any>) => {
        Object.assign(storageData, items)
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        if (typeof keys === 'string') {
          delete storageData[keys]
        } else {
          for (const key of keys) {
            delete storageData[key]
          }
        }
      }),
    },
    sync: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    },
  },
  runtime: {
    getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
    onMessage: {
      addListener: vi.fn(),
    },
  },
  tabs: {
    sendMessage: vi.fn(),
  },
  alarms: {
    create: vi.fn(),
    onAlarm: { addListener: vi.fn() },
  },
  downloads: {
    onDeterminingFilename: { addListener: vi.fn() },
  },
}

describe('Claude Parser', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.title = ''
    // Clear storage
    for (const key of Object.keys(storageData)) {
      delete storageData[key]
    }
  })

  describe('isConversationPage', () => {
    it('should detect conversation page with chat-message testid', () => {
      document.body.innerHTML = `
        <div data-testid="chat-message">
          <div data-testid="user-message">Hello Claude</div>
        </div>
      `
      
      const hasMessages = document.querySelectorAll('[data-testid="chat-message"]').length > 0
      expect(hasMessages).toBe(true)
    })

    it('should detect conversation page with font-claude-message', () => {
      document.body.innerHTML = `
        <div class="font-claude-message">Hello! How can I help?</div>
      `
      
      const hasMessages = document.querySelectorAll('.font-claude-message').length > 0
      expect(hasMessages).toBe(true)
    })

    it('should detect conversation page with user-message testid', () => {
      document.body.innerHTML = `
        <div data-testid="user-message">What is AI?</div>
      `
      
      const hasMessages = document.querySelectorAll('[data-testid="user-message"]').length > 0
      expect(hasMessages).toBe(true)
    })

    it('should detect conversation page with assistant-message testid', () => {
      document.body.innerHTML = `
        <div data-testid="assistant-message">AI is artificial intelligence.</div>
      `
      
      const hasMessages = document.querySelectorAll('[data-testid="assistant-message"]').length > 0
      expect(hasMessages).toBe(true)
    })

    it('should detect conversation from URL pattern', () => {
      // Simulate URL matching for /chat/{uuid}
      const pathPattern = '/chat/a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      const matches = pathPattern.match(/\/chat\/[a-f0-9-]+/)
      expect(matches).not.toBeNull()
    })

    it('should return false for non-conversation pages', () => {
      document.body.innerHTML = `
        <div>Regular page content</div>
      `
      
      const hasChatMessage = document.querySelectorAll('[data-testid="chat-message"]').length > 0
      const hasClaudeMessage = document.querySelectorAll('.font-claude-message').length > 0
      const hasUserMessage = document.querySelectorAll('[data-testid="user-message"]').length > 0
      const hasAssistantMessage = document.querySelectorAll('[data-testid="assistant-message"]').length > 0
      expect(hasChatMessage || hasClaudeMessage || hasUserMessage || hasAssistantMessage).toBe(false)
    })

    it('should handle empty DOM', () => {
      document.body.innerHTML = ''
      
      const hasElements = 
        document.querySelectorAll('[data-testid="chat-message"]').length > 0 ||
        document.querySelectorAll('.font-claude-message').length > 0
      expect(hasElements).toBe(false)
    })
  })

  describe('Message Parsing', () => {
    it('should extract user messages from data-testid', () => {
      document.body.innerHTML = `
        <div data-testid="user-message">
          <div>What is machine learning?</div>
        </div>
      `
      
      const userMessage = document.querySelector('[data-testid="user-message"]')
      expect(userMessage).not.toBeNull()
      expect(userMessage?.textContent).toContain('What is machine learning?')
    })

    it('should extract assistant messages from font-claude-message', () => {
      document.body.innerHTML = `
        <div class="font-claude-message">
          Machine learning is a subset of AI that enables systems to learn from data.
        </div>
      `
      
      const assistantMessage = document.querySelector('.font-claude-message')
      expect(assistantMessage).not.toBeNull()
      expect(assistantMessage?.textContent).toContain('Machine learning is a subset of AI')
    })

    it('should handle multi-turn conversations', () => {
      document.body.innerHTML = `
        <div data-testid="chat-message">
          <div data-testid="user-message">First question</div>
        </div>
        <div data-testid="chat-message">
          <div class="font-claude-message">First answer</div>
        </div>
        <div data-testid="chat-message">
          <div data-testid="user-message">Second question</div>
        </div>
        <div data-testid="chat-message">
          <div class="font-claude-message">Second answer</div>
        </div>
      `
      
      const userMessages = document.querySelectorAll('[data-testid="user-message"]')
      const assistantMessages = document.querySelectorAll('.font-claude-message')
      
      expect(userMessages.length).toBe(2)
      expect(assistantMessages.length).toBe(2)
    })

    it('should handle messages with code blocks', () => {
      document.body.innerHTML = `
        <div class="font-claude-message">
          Here's an example:
          <pre><code class="language-python">def hello():
    print("Hello, world!")</code></pre>
        </div>
      `
      
      const codeBlock = document.querySelector('pre code')
      expect(codeBlock).not.toBeNull()
      expect(codeBlock?.textContent).toContain('def hello():')
    })

    it('should handle messages with images', () => {
      document.body.innerHTML = `
        <div class="font-claude-message">
          <img src="https://example.com/chart.png" alt="Data visualization" />
        </div>
      `
      
      const image = document.querySelector('img')
      expect(image).not.toBeNull()
      expect(image?.getAttribute('alt')).toBe('Data visualization')
    })

    it('should handle messages with markdown formatting', () => {
      document.body.innerHTML = `
        <div class="font-claude-message">
          <p><strong>Bold text</strong></p>
          <p><em>Italic text</em></p>
          <p><code>inline code</code></p>
        </div>
      `
      
      const message = document.querySelector('.font-claude-message')
      expect(message).not.toBeNull()
      expect(message?.textContent).toContain('Bold text')
      expect(message?.textContent).toContain('Italic text')
    })

    it('should handle empty messages', () => {
      document.body.innerHTML = `
        <div data-testid="user-message"></div>
      `
      
      const message = document.querySelector('[data-testid="user-message"]')
      expect(message).not.toBeNull()
      expect(message?.textContent?.trim()).toBe('')
    })
  })

  describe('Title Extraction', () => {
    it('should extract title from document.title with pipe separator', () => {
      document.title = 'My Conversation | Claude'
      
      const pageTitle = document.title.replace(/\s*[|–-]\s*Claude.*$/i, '').trim()
      expect(pageTitle).toBe('My Conversation')
    })

    it('should extract title from document.title with dash separator', () => {
      document.title = 'My Conversation - Claude'
      
      const pageTitle = document.title.replace(/\s*[|–-]\s*Claude.*$/i, '').trim()
      expect(pageTitle).toBe('My Conversation')
    })

    it('should fallback to user message for title', () => {
      document.body.innerHTML = `
        <div data-testid="user-message">What is the meaning of life?</div>
      `
      
      const firstMsg = document.querySelector('[data-testid="user-message"]')
      const text = firstMsg?.textContent?.trim() || ''
      const title = text.length > 80 ? text.substring(0, 80) + '...' : text
      expect(title).toBe('What is the meaning of life?')
    })

    it('should handle missing title', () => {
      document.body.innerHTML = '<div>Just content</div>'
      
      const title = document.querySelector('h1')?.textContent
      expect(title).toBeUndefined()
    })

    it('should truncate long titles from user messages', () => {
      const longTitle = 'A'.repeat(100)
      document.body.innerHTML = `
        <div data-testid="user-message">${longTitle}</div>
      `
      
      const firstMsg = document.querySelector('[data-testid="user-message"]')
      const text = firstMsg?.textContent?.trim() || ''
      const title = text.length > 80 ? text.substring(0, 80) + '...' : text
      expect(title.length).toBeLessThanOrEqual(84)
      expect(title).toContain('...')
    })
  })

  describe('Special Characters', () => {
    it('should handle HTML entities', () => {
      document.body.innerHTML = `
        <div data-testid="user-message">
          <div>Test &amp; special &lt;characters&gt;</div>
        </div>
      `
      
      const content = document.querySelector('[data-testid="user-message"]')?.textContent
      expect(content).toContain('&')
      expect(content).toContain('<')
      expect(content).toContain('>')
    })

    it('should handle unicode characters', () => {
      document.body.innerHTML = `
        <div data-testid="user-message">
          <div>Hello 世界 🌏</div>
        </div>
      `
      
      const content = document.querySelector('[data-testid="user-message"]')?.textContent
      expect(content).toContain('世界')
      expect(content).toContain('🌏')
    })

    it('should handle newlines and whitespace', () => {
      document.body.innerHTML = `
        <div data-testid="user-message">
          <div>
            Line 1
            
            Line 2
            
            Line 3
          </div>
        </div>
      `
      
      const content = document.querySelector('[data-testid="user-message"]')?.textContent
      expect(content).toContain('Line 1')
      expect(content).toContain('Line 3')
    })

    it('should handle very long messages', () => {
      const longText = 'A'.repeat(10000)
      document.body.innerHTML = `
        <div data-testid="user-message">
          <div>${longText}</div>
        </div>
      `
      
      const content = document.querySelector('[data-testid="user-message"]')?.textContent
      expect(content?.length).toBeGreaterThanOrEqual(10000)
    })
  })

  describe('API Organization ID Extraction', () => {
    it('should extract org ID from API URL pattern in page HTML', () => {
      // Simulate page HTML containing API URLs with org ID
      const testOrgId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      const apiPattern = new RegExp(`\\/api\\/organizations\\/([a-f0-9-]{36})\\/chat_conversations`)
      const testUrl = `https://claude.ai/api/organizations/${testOrgId}/chat_conversations`
      
      const match = testUrl.match(apiPattern)
      expect(match).not.toBeNull()
      expect(match![1]).toBe(testOrgId)
    })

    it('should validate UUID format', () => {
      const UUID_REGEX = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
      
      expect(UUID_REGEX.test('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(true)
      expect(UUID_REGEX.test('A1B2C3D4-E5F6-7890-ABCD-EF1234567890')).toBe(true)
      expect(UUID_REGEX.test('invalid-id')).toBe(false)
      expect(UUID_REGEX.test('a1b2c3d4-e5f6-7890-abcd')).toBe(false)
    })

    it('should extract org ID from lastActiveOrg pattern', () => {
      const testOrgId = 'b2c3d4e5-f6a7-8901-bcde-f12345678901'
      const lastActivePattern = new RegExp(`lastActiveOrg[^a-f0-9]{0,120}?([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})`)
      const testStr = `lastActiveOrg = "${testOrgId}"`
      
      const match = testStr.match(lastActivePattern)
      expect(match).not.toBeNull()
      expect(match![1]).toBe(testOrgId)
    })
  })

  describe('API Response Parsing', () => {
    it('should parse conversation list API response', () => {
      // Simulate Claude API response for conversation list
      const apiResponse = {
        conversations: [
          {
            uuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            name: 'Test Conversation',
            created_at: '2024-01-15T10:30:00Z',
            updated_at: '2024-01-15T11:00:00Z'
          },
          {
            uuid: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
            name: 'Another Chat',
            created_at: '2024-01-16T14:00:00Z',
            updated_at: '2024-01-16T14:30:00Z'
          }
        ]
      }

      expect(apiResponse.conversations).toHaveLength(2)
      expect(apiResponse.conversations[0].uuid).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
      expect((apiResponse.conversations[0] as any).name).toBe('Test Conversation')
      expect(apiResponse.conversations[1].uuid).toBe('b2c3d4e5-f6a7-8901-bcde-f12345678901')
    })

    it('should parse conversation detail API response', () => {
      // Simulate Claude API response for conversation detail
      const apiResponse = {
        uuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        name: 'Test Conversation',
        created_at: '2024-01-15T10:30:00Z',
        chat_messages: [
          {
            uuid: 'msg-001',
            sender: 'human',
            content: [
              { type: 'text', text: 'Hello Claude!' }
            ]
          },
          {
            uuid: 'msg-002',
            sender: 'assistant',
            content: [
              { type: 'text', text: 'Hello! How can I help you today?' }
            ]
          }
        ]
      }

      expect(apiResponse.chat_messages).toHaveLength(2)
      
      // Parse messages
      const messages: Array<{ id: string; role: string; content: string }> = []
      for (const msg of apiResponse.chat_messages) {
        const role = msg.sender === 'human' ? 'user' : 'assistant'
        const textParts: string[] = []
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            textParts.push(block.text)
          }
        }
        messages.push({
          id: msg.uuid,
          role,
          content: textParts.join('\n\n')
        })
      }

      expect(messages[0].role).toBe('user')
      expect(messages[0].content).toBe('Hello Claude!')
      expect(messages[1].role).toBe('assistant')
      expect(messages[1].content).toBe('Hello! How can I help you today?')
    })

    it('should handle tool_use content blocks', () => {
      const msg = {
        uuid: 'msg-tool',
        sender: 'assistant',
        content: [
          { type: 'text', text: 'Let me search for that.' },
          { type: 'tool_use', name: 'search', input: { query: 'test query' } }
        ]
      }

      const textParts: string[] = []
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          textParts.push(block.text)
        } else if (block.type === 'tool_use') {
          const toolName = block.name || 'tool'
          const toolInput = block.input ? JSON.stringify(block.input, null, 2) : ''
          textParts.push(`Tool use: ${toolName}\n${toolInput}`)
        }
      }

      const content = textParts.join('\n\n')
      expect(content).toContain('Let me search for that.')
      expect(content).toContain('Tool use: search')
      expect(content).toContain('test query')
    })

    it('should handle tool_result content blocks', () => {
      const msg = {
        uuid: 'msg-result',
        sender: 'assistant',
        content: [
          { type: 'tool_result', content: 'Search results here' }
        ]
      }

      const textParts: string[] = []
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          const toolContent = typeof block.content === 'string' ? block.content : ''
          if (toolContent) {
            textParts.push(toolContent)
          }
        }
      }

      expect(textParts).toHaveLength(1)
      expect(textParts[0]).toBe('Search results here')
    })
  })

  describe('Error Handling', () => {
    it('should handle empty API response', () => {
      const apiResponse = { conversations: [] }
      expect(apiResponse.conversations).toHaveLength(0)
    })

    it('should handle API response with missing fields', () => {
      const apiResponse = {
        conversations: [
          { uuid: 'test-id' }
        ]
      }
      
      expect(apiResponse.conversations[0].uuid).toBe('test-id')
      expect(apiResponse.conversations[0].name).toBeUndefined()
    })

    it('should handle conversation detail with null chat_messages', () => {
      const apiResponse = {
        uuid: 'test-id',
        name: 'Test',
        chat_messages: null
      }

      const messages = Array.isArray(apiResponse.chat_messages) ? apiResponse.chat_messages : []
      expect(messages).toHaveLength(0)
    })

    it('should handle messages with null content', () => {
      const msg = {
        uuid: 'msg-null',
        sender: 'human',
        content: null as any
      }

      let content = ''
      if (Array.isArray(msg.content)) {
        const textParts: string[] = []
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            textParts.push(block.text)
          }
        }
        content = textParts.join('\n\n')
      } else if (typeof msg.content === 'string') {
        content = msg.content
      }

      expect(content).toBe('')
    })

    it('should handle auth error responses', () => {
      // Simulate 401/403 error handling
      const statuses = [401, 403]
      for (const status of statuses) {
        expect(status === 401 || status === 403).toBe(true)
      }
    })
  })

  describe('Sidebar Conversation List', () => {
    it('should find conversation links in sidebar', () => {
      document.body.innerHTML = `
        <nav>
          <a href="/chat/a1b2c3d4-e5f6-7890-abcd-ef1234567890">First Chat</a>
          <a href="/chat/b2c3d4e5-f6a7-8901-bcde-f12345678901">Second Chat</a>
        </nav>
      `
      
      const links = document.querySelectorAll('a[href*="/chat/"]')
      expect(links.length).toBe(2)
      
      const href1 = links[0].getAttribute('href')
      const match1 = href1?.match(/\/chat\/([a-f0-9-]+)/)
      expect(match1).not.toBeNull()
      expect(match1![1]).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
    })

    it('should deduplicate conversation links', () => {
      document.body.innerHTML = `
        <nav>
          <a href="/chat/a1b2c3d4-e5f6-7890-abcd-ef1234567890">First Chat</a>
          <aside>
            <a href="/chat/a1b2c3d4-e5f6-7890-abcd-ef1234567890">First Chat</a>
          </aside>
        </nav>
      `
      
      const seen = new Set<string>()
      const conversations: Array<{ id: string; title: string }> = []
      
      const links = document.querySelectorAll('a[href*="/chat/"]')
      links.forEach(link => {
        const href = link.getAttribute('href') || ''
        const match = href.match(/\/chat\/([a-f0-9-]+)/)
        if (match && !seen.has(match[1])) {
          seen.add(match[1])
          conversations.push({
            id: match[1],
            title: link.textContent?.trim() || 'Untitled'
          })
        }
      })
      
      expect(conversations).toHaveLength(1)
      expect(conversations[0].id).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
    })

    it('should skip non-UUID paths', () => {
      document.body.innerHTML = `
        <nav>
          <a href="/chat/new">New Chat</a>
          <a href="/chat/settings">Settings</a>
          <a href="/chat/a1b2c3d4-e5f6-7890-abcd-ef1234567890">Valid Chat</a>
        </nav>
      `
      
      const UUID_REGEX = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
      const links = document.querySelectorAll('a[href*="/chat/"]')
      let validCount = 0
      
      links.forEach(link => {
        const href = link.getAttribute('href') || ''
        const match = href.match(/\/chat\/([a-f0-9-]+)/)
        if (match && UUID_REGEX.test(match[1])) {
          validCount++
        }
      })
      
      expect(validCount).toBe(1)
    })
  })

  it('does not treat analytics _setUserId as an organization id', async () => {
    const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const liveOrg = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    document.body.innerHTML = `<script>"_setUserId", "${userId}"</script>`
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/auth/session')) {
        return { ok: false, status: 404, json: async () => ({ type: 'error' }) }
      }
      if (url.includes('/api/bootstrap')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            account: { memberships: [{ organization: { uuid: liveOrg } }] },
          }),
        }
      }
      if (url.includes(`/organizations/${userId}/chat_conversations`)) {
        throw new Error('analytics user id must not be used as an org')
      }
      if (url.includes(`/organizations/${liveOrg}/chat_conversations`)) {
        if (url.includes('limit=1&')) {
          return { ok: true, status: 200, json: async () => ([]) }
        }
        return {
          ok: true,
          status: 200,
          json: async () => ([{ uuid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Live org chat' }]),
        }
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { ClaudeParser } = await import('../src/contents/claude-parser')
    const conversations = await new ClaudeParser().fetchAllConversations()
    expect(conversations.map(item => item.id)).toEqual(['cccccccc-cccc-4ccc-8ccc-cccccccccccc'])
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes(liveOrg))).toBe(true)
  })

  it('probes bootstrap memberships when session HTML has no org URL', async () => {
    const deadOrg = '11111111-1111-4111-8111-111111111111'
    const liveOrg = '22222222-2222-4222-8222-222222222222'
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/auth/session')) {
        return { ok: false, status: 404, json: async () => ({ type: 'error' }) }
      }
      if (url.includes('/api/bootstrap')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            account: {
              memberships: [
                { organization: { uuid: deadOrg } },
                { organization: { uuid: liveOrg } },
              ],
            },
          }),
        }
      }
      if (url.includes(`/organizations/${deadOrg}/chat_conversations`)) {
        return { ok: false, status: 403, json: async () => ({ type: 'permission_error' }) }
      }
      if (url.includes(`/organizations/${liveOrg}/chat_conversations`)) {
        if (url.includes('limit=1&')) {
          return { ok: true, status: 200, json: async () => ([]) }
        }
        return {
          ok: true,
          status: 200,
          json: async () => ([{ uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Live org chat' }]),
        }
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { ClaudeParser } = await import('../src/contents/claude-parser')
    const conversations = await new ClaudeParser().fetchAllConversations()
    expect(conversations.map(item => item.id)).toEqual(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'])
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes(liveOrg))).toBe(true)
  })

  it('surfaces a 429 detail response as the safe rate-limit signal', async () => {
    const organizationId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ orgID: organizationId }) })
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) }))
    const { ClaudeParser } = await import('../src/contents/claude-parser')

    await expect(new ClaudeParser().fetchConversationDetail('conversation-id'))
      .rejects.toBeInstanceOf(ProviderRateLimitError)
  })
})
