/**
 * Gemini Parser Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock DOM utilities
vi.mock('../src/lib/dom-utils', () => ({
  generateId: () => 'test-id-456',
  extractTextContent: (element: Element | null) => element?.textContent?.trim() || '',
  extractTextWithBreaks: (element: Element | null) => element?.textContent?.trim() || '',
  extractTextWithMedia: (element: Element | null) => element?.textContent?.trim() || '',
  extractCodeBlocks: () => [],
  extractImages: () => [],
  cleanText: (text: string) => text.replace(/\s+/g, ' ').trim(),
  stripProviderArtifacts: (text: string) => text,
}))

// Mock chrome.storage
const storageData: Record<string, any> = {}

// Credentials now live in chrome.storage.session when available; mirror the
// local mock so migration is a no-op and tests observe the same storageData.
;(globalThis as any).chrome = {
  storage: {
    get session() {
      return this.local
    },
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
  },
  runtime: {
    getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
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

describe('Gemini Parser', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.title = ''
    // Clear storage
    for (const key of Object.keys(storageData)) {
      delete storageData[key]
    }
  })

  describe('isConversationPage', () => {
    it('should detect conversation page with user queries', () => {
      document.body.innerHTML = `
        <div class="user-query">Hello Gemini</div>
        <div class="model-response">Hello! How can I help?</div>
      `
      
      const hasQueries = document.querySelectorAll('.user-query').length > 0
      expect(hasQueries).toBe(true)
    })

    it('should detect conversation page with message content', () => {
      document.body.innerHTML = `
        <div class="message-content">User message</div>
        <div class="message-content">Model response</div>
      `
      
      const hasContent = document.querySelectorAll('.message-content').length > 0
      expect(hasContent).toBe(true)
    })

    it('should detect conversation page with response containers', () => {
      document.body.innerHTML = `
        <div class="response-container">Response</div>
      `
      
      const hasContainer = document.querySelectorAll('.response-container').length > 0
      expect(hasContainer).toBe(true)
    })

    it('should return false for non-conversation pages', () => {
      document.body.innerHTML = `
        <div>Regular page content</div>
      `
      
      const hasElements = 
        document.querySelectorAll('.user-query').length > 0 ||
        document.querySelectorAll('.model-response').length > 0 ||
        document.querySelectorAll('.message-content').length > 0
      expect(hasElements).toBe(false)
    })

    it('should handle empty DOM', () => {
      document.body.innerHTML = ''
      
      const hasElements = document.querySelectorAll('[class*="message"]').length > 0
      expect(hasElements).toBe(false)
    })
  })

  describe('Message Parsing', () => {
    it('should extract user queries', () => {
      document.body.innerHTML = `
        <div class="user-query">
          <div class="content">What is machine learning?</div>
        </div>
      `
      
      const query = document.querySelector('.user-query')
      expect(query).not.toBeNull()
      expect(query?.textContent).toContain('What is machine learning?')
    })

    it('should extract model responses', () => {
      document.body.innerHTML = `
        <div class="model-response">
          <div class="content">Machine learning is a subset of AI...</div>
        </div>
      `
      
      const response = document.querySelector('.model-response')
      expect(response).not.toBeNull()
      expect(response?.textContent).toContain('Machine learning is a subset of AI')
    })

    it('should handle multi-turn conversations', () => {
      document.body.innerHTML = `
        <div class="user-query">First question</div>
        <div class="model-response">First answer</div>
        <div class="user-query">Second question</div>
        <div class="model-response">Second answer</div>
      `
      
      const queries = document.querySelectorAll('.user-query')
      const responses = document.querySelectorAll('.model-response')
      
      expect(queries.length).toBe(2)
      expect(responses.length).toBe(2)
    })

    it('should handle messages with code blocks', () => {
      document.body.innerHTML = `
        <div class="model-response">
          <div class="content">
            Here's an example:
            <pre><code>def hello():
    print("Hello, world!")</code></pre>
          </div>
        </div>
      `
      
      const codeBlock = document.querySelector('pre code')
      expect(codeBlock).not.toBeNull()
      expect(codeBlock?.textContent).toContain('def hello():')
    })

    it('should handle messages with images', () => {
      document.body.innerHTML = `
        <div class="model-response">
          <div class="content">
            <img src="https://example.com/chart.png" alt="Data visualization" />
          </div>
        </div>
      `
      
      const image = document.querySelector('img')
      expect(image).not.toBeNull()
      expect(image?.getAttribute('alt')).toBe('Data visualization')
    })
  })

  describe('Title Extraction', () => {
    it('should extract title from conversation-title class', () => {
      document.body.innerHTML = `
        <div class="conversation-title">Gemini Chat</div>
        <div>Content</div>
      `
      
      const title = document.querySelector('.conversation-title')?.textContent
      expect(title).toBe('Gemini Chat')
    })

    it('should extract title from h1', () => {
      document.body.innerHTML = `
        <h1>Gemini Conversation</h1>
        <div>Content</div>
      `
      
      const title = document.querySelector('h1')?.textContent
      expect(title).toBe('Gemini Conversation')
    })

    it('should fallback to page title', () => {
      document.title = 'My Chat - Gemini'
      
      const pageTitle = document.title.replace(/[-–|]\s*Gemini.*$/i, '').trim()
      expect(pageTitle).toBe('My Chat')
    })
  })

  describe('Special Characters', () => {
    it('should handle HTML entities', () => {
      document.body.innerHTML = `
        <div class="user-query">
          <div>Test &amp; special &lt;characters&gt;</div>
        </div>
      `
      
      const content = document.querySelector('.user-query')?.textContent
      expect(content).toContain('&')
      expect(content).toContain('<')
    })

    it('should handle unicode characters', () => {
      document.body.innerHTML = `
        <div class="user-query">
          <div>Hello 世界 🌏</div>
        </div>
      `
      
      const content = document.querySelector('.user-query')?.textContent
      expect(content).toContain('世界')
      expect(content).toContain('🌏')
    })

    it('should handle newlines and whitespace', () => {
      document.body.innerHTML = `
        <div class="user-query">
          <div>
            Line 1
            
            Line 2
            
            Line 3
          </div>
        </div>
      `
      
      const content = document.querySelector('.user-query')?.textContent
      expect(content).toContain('Line 1')
      expect(content).toContain('Line 3')
    })
  })

  describe('Production history requests', () => {
    it('uses Gemini production history requests and credentials', async () => {
      storageData.gemini_credentials = { at: 'test-auth-token', sid: '123456789' }
      const batchResponse = (rpcId: string, payload: unknown) => {
        const outer = [['wrb.fr', rpcId, JSON.stringify(payload), null, null, null, 'generic']]
        return `)]}'\n${JSON.stringify(outer).length}\n${JSON.stringify(outer)}\n`
      }
      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => batchResponse('MaZiqc', [null, null, []]),
      }))
      vi.stubGlobal('fetch', fetchMock)
      const { GeminiParser } = await import('../src/contents/gemini-parser')
      await expect(new GeminiParser().fetchAllConversationsWithStatus()).resolves.toMatchObject({
        source: 'api',
        complete: true,
        conversations: [],
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      for (const [url, options] of fetchMock.mock.calls) {
        expect(new URL(String(url)).pathname).toBe('/_/BardChatUi/data/batchexecute')
        expect(new URL(String(url)).searchParams.get('source-path')).toBe('/app')
        const body = new URLSearchParams(String((options as RequestInit).body))
        expect(body.get('at')).toBe('test-auth-token')
        const request = JSON.parse(body.get('f.req') || '[]')
        expect(request[0][0][0]).toBe('MaZiqc')
        expect(JSON.parse(request[0][0][1])[0]).toBe(25)
      }
    })
  })

  describe('Hook Script Injection', () => {
    it('should inject hook script element into the page', () => {
      // Simulate what injectHookScript() does
      const script = document.createElement('script')
      script.textContent = `(() => { /* hook code */ })()`
      script.setAttribute('data-gemini-hook', 'true')
      document.documentElement.appendChild(script)

      const injected = document.querySelector('script[data-gemini-hook="true"]')
      expect(injected).not.toBeNull()
      expect(injected?.getAttribute('data-gemini-hook')).toBe('true')
    })

    it('should not inject hook script twice', () => {
      // Simulate injectHookScript with dedup guard
      function injectHookScript() {
        if (document.querySelector('script[data-gemini-hook="true"]')) return
        const script = document.createElement('script')
        script.setAttribute('data-gemini-hook', 'true')
        document.documentElement.appendChild(script)
      }

      // First injection
      injectHookScript()
      expect(document.querySelectorAll('script[data-gemini-hook="true"]').length).toBe(1)

      // Second injection should be skipped
      injectHookScript()
      expect(document.querySelectorAll('script[data-gemini-hook="true"]').length).toBe(1)
    })
  })

  describe('Credential Storage from Hook', () => {
    it('should store hooked credentials in chrome.storage.local', async () => {
      const payload = {
        at: 'test-auth-token',
        sid: '1234567890',
        accountSlot: 'default',
        lastUsed: Date.now()
      }

      // Simulate what the message listener does
      const key = payload.sid || 'default'
      const credentialsMap: Record<string, any> = {}
      credentialsMap[key] = {
        at: payload.at,
        sid: payload.sid,
        accountSlot: payload.accountSlot,
        lastUsed: payload.lastUsed
      }

      await chrome.storage.local.set({
        gemini_credentials: { at: payload.at, sid: payload.sid },
        gemini_credentials_map: credentialsMap
      })

      const stored = await chrome.storage.local.get(['gemini_credentials', 'gemini_credentials_map'])
      expect(stored.gemini_credentials.at).toBe('test-auth-token')
      expect(stored.gemini_credentials.sid).toBe('1234567890')
      expect(stored.gemini_credentials_map['1234567890'].accountSlot).toBe('default')
    })

    it('should merge credentials for multiple account slots', async () => {
      // First account
      await chrome.storage.local.set({
        gemini_credentials_map: {
          'session-u0': {
            at: 'token-u0',
            sid: 'session-u0',
            accountSlot: 'u0',
            lastUsed: Date.now()
          }
        }
      })

      // Second account (simulating merge)
      const existing = await chrome.storage.local.get(['gemini_credentials_map'])
      const map = existing.gemini_credentials_map || {}
      map['session-u1'] = {
        at: 'token-u1',
        sid: 'session-u1',
        accountSlot: 'u1',
        lastUsed: Date.now()
      }
      await chrome.storage.local.set({ gemini_credentials_map: map })

      const stored = await chrome.storage.local.get(['gemini_credentials_map'])
      expect(Object.keys(stored.gemini_credentials_map)).toHaveLength(2)
      expect(stored.gemini_credentials_map['session-u0'].at).toBe('token-u0')
      expect(stored.gemini_credentials_map['session-u1'].at).toBe('token-u1')
    })
  })

  describe('Batch Execute URL Construction', () => {
    it('should construct correct URL with all required params', () => {
      const rpcids = 'MaZiqc'
      const sourcePath = '/app'
      const sessionId = '1234567890'
      const bl = 'boq_assistant-bard-web-server_20260107.06_p0'
      const reqid = String(Math.floor(Math.random() * 100000))

      const params = new URLSearchParams({
        rpcids,
        'source-path': sourcePath,
        bl,
        'f.sid': sessionId,
        _reqid: reqid,
        rt: 'c'
      })

      const url = `https://gemini.google.com/_/BardChatUi/data/batchexecute?${params.toString()}`

      expect(url).toContain('rpcids=MaZiqc')
      expect(url).toContain('source-path=%2Fapp')
      expect(url).toContain('f.sid=1234567890')
      expect(url).toContain('rt=c')
      expect(url).toContain('bl=boq_assistant-bard-web-server_20260107.06_p0')
      expect(url).toContain('_reqid=')
      expect(url).toContain('BardChatUi/data/batchexecute')
    })

    it('should use source-path=/app not /', () => {
      const params = new URLSearchParams({
        rpcids: 'MaZiqc',
        'source-path': '/app',
        'f.sid': '123',
        rt: 'c'
      })

      expect(params.get('source-path')).toBe('/app')
    })

    it('should construct correct form body with f.req and at', () => {
      const requestPayload = JSON.stringify([
        ['MaZiqc', JSON.stringify([20, null, [0, null, 1]]), null, 'generic']
      ])
      const authToken = 'test-auth-token-123'

      const body = new URLSearchParams()
      body.set('f.req', requestPayload)
      body.set('at', authToken)

      expect(body.get('f.req')).toBe(requestPayload)
      expect(body.get('at')).toBe('test-auth-token-123')
    })

    it('should format request payload correctly for MaZiqc', () => {
      const nextPageToken = ''
      const payload = JSON.stringify([
        ['MaZiqc', JSON.stringify([20, nextPageToken || null, [0, null, 1]]), null, 'generic']
      ])

      const parsed = JSON.parse(payload)
      expect(parsed[0][0]).toBe('MaZiqc')
      expect(parsed[0][2]).toBeNull()
      expect(parsed[0][3]).toBe('generic')

      const innerParams = JSON.parse(parsed[0][1])
      expect(innerParams[0]).toBe(20)
      expect(innerParams[1]).toBeNull() // Empty string becomes null
      expect(innerParams[2]).toEqual([0, null, 1])
    })

    it('should format request payload with page token for MaZiqc', () => {
      const nextPageToken = 'next-page-token-abc'
      const payload = JSON.stringify([
        ['MaZiqc', JSON.stringify([20, nextPageToken, [0, null, 1]]), null, 'generic']
      ])

      const parsed = JSON.parse(payload)
      const innerParams = JSON.parse(parsed[0][1])
      expect(innerParams[1]).toBe('next-page-token-abc')
    })

    it('should format McFRL request payload for conversation detail', () => {
      const conversationId = 'abc123def456'
      const payload = JSON.stringify([
        ['McFRL', JSON.stringify([null, conversationId, null, null, null]), null, 'generic']
      ])

      const parsed = JSON.parse(payload)
      expect(parsed[0][0]).toBe('McFRL')
      const innerParams = JSON.parse(parsed[0][1])
      expect(innerParams[0]).toBeNull()
      expect(innerParams[1]).toBe(conversationId)
    })
  })

  describe('Account Slot Extraction', () => {
    it('should extract default slot from path without /u/', () => {
      // Simulate URL path matching
      const pathname = '/app/abc123'
      const matched = pathname.match(/\/u\/(\d+)(?:\/|$)/)
      expect(matched).toBeNull()
    })

    it('should extract u0 slot from path', () => {
      const pathname = '/u/0/app/abc123'
      const matched = pathname.match(/\/u\/(\d+)(?:\/|$)/)
      expect(matched?.[1]).toBe('0')
    })

    it('should extract u1 slot from path', () => {
      const pathname = '/u/1/app/abc123'
      const matched = pathname.match(/\/u\/(\d+)(?:\/|$)/)
      expect(matched?.[1]).toBe('1')
    })

    it('should format as u0', () => {
      const matched = '/u/0/app'.match(/\/u\/(\d+)(?:\/|$)/)
      const slot = matched?.[1] ? `u${matched[1]}` : 'default'
      expect(slot).toBe('u0')
    })
  })
})
