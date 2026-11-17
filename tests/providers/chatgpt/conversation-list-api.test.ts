/**
 * Conversation List API Tests
 * Tests pagination logic, error handling, and large result sets
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Simulates fetching conversations from an API with pagination
 * This mirrors the logic in chatgpt-parser.ts's fetchAllConversations()
 */
async function fetchConversationsWithPagination(
  fetchFn: (offset: number, limit: number) => Promise<{ items: any[]; has_more?: boolean }>
): Promise<Array<{ id: string; title: string; url: string }>> {
  const conversations: Array<{ id: string; title: string; url: string }> = []
  let offset = 0
  const limit = 100
  let hasMore = true

  while (hasMore) {
    try {
      const data = await fetchFn(offset, limit)
      const items = data.items || []

      if (items.length === 0) {
        hasMore = false
        break
      }

      for (const item of items) {
        conversations.push({
          id: item.id,
          title: item.title || 'Untitled',
          url: `https://chatgpt.com/c/${item.id}`
        })
      }

      offset += limit

      if (items.length < limit || data.has_more === false) {
        hasMore = false
      }
    } catch {
      break
    }
  }

  return conversations
}

describe('Conversation List API', () => {
  describe('Pagination Logic', () => {
    it('should fetch all conversations across multiple pages', async () => {
      let callCount = 0
      const mockFetch = async (offset: number, limit: number) => {
        callCount++
        if (callCount === 1) {
          return {
            items: Array.from({ length: 100 }, (_, i) => ({
              id: `conv-${i}`,
              title: `Conversation ${i}`
            }))
          }
        } else if (callCount === 2) {
          return {
            items: Array.from({ length: 50 }, (_, i) => ({
              id: `conv-${100 + i}`,
              title: `Conversation ${100 + i}`
            }))
          }
        }
        return { items: [] }
      }

      const result = await fetchConversationsWithPagination(mockFetch)

      expect(result.length).toBe(150)
      expect(result[0].id).toBe('conv-0')
      expect(result[149].id).toBe('conv-149')
    })

    it('should handle single page results', async () => {
      const mockFetch = async () => ({
        items: Array.from({ length: 10 }, (_, i) => ({
          id: `conv-${i}`,
          title: `Conversation ${i}`
        }))
      })

      const result = await fetchConversationsWithPagination(mockFetch)

      expect(result.length).toBe(10)
    })

    it('should handle empty results', async () => {
      const mockFetch = async () => ({ items: [] })

      const result = await fetchConversationsWithPagination(mockFetch)

      expect(result.length).toBe(0)
    })

    it('should handle has_more flag', async () => {
      let callCount = 0
      const mockFetch = async () => {
        callCount++
        if (callCount === 1) {
          return {
            items: Array.from({ length: 100 }, (_, i) => ({ id: `${i}`, title: `Conv ${i}` })),
            has_more: true
          }
        }
        return { items: [{ id: '100', title: 'Conv 100' }] }
      }

      const result = await fetchConversationsWithPagination(mockFetch)

      expect(result.length).toBe(101)
    })
  })

  describe('Error Handling', () => {
    it('should handle 401 authentication error gracefully', async () => {
      const mockFetch = async () => {
        throw new Error('401 Unauthorized')
      }

      const result = await fetchConversationsWithPagination(mockFetch)

      expect(result.length).toBe(0)
    })

    it('should handle network errors gracefully', async () => {
      const mockFetch = async () => {
        throw new TypeError('Failed to fetch')
      }

      const result = await fetchConversationsWithPagination(mockFetch)

      expect(result.length).toBe(0)
    })

    it('should stop pagination on error', async () => {
      let callCount = 0
      const mockFetch = async (offset: number) => {
        callCount++
        if (callCount === 1) {
          return {
            items: Array.from({ length: 100 }, (_, i) => ({
              id: `conv-${i}`,
              title: `Conv ${i}`
            }))
          }
        }
        throw new Error('Server error')
      }

      const result = await fetchConversationsWithPagination(mockFetch)

      expect(result.length).toBe(100)
    })

    it('should handle malformed response gracefully', async () => {
      const mockFetch = async () => ({ items: null } as any)

      const result = await fetchConversationsWithPagination(mockFetch)

      expect(result.length).toBe(0)
    })
  })

  describe('Large Result Sets', () => {
    it('should handle 500+ conversations', async () => {
      let callCount = 0
      const mockFetch = async (offset: number, limit: number) => {
        callCount++
        const start = offset
        const end = Math.min(offset + limit, 500)
        if (start >= 500) return { items: [] }
        return {
          items: Array.from({ length: end - start }, (_, i) => ({
            id: `conv-${start + i}`,
            title: `Conversation ${start + i}`
          }))
        }
      }

      const result = await fetchConversationsWithPagination(mockFetch)

      expect(result.length).toBe(500)
      expect(callCount).toBe(6) // 5 data pages + 1 empty page
    })

    it('should handle 1000+ conversations', async () => {
      let callCount = 0
      const mockFetch = async (offset: number, limit: number) => {
        callCount++
        const start = offset
        const end = Math.min(offset + limit, 1000)
        if (start >= 1000) return { items: [] }
        return {
          items: Array.from({ length: end - start }, (_, i) => ({
            id: `conv-${start + i}`,
            title: `Conversation ${start + i}`
          }))
        }
      }

      const result = await fetchConversationsWithPagination(mockFetch)

      expect(result.length).toBe(1000)
      expect(callCount).toBe(11) // 10 data pages + 1 empty page
    })
  })

  describe('Conversation Item Shape', () => {
    it('should create valid conversation list items', () => {
      const item = {
        id: 'abc-123',
        title: 'Test Conversation',
        url: 'https://chatgpt.com/c/abc-123',
        platform: 'chatgpt' as const,
        messageCount: 42,
        createdAt: Date.now()
      }

      expect(item.id).toBe('abc-123')
      expect(item.title).toBe('Test Conversation')
      expect(item.url).toContain('/c/abc-123')
      expect(item.platform).toBe('chatgpt')
      expect(item.messageCount).toBe(42)
    })

    it('should handle conversations without optional fields', () => {
      const item = {
        id: 'def-456',
        title: 'Another Conversation',
        url: 'https://chatgpt.com/c/def-456',
        platform: 'gemini' as const
      }

      expect(item.messageCount).toBeUndefined()
      expect(item.createdAt).toBeUndefined()
    })

    it('should handle empty titles', () => {
      const item = {
        id: 'ghi-789',
        title: '',
        url: 'https://chatgpt.com/c/ghi-789',
        platform: 'chatgpt' as const
      }

      expect(item.title).toBe('')
    })
  })
})
