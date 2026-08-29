/**
 * Filename Generation Tests
 */

import { describe, it, expect } from 'vitest'
import { generateFilename, getDefaultPattern, FILENAME_PREVIEW_VARS, sanitizeFilename } from '../src/lib/filename'
import type { Conversation } from '../src/lib/types'

function localDate(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function localDateTime(timestamp: number): string {
  const date = new Date(timestamp)
  return `${localDate(timestamp)}T${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`
}

describe('Filename Generation', () => {
  it('treats a missing title as an empty filename instead of throwing', () => {
    expect(sanitizeFilename(undefined as unknown as string)).toBe('')
    expect(sanitizeFilename('Analysis: 2026/08/24 *Draft*')).toBe('Analysis-20260824-Draft')
  })

  const createConversation = (overrides: Partial<Conversation> = {}): Conversation => ({
    id: 'test-conv-1',
    title: 'Test Conversation',
    url: 'https://chatgpt.com/c/test',
    messages: [
      { id: 'msg-1', role: 'user', content: 'Hello' },
      { id: 'msg-2', role: 'assistant', content: 'Hi there' }
    ],
    platform: 'chatgpt',
    ...overrides
  })

  describe('generateFilename', () => {
    it('uses the conversation start date for the default date pattern', () => {
      const startedAt = new Date(2025, 2, 15, 10, 30, 0).getTime()
      const conv = createConversation({ createdAt: startedAt })
      const filename = generateFilename('{date}', conv)
      
      expect(filename).toBe(localDate(startedAt))
    })

    it('should generate filename with title pattern', () => {
      const conv = createConversation({ title: 'My Test Conversation' })
      const filename = generateFilename('{title}', conv)
      
      expect(filename).toBe('My-Test-Conversation')
    })

    it('should generate filename with platform pattern', () => {
      const conv = createConversation({ platform: 'chatgpt' })
      const filename = generateFilename('{platform}', conv)
      
      expect(filename).toBe('chatgpt')
    })

    it('should generate filename with msgcount pattern', () => {
      const conv = createConversation()
      const filename = generateFilename('{msgcount}', conv)
      
      expect(filename).toBe('2')
    })

    it('should generate filename with index pattern', () => {
      const conv = createConversation()
      const filename = generateFilename('{index}', conv, 5)
      
      expect(filename).toBe('005')
    })

    it('should generate filename with multiple patterns', () => {
      const conv = createConversation({ title: 'my-chat' })
      const filename = generateFilename('{date}-{platform}-{title}', conv)
      
      expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}-chatgpt-my-chat$/)
    })

    it('should handle long titles by truncating', () => {
      const conv = createConversation({ title: 'A'.repeat(300) })
      const filename = generateFilename('{title}', conv)
      
      expect(filename.length).toBeLessThanOrEqual(200)
    })

    it('should sanitize special characters', () => {
      const conv = createConversation({ title: 'Test: File (v2.0)! @#$%' })
      const filename = generateFilename('{title}', conv)
      
      // Only filesystem-unsafe chars are removed: <>:"/\|?* and control chars
      // Other chars like (), !, @, #, $, % are preserved
      expect(filename).not.toMatch(/[<>:"/\\|?*]/)
      expect(filename).toBe('Test-File-(v2.0)!-@#$%')
    })

    it('should preserve Chinese characters in title', () => {
      const conv = createConversation({ title: '父亲体检报告分析与病情评估' })
      const filename = generateFilename('{title}', conv)
      
      expect(filename).toBe('父亲体检报告分析与病情评估')
    })

    it('should preserve Japanese characters in title', () => {
      const conv = createConversation({ title: 'テスト会話' })
      const filename = generateFilename('{title}', conv)
      
      expect(filename).toBe('テスト会話')
    })

    it('should handle empty title by using first user message', () => {
      const conv = createConversation({ title: '' })
      const filename = generateFilename('{title}', conv)
      
      // Empty title falls back to first user message content (preserving case)
      expect(filename).toBe('Hello')
    })

    it('should handle empty title with no messages', () => {
      const conv = createConversation({ title: '', messages: [] })
      const filename = generateFilename('{title}', conv)
      
      expect(filename).toBe('untitled')
    })

    it('should handle Untitled Conversation title by using first user message', () => {
      const conv = createConversation({ title: 'Untitled Conversation' })
      const filename = generateFilename('{title}', conv)
      
      // Untitled Conversation falls back to first user message content (preserving case)
      expect(filename).toBe('Hello')
    })

    it('should handle missing index by defaulting to 000', () => {
      const conv = createConversation()
      const filename = generateFilename('{index}', conv)
      
      expect(filename).toBe('000')
    })

    it('should pad index to 3 digits', () => {
      const conv = createConversation()
      
      expect(generateFilename('{index}', conv, 1)).toBe('001')
      expect(generateFilename('{index}', conv, 42)).toBe('042')
      expect(generateFilename('{index}', conv, 123)).toBe('123')
    })
  })

  describe('getDefaultPattern', () => {
    it('should return default pattern', () => {
      const pattern = getDefaultPattern()
      
      expect(pattern).toBe('{date}-{title}')
    })
  })

  describe('FILENAME_PREVIEW_VARS', () => {
    it('should have all expected keys', () => {
      const conv = createConversation()
      
      expect(FILENAME_PREVIEW_VARS.date).toBeDefined()
      expect(FILENAME_PREVIEW_VARS.datetime).toBeDefined()
      expect(FILENAME_PREVIEW_VARS.end_date).toBeDefined()
      expect(FILENAME_PREVIEW_VARS.conv_date).toBeDefined()
      expect(FILENAME_PREVIEW_VARS.conv_datetime).toBeDefined()
      expect(FILENAME_PREVIEW_VARS.title).toBeDefined()
      expect(FILENAME_PREVIEW_VARS.platform).toBeDefined()
      expect(FILENAME_PREVIEW_VARS.index).toBeDefined()
      expect(FILENAME_PREVIEW_VARS.msgcount).toBeDefined()
    })

    it('generates the conversation start date preview', () => {
      const startedAt = new Date(2025, 2, 15, 10, 30, 0).getTime()
      const conv = createConversation({ createdAt: startedAt })
      const date = FILENAME_PREVIEW_VARS.date(conv)
      
      expect(date).toBe(localDate(startedAt))
    })

    it('generates the conversation start datetime preview', () => {
      const startedAt = new Date(2025, 2, 15, 10, 30, 5).getTime()
      const conv = createConversation({ createdAt: startedAt })
      const datetime = FILENAME_PREVIEW_VARS.datetime(conv)
      
      expect(datetime).toBe(localDateTime(startedAt))
    })

    it('keeps end_date as the export date', () => {
      const startedAt = new Date(2020, 2, 15, 10, 30, 0).getTime()
      const conv = createConversation({ createdAt: startedAt })
      const endDate = FILENAME_PREVIEW_VARS.end_date(conv)
      const date = FILENAME_PREVIEW_VARS.date(conv)
      
      expect(endDate).toBe(localDate(Date.now()))
      expect(endDate).not.toBe(date)
    })

    it('should generate conv_date preview from createdAt', () => {
      const conv = createConversation({ createdAt: new Date('2025-03-15T10:30:00Z').getTime() })
      const convDate = FILENAME_PREVIEW_VARS.conv_date(conv)
      
      expect(convDate).toBe('2025-03-15')
    })

    it('should generate conv_date fallback to current date when no createdAt', () => {
      const conv = createConversation()
      const convDate = FILENAME_PREVIEW_VARS.conv_date(conv)
      
      expect(convDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('should generate conv_datetime preview from createdAt', () => {
      const conv = createConversation({ createdAt: new Date('2025-03-15T10:30:00Z').getTime() })
      const convDatetime = FILENAME_PREVIEW_VARS.conv_datetime(conv)
      
      expect(convDatetime).toMatch(/^2025-03-15T/)
    })

    it('should generate title preview', () => {
      const conv = createConversation({ title: 'My Chat' })
      const title = FILENAME_PREVIEW_VARS.title(conv)
      
      expect(title).toBe('My-Chat')
    })

    it('should generate platform preview', () => {
      const conv = createConversation({ platform: 'gemini' })
      const platform = FILENAME_PREVIEW_VARS.platform(conv)
      
      expect(platform).toBe('gemini')
    })

    it('should generate index preview', () => {
      const conv = createConversation()
      const index = FILENAME_PREVIEW_VARS.index(conv)
      
      expect(index).toBe('001')
    })

    it('should generate msgcount preview', () => {
      const conv = createConversation()
      const msgcount = FILENAME_PREVIEW_VARS.msgcount(conv)
      
      expect(msgcount).toBe('2')
    })
  })

  describe('Conversation Date Tokens', () => {
    it('should use conv_date in filename pattern', () => {
      const conv = createConversation({ 
        title: 'My Test Conversation',
        createdAt: new Date('2025-01-20T08:00:00Z').getTime() 
      })
      const filename = generateFilename('{conv_date}-{title}', conv)
      
      expect(filename).toMatch(/^2025-01-20-My-Test-Conversation$/)
    })

    it('should use conv_datetime in filename pattern', () => {
      const conv = createConversation({ 
        title: 'My Test Conversation',
        createdAt: new Date('2025-01-20T08:00:00Z').getTime() 
      })
      const filename = generateFilename('{conv_datetime}-{title}', conv)
      
      // T is preserved now (no toLowerCase)
      expect(filename).toMatch(/^2025-01-20T\d{6}-My-Test-Conversation$/)
    })

    it('should use end_date in filename pattern', () => {
      const conv = createConversation({ title: 'My Test Conversation' })
      const filename = generateFilename('{end_date}-{title}', conv)
      
      expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}-My-Test-Conversation$/)
    })

    it('uses the first message timestamp when it predates createdAt', () => {
      const firstMessageAt = new Date(2024, 4, 10, 9, 15, 20).getTime()
      const createdAt = new Date(2024, 4, 12, 12, 0, 0).getTime()
      const conv = createConversation({
        createdAt,
        messages: [
          { id: 'later', role: 'assistant', content: 'Later', timestamp: createdAt },
          { id: 'first', role: 'user', content: 'First', timestamp: firstMessageAt },
        ],
      })

      expect(generateFilename('{date}-{datetime}-{conv_date}-{conv_datetime}', conv)).toBe(
        `${localDate(firstMessageAt)}-${localDateTime(firstMessageAt)}-${localDate(firstMessageAt)}-${localDateTime(firstMessageAt)}`
      )
    })

    it('should fallback conv_date to current date when no createdAt', () => {
      const conv = createConversation({ title: 'My Test Conversation' })
      const filename = generateFilename('{conv_date}-{title}', conv)
      
      expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}-My-Test-Conversation$/)
    })
  })
})
