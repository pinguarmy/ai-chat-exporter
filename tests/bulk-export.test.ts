/**
 * Bulk Export Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ConversationListItem, BulkExportProgress, Conversation } from '../src/lib/types'

describe('Bulk Export', () => {
  describe('ConversationListItem', () => {
    it('should create valid conversation list item', () => {
      const item: ConversationListItem = {
        id: 'abc-123',
        title: 'Test Conversation',
        url: 'https://chatgpt.com/c/abc-123',
        platform: 'chatgpt'
      }
      
      expect(item.id).toBe('abc-123')
      expect(item.title).toBe('Test Conversation')
      expect(item.url).toBe('https://chatgpt.com/c/abc-123')
      expect(item.platform).toBe('chatgpt')
    })

    it('should support both platforms', () => {
      const chatgptItem: ConversationListItem = {
        id: '1',
        title: 'Chat',
        url: 'https://chatgpt.com/c/1',
        platform: 'chatgpt'
      }
      
      const geminiItem: ConversationListItem = {
        id: '2',
        title: 'Gem',
        url: 'https://gemini.google.com/app/2',
        platform: 'gemini'
      }
      
      expect(chatgptItem.platform).toBe('chatgpt')
      expect(geminiItem.platform).toBe('gemini')
    })

    it('should handle empty title', () => {
      const item: ConversationListItem = {
        id: '1',
        title: '',
        url: 'https://chatgpt.com/c/1',
        platform: 'chatgpt'
      }
      
      expect(item.title).toBe('')
    })
  })

  describe('BulkExportProgress', () => {
    it('should create valid progress object', () => {
      const progress: BulkExportProgress = {
        total: 10,
        completed: 5,
        failed: 1,
        current: 'Testing conversation',
        status: 'exporting'
      }
      
      expect(progress.total).toBe(10)
      expect(progress.completed).toBe(5)
      expect(progress.failed).toBe(1)
      expect(progress.current).toBe('Testing conversation')
      expect(progress.status).toBe('exporting')
    })

    it('should support all status values', () => {
      const statuses: BulkExportProgress['status'][] = [
        'idle', 'fetching', 'exporting', 'done', 'error'
      ]
      
      statuses.forEach(status => {
        const progress: BulkExportProgress = {
          total: 0,
          completed: 0,
          failed: 0,
          current: '',
          status
        }
        expect(progress.status).toBe(status)
      })
    })

    it('should track completion correctly', () => {
      const progress: BulkExportProgress = {
        total: 5,
        completed: 5,
        failed: 0,
        current: '',
        status: 'done'
      }
      
      expect(progress.completed).toBe(progress.total)
      expect(progress.failed).toBe(0)
    })

    it('should track failures correctly', () => {
      const progress: BulkExportProgress = {
        total: 5,
        completed: 3,
        failed: 2,
        current: '',
        status: 'done'
      }
      
      expect(progress.completed + progress.failed).toBe(progress.total)
    })
  })

  describe('Select All Logic', () => {
    it('selects the bounded, ordered, unarchived production result', async () => {
      const { selectBulkConversations } = await import('../src/lib/bulk-selection')
      const items: ConversationListItem[] = [
        { id: '1', title: 'First', url: 'https://chatgpt.com/c/1', platform: 'chatgpt', createdAt: 300 },
        { id: '2', title: 'Second', url: 'https://chatgpt.com/c/2', platform: 'chatgpt', createdAt: 200 },
        { id: '3', title: 'Third', url: 'https://chatgpt.com/c/3', platform: 'chatgpt', createdAt: 100 },
      ]
      expect(selectBulkConversations(items, { limit: 2, order: 'oldest', excludedIds: ['2'] })
        .map(item => item.id)).toEqual(['3', '1'])
    })
  })

  describe('Export Loop', () => {
    it('runs real download and finalization for every selected conversation', async () => {
      const download = vi.fn().mockResolvedValue(1)
      const sendMessage = vi.fn().mockResolvedValue({})
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
      vi.stubGlobal('chrome', { downloads: { download }, runtime: { sendMessage } })
      const { downloadMarkdownFile, finalizeExport } = await import('../src/lib/export-download')
      const conversation = (id: string): Conversation => ({
        id,
        title: `Chat ${id}`,
        url: `https://chatgpt.com/c/${id}`,
        platform: 'chatgpt',
        messages: [
          { id: `${id}-u`, role: 'user', content: 'Question' },
          { id: `${id}-a`, role: 'assistant', content: 'Answer' },
        ],
      })
      for (const id of ['1', '2', '3']) {
        await downloadMarkdownFile(`# Chat ${id}`, { filename: `${id}.md`, saveAs: false })
        await finalizeExport(conversation(id), 'markdown', `${id}.md`)
      }
      expect(download).toHaveBeenCalledTimes(3)
      expect(download.mock.calls.map(([options]) => options.filename)).toEqual(['1.md', '2.md', '3.md'])
      expect(sendMessage).toHaveBeenCalledTimes(3)
      expect(sendMessage.mock.calls.map(([message]) => [message.type, message.data.filename]))
        .toEqual([['EXPORT_REQUEST', '1.md'], ['EXPORT_REQUEST', '2.md'], ['EXPORT_REQUEST', '3.md']])
    })
  })
})
