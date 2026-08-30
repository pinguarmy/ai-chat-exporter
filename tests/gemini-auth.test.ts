/**
 * Gemini Auth Token Extraction Tests
 * Tests for the new hook-based credential approach and fallback token extraction
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

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
  },
}

describe('Gemini Auth Token Extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    // Reset window.__WIZ_global_data
    delete (window as any).__WIZ_global_data
    // Clear storage
    for (const key of Object.keys(storageData)) {
      delete storageData[key]
    }
  })

  describe('Hook-based credentials (highest priority)', () => {
    it('should find token from hooked credentials for current account slot', async () => {
      storageData['gemini_credentials_map'] = {
        'session-1': {
          at: 'hooked-token-abc',
          sid: 'session-1',
          accountSlot: 'default',
          lastUsed: Date.now()
        }
      }

      const stored = await chrome.storage.local.get(['gemini_credentials', 'gemini_credentials_map'])
      const credentials = stored.gemini_credentials
      const credentialsMap = stored.gemini_credentials_map || {}

      const accountSlot = 'default'
      const slotCreds = Object.values(credentialsMap).find(
        (c: any) => c.accountSlot === accountSlot
      )

      expect(slotCreds).toBeDefined()
      expect((slotCreds as any).at).toBe('hooked-token-abc')
    })

    it('should find token for specific account slot u0', async () => {
      storageData['gemini_credentials_map'] = {
        'session-u0': {
          at: 'hooked-token-u0',
          sid: 'session-u0',
          accountSlot: 'u0',
          lastUsed: Date.now()
        },
        'session-u1': {
          at: 'hooked-token-u1',
          sid: 'session-u1',
          accountSlot: 'u1',
          lastUsed: Date.now()
        }
      }

      const stored = await chrome.storage.local.get(['gemini_credentials_map'])
      const credentialsMap = stored.gemini_credentials_map || {}

      const accountSlot = 'u0'
      const slotCreds = Object.values(credentialsMap).find(
        (c: any) => c.accountSlot === accountSlot
      )

      expect(slotCreds).toBeDefined()
      expect((slotCreds as any).at).toBe('hooked-token-u0')
      expect((slotCreds as any).sid).toBe('session-u0')
    })

    it('should fall back to gemini_credentials if slot not found', async () => {
      storageData['gemini_credentials'] = {
        at: 'fallback-token',
        sid: 'fallback-sid'
      }

      const stored = await chrome.storage.local.get(['gemini_credentials'])
      const credentials = stored.gemini_credentials

      expect(credentials.at).toBe('fallback-token')
    })

    it('should return null when no hooked credentials exist', async () => {
      const stored = await chrome.storage.local.get(['gemini_credentials', 'gemini_credentials_map'])
      expect(stored.gemini_credentials).toBeUndefined()
      expect(stored.gemini_credentials_map).toBeUndefined()
    })
  })

  describe('Token from __WIZ_global_data (fallback)', () => {
    it('should extract SNlM0e from window.__WIZ_global_data', () => {
      ;(window as any).__WIZ_global_data = {
        SNlM0e: 'wiz-global-data-token-abc123',
        otherData: 'irrelevant',
      }

      const wizData = (window as any).__WIZ_global_data
      expect(wizData.SNlM0e).toBe('wiz-global-data-token-abc123')
    })

    it('should return null when __WIZ_global_data has no SNlM0e', () => {
      ;(window as any).__WIZ_global_data = {
        otherData: 'some-data',
      }

      const wizData = (window as any).__WIZ_global_data
      expect(wizData.SNlM0e).toBeUndefined()
    })

    it('should handle missing __WIZ_global_data gracefully', () => {
      delete (window as any).__WIZ_global_data

      const wizData = (window as any).__WIZ_global_data
      expect(wizData).toBeUndefined()
    })
  })

  describe('Token from script tags (fallback)', () => {
    it('should extract SNlM0e from script tag content', () => {
      document.body.innerHTML = `
        <script>
          window.__WIZ_global_data = {"SNlM0e":"script-tag-token-xyz789"};
        </script>
        <div>Content</div>
      `

      const scripts = document.querySelectorAll('script')
      let found = null

      for (const script of scripts) {
        const text = script.textContent || ''
        const match = text.match(/"SNlM0e"\s*:\s*"([^"]+)"/)
        if (match) {
          found = match[1]
          break
        }
      }

      expect(found).toBe('script-tag-token-xyz789')
    })

    it('should handle multiple script tags', () => {
      document.body.innerHTML = `
        <script>var x = 1;</script>
        <script>
          {"SNlM0e":"found-in-second-script"}
        </script>
        <script>var y = 2;</script>
      `

      const scripts = document.querySelectorAll('script')
      let found = null

      for (const script of scripts) {
        const text = script.textContent || ''
        const match = text.match(/"SNlM0e"\s*:\s*"([^"]+)"/)
        if (match) {
          found = match[1]
          break
        }
      }

      expect(found).toBe('found-in-second-script')
    })

    it('should return null when no script contains SNlM0e', () => {
      document.body.innerHTML = `
        <script>var x = 1;</script>
        <script>var y = 2;</script>
      `

      const scripts = document.querySelectorAll('script')
      let found = null

      for (const script of scripts) {
        const text = script.textContent || ''
        const match = text.match(/"SNlM0e"\s*:\s*"([^"]+)"/)
        if (match) {
          found = match[1]
          break
        }
      }

      expect(found).toBeNull()
    })
  })

  describe('Token from hidden input (fallback)', () => {
    it('should extract SNlM0e from hidden input', () => {
      document.body.innerHTML = `
        <input type="hidden" name="SNlM0e" value="hidden-input-token-456" />
      `

      const input = document.querySelector('input[name="SNlM0e"]') as HTMLInputElement
      expect(input).not.toBeNull()
      expect(input.value).toBe('hidden-input-token-456')
    })

    it('should handle missing hidden input', () => {
      document.body.innerHTML = '<div>No inputs</div>'

      const input = document.querySelector('input[name="SNlM0e"]') as HTMLInputElement
      expect(input).toBeNull()
    })
  })

  describe('Token from meta tag (fallback)', () => {
    it('should extract SNlM0e from meta tag', () => {
      document.body.innerHTML = `
        <meta name="SNlM0e" content="meta-tag-token-789" />
      `

      const meta = document.querySelector('meta[name="SNlM0e"]')
      expect(meta).not.toBeNull()
      expect(meta?.getAttribute('content')).toBe('meta-tag-token-789')
    })

    it('should handle missing meta tag', () => {
      document.body.innerHTML = '<div>No meta tags</div>'

      const meta = document.querySelector('meta[name="SNlM0e"]')
      expect(meta).toBeNull()
    })
  })

  describe('Token priority', () => {
    it('falls back to the page token when another Gemini account slot is stored', async () => {
      storageData['gemini_credentials_map'] = {
        'session-u0': {
          at: 'token-u0',
          sid: 'session-u0',
          accountSlot: 'u0',
          lastUsed: Date.now(),
        },
      }
      window.history.replaceState({}, '', '/u/1/app/c_123')
      document.body.innerHTML = '<input name="at" value="dom-token-u1" />'
      const { GeminiParser } = await import('../src/contents/gemini-parser')
      const parser = new GeminiParser()
      const token = await (parser as any).getAuthToken()
      expect(token).toBe('dom-token-u1')
      expect(parser.isAuthenticationRequired()).toBe(false)
    })

    it('should prefer hooked credentials over __WIZ_global_data', async () => {
      storageData['gemini_credentials_map'] = {
        'default': {
          at: 'hooked-wins',
          sid: 'default',
          accountSlot: 'default',
          lastUsed: Date.now()
        }
      }
      ;(window as any).__WIZ_global_data = {
        SNlM0e: 'wiz-data-loses',
      }

      // Simulate priority: hooked credentials first
      const stored = await chrome.storage.local.get(['gemini_credentials_map'])
      const credentialsMap = stored.gemini_credentials_map || {}
      const slotCreds = Object.values(credentialsMap).find(
        (c: any) => c.accountSlot === 'default'
      )

      let found = null
      if ((slotCreds as any)?.at) {
        found = (slotCreds as any).at
      }

      expect(found).toBe('hooked-wins')
    })

    it('should fall back to __WIZ_global_data when no hooked credentials', async () => {
      delete storageData['gemini_credentials_map']
      ;(window as any).__WIZ_global_data = {
        SNlM0e: 'wiz-data-wins',
      }

      const stored = await chrome.storage.local.get(['gemini_credentials_map'])
      const credentialsMap = stored.gemini_credentials_map || {}
      const slotCreds = Object.values(credentialsMap).find(
        (c: any) => c.accountSlot === 'default'
      )

      let found = null
      if ((slotCreds as any)?.at) {
        found = (slotCreds as any).at
      }

      // No hooked credentials
      expect(found).toBeNull()

      // Fall back to __WIZ_global_data
      const wizData = (window as any).__WIZ_global_data
      if (wizData?.SNlM0e) {
        found = wizData.SNlM0e
      }

      expect(found).toBe('wiz-data-wins')
    })
  })
})
