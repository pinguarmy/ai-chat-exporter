import type { ConversationListItem } from './types'
import { isProviderRateLimitError } from './provider-rate-limit'

/**
 * Safe, sanitized categories of bulk export failures.
 * Never includes private chat content, tokens, or raw provider errors.
 */
export type BulkFailureCategory =
  | 'rate_limited'
  | 'network_error'
  | 'verification_failed'
  | 'export_failed'
  | 'unknown'

export interface BulkFailedItem {
  id: string
  category: BulkFailureCategory
}

/**
 * Categorize errors safely into bounded buckets without leaking private transcript
 * content, authorization tokens, or raw provider error payloads.
 */
export function categorizeBulkError(error: unknown): BulkFailureCategory {
  if (!error) return 'unknown'
  if (isProviderRateLimitError(error)) return 'rate_limited'
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (/network|fetch|timeout|timed out|disconnect|offline|econnreset/i.test(message)) return 'network_error'
  if (/verif(?:y|ied|ication)|integrity|incomplete|unverified|real content|empty/i.test(message)) return 'verification_failed'
  if (/pdf|markdown|download|file|disk|write|blob/i.test(message)) return 'export_failed'
  return 'unknown'
}

/**
 * Filter the full conversation list to retrieve only items eligible for retry.
 */
export function getRetryableConversations(
  allConversations: readonly ConversationListItem[],
  failedItems: readonly BulkFailedItem[]
): ConversationListItem[] {
  const failedIdSet = new Set(failedItems.map(f => f.id))
  const seen = new Set<string>()
  return allConversations.filter(item => {
    if (!failedIdSet.has(item.id) || seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

/**
 * Reconcile failure records after a retry attempt.
 * Items that succeeded in this retry round are removed from the failed list.
 * Items that failed again are updated with their latest safe failure category.
 */
export function reconcileFailedItems(
  previousFailed: readonly BulkFailedItem[],
  succeededIds: readonly string[],
  newlyFailed: readonly BulkFailedItem[]
): BulkFailedItem[] {
  const succeededSet = new Set(succeededIds)
  const newlyFailedMap = new Map(newlyFailed.map(item => [item.id, item.category]))

  const resultMap = new Map<string, BulkFailureCategory>()
  for (const item of previousFailed) {
    if (!succeededSet.has(item.id)) {
      resultMap.set(item.id, item.category)
    }
  }

  for (const [id, category] of newlyFailedMap.entries()) {
    resultMap.set(id, category)
  }

  return Array.from(resultMap.entries()).map(([id, category]) => ({ id, category }))
}
