import { describe, expect, it } from 'vitest'
import {
  categorizeBulkError,
  getRetryableConversations,
  reconcileFailedItems,
  type BulkFailedItem,
} from '../src/lib/bulk-retry'
import type { ConversationListItem } from '../src/lib/types'

const createItem = (id: string, title?: string): ConversationListItem => ({
  id,
  title: title ?? `Conversation ${id}`,
  url: `https://chatgpt.com/c/${id}`,
  platform: 'chatgpt',
  createdAt: 1700000000000,
})

describe('bulk retry helpers', () => {
  describe('categorizeBulkError', () => {
    it('categorizes 429 and rate limit errors safely', () => {
      expect(categorizeBulkError(new Error('Rate limit exceeded: 429'))).toBe('rate_limited')
      expect(categorizeBulkError('rate limited by provider')).toBe('rate_limited')
      expect(categorizeBulkError(new Error('AI_CHAT_EXPORTER_RATE_LIMITED'))).toBe('rate_limited')
    })

    it('categorizes network and connection drops safely', () => {
      expect(categorizeBulkError(new Error('fetch failed: network timeout'))).toBe('network_error')
      expect(categorizeBulkError(new Error('ECONNRESET: socket hang up'))).toBe('network_error')
      expect(categorizeBulkError('Client is offline')).toBe('network_error')
    })

    it('categorizes transcript integrity and verification failures safely', () => {
      expect(categorizeBulkError(new Error('Conversation content could not be verified for export'))).toBe('verification_failed')
      expect(categorizeBulkError(new Error('Could not load real content for this conversation'))).toBe('verification_failed')
      expect(categorizeBulkError(new Error('Integrity check failed: incomplete message tree'))).toBe('verification_failed')
    })

    it('categorizes file writing and PDF/markdown formatting errors safely', () => {
      expect(categorizeBulkError(new Error('PDF generation failed'))).toBe('export_failed')
      expect(categorizeBulkError(new Error('download rejected by browser'))).toBe('export_failed')
      expect(categorizeBulkError(new Error('Failed to create file blob'))).toBe('export_failed')
    })

    it('defaults to unknown for unrecognized or empty errors without throwing', () => {
      expect(categorizeBulkError(null)).toBe('unknown')
      expect(categorizeBulkError(undefined)).toBe('unknown')
      expect(categorizeBulkError(new Error('Something unusual'))).toBe('unknown')
    })

    it('does not include private chat transcripts or raw messages in categorization', () => {
      const privateError = new Error('Secret discussion text: rate limit reached on user message "sensitive plan"')
      const category = categorizeBulkError(privateError)
      expect(category).toBe('rate_limited')
      // The return is strictly the enum category, preserving privacy invariants
      expect(typeof category).toBe('string')
      expect(category).not.toContain('sensitive')
    })
  })

  describe('getRetryableConversations', () => {
    it('filters full conversation list to exactly match failed IDs', () => {
      const items = [
        createItem('c1'),
        createItem('c2'),
        createItem('c3'),
        createItem('c4'),
      ]
      const failed: BulkFailedItem[] = [
        { id: 'c2', category: 'rate_limited' },
        { id: 'c4', category: 'verification_failed' },
      ]

      const retryable = getRetryableConversations(items, failed)
      expect(retryable.map(c => c.id)).toEqual(['c2', 'c4'])
    })

    it('returns empty list when no failed items exist', () => {
      const items = [createItem('c1'), createItem('c2')]
      expect(getRetryableConversations(items, [])).toEqual([])
    })

    it('silently ignores failed IDs not found in conversation list', () => {
      const items = [createItem('c1')]
      const failed: BulkFailedItem[] = [{ id: 'non-existent', category: 'unknown' }]
      expect(getRetryableConversations(items, failed)).toEqual([])
    })
  })

  describe('reconcileFailedItems', () => {
    it('removes succeeded items and updates newly failed items', () => {
      const initialFailed: BulkFailedItem[] = [
        { id: 'c1', category: 'rate_limited' },
        { id: 'c2', category: 'network_error' },
        { id: 'c3', category: 'export_failed' },
      ]

      // c1 succeeded; c2 failed again with rate_limited; c3 was not retried or remains
      const reconciled = reconcileFailedItems(
        initialFailed,
        ['c1'],
        [{ id: 'c2', category: 'rate_limited' }]
      )

      expect(reconciled).toEqual([
        { id: 'c2', category: 'rate_limited' },
        { id: 'c3', category: 'export_failed' },
      ])
    })

    it('clears all failures when all retried items succeed', () => {
      const initialFailed: BulkFailedItem[] = [
        { id: 'c1', category: 'network_error' },
        { id: 'c2', category: 'verification_failed' },
      ]

      const reconciled = reconcileFailedItems(initialFailed, ['c1', 'c2'], [])
      expect(reconciled).toEqual([])
    })

    it('preserves previous failure categories if neither succeeded nor re-failed', () => {
      const initialFailed: BulkFailedItem[] = [
        { id: 'c1', category: 'rate_limited' },
        { id: 'c2', category: 'network_error' },
      ]

      const reconciled = reconcileFailedItems(initialFailed, [], [])
      expect(reconciled).toEqual([
        { id: 'c1', category: 'rate_limited' },
        { id: 'c2', category: 'network_error' },
      ])
    })
  })

  describe('Modelized batch export and retry workflow', () => {
    interface SimulatedRunResult {
      completed: number
      failed: number
      completedIds: string[]
      failedItems: BulkFailedItem[]
      cancelled: boolean
    }

    function simulateExportLoop(
      conversations: ConversationListItem[],
      outcomes: Record<string, 'success' | 'rate_limit' | 'verification_fail' | 'cancel'>
    ): SimulatedRunResult {
      const completedIds: string[] = []
      const failedItems: BulkFailedItem[] = []
      let completed = 0
      let failed = 0
      let cancelled = false

      for (const conv of conversations) {
        const outcome = outcomes[conv.id] ?? 'success'
        if (outcome === 'cancel') {
          // User cancellation does NOT count as a failure
          cancelled = true
          break
        }

        try {
          if (outcome === 'rate_limit') {
            throw new Error('429 rate limited')
          }
          if (outcome === 'verification_fail') {
            throw new Error('Verification failed for transcript')
          }
          completed++
          completedIds.push(conv.id)
        } catch (err) {
          const category = categorizeBulkError(err)
          failedItems.push({ id: conv.id, category })
          failed++
        }
      }

      return { completed, failed, completedIds, failedItems, cancelled }
    }

    it('models initial run with failures followed by successful retry', () => {
      const items = [
        createItem('c1', 'Chat 1'),
        createItem('c2', 'Chat 2'),
        createItem('c3', 'Chat 3'),
        createItem('c4', 'Chat 4'),
      ]

      // Round 1: c1 and c4 succeed; c2 hits rate limit; c3 has verification failure
      const round1 = simulateExportLoop(items, {
        c1: 'success',
        c2: 'rate_limit',
        c3: 'verification_fail',
        c4: 'success',
      })

      expect(round1.completed).toBe(2)
      expect(round1.failed).toBe(2)
      expect(round1.completedIds).toEqual(['c1', 'c4'])
      expect(round1.failedItems).toEqual([
        { id: 'c2', category: 'rate_limited' },
        { id: 'c3', category: 'verification_failed' },
      ])
      expect(round1.cancelled).toBe(false)

      // Retry round: only failed items (c2, c3) are retried; c1 and c4 are skipped
      const retryItems = getRetryableConversations(items, round1.failedItems)
      expect(retryItems.map(c => c.id)).toEqual(['c2', 'c3'])

      // Round 2 (Retry): c2 succeeds now, c3 still fails
      const round2 = simulateExportLoop(retryItems, {
        c2: 'success',
        c3: 'verification_fail',
      })

      expect(round2.completed).toBe(1)
      expect(round2.failed).toBe(1)
      expect(round2.completedIds).toEqual(['c2'])

      // Reconcile overall failures
      const finalFailed = reconcileFailedItems(round1.failedItems, round2.completedIds, round2.failedItems)
      expect(finalFailed).toEqual([
        { id: 'c3', category: 'verification_failed' },
      ])
    })

    it('models user cancellation preserving previously completed files without counting abort as failure', () => {
      const items = [
        createItem('c1', 'Chat 1'),
        createItem('c2', 'Chat 2'),
        createItem('c3', 'Chat 3'),
      ]

      // c1 succeeds, c2 triggers user cancellation, c3 is not reached
      const run = simulateExportLoop(items, {
        c1: 'success',
        c2: 'cancel',
        c3: 'success',
      })

      expect(run.cancelled).toBe(true)
      expect(run.completed).toBe(1)
      expect(run.completedIds).toEqual(['c1']) // completed files are kept
      expect(run.failed).toBe(0) // cancellation is NOT counted as failure
      expect(run.failedItems).toEqual([])
    })
  })
})
