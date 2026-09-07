import type { ConversationListItem } from './types'

export * from './bulk-retry'

export type BulkSelectionOrder = 'newest' | 'oldest'

export interface BulkSelectionCriteria {
  /** Inclusive local calendar day, formatted as YYYY-MM-DD. */
  from?: string
  /** Inclusive local calendar day, formatted as YYYY-MM-DD. */
  to?: string
  /** Maximum items to select after date filtering. */
  limit: number
  order?: BulkSelectionOrder
  /** IDs recorded as already exported; used only when the user opts in. */
  excludedIds?: Iterable<string>
}

const DATE_INPUT = /^\d{4}-\d{2}-\d{2}$/

/** Parse a date input as local midnight, avoiding the UTC shift from `new Date('YYYY-MM-DD')`. */
export function parseBulkCalendarDate(value: string | undefined, endOfDay = false): number | null {
  if (!value || !DATE_INPUT.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0)
  // Date normalizes overflow (for example, 2026-02-30) instead of rejecting
  // it, which would silently turn the user's requested date range into another
  // one. Validate the calendar fields after construction.
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null
  }
  return date.getTime()
}

export function normalizeBulkSelectionLimit(value: number): number {
  if (!Number.isFinite(value)) return 100
  return Math.min(500, Math.max(1, Math.floor(value)))
}

/**
 * Select a bounded, date-filtered subset. When a date range is supplied, an
 * item without a provider timestamp is deliberately excluded rather than
 * guessed: silently assigning it today's date would violate the filter. When
 * a provider exposes only activity metadata, use it transparently after an
 * exact creation date when available.
 */
export function selectBulkConversations(
  conversations: readonly ConversationListItem[],
  criteria: BulkSelectionCriteria
): ConversationListItem[] {
  const from = parseBulkCalendarDate(criteria.from)
  const to = parseBulkCalendarDate(criteria.to, true)
  const hasDateFilter = from !== null || to !== null
  const excluded = new Set(criteria.excludedIds ?? [])
  const direction = criteria.order === 'oldest' ? 1 : -1

  return conversations
    .filter(item => {
      if (excluded.has(item.id)) return false
      if (!hasDateFilter) return true
      const timestamp = Number.isFinite(item.createdAt)
        ? item.createdAt as number
        : Number.isFinite(item.updatedAt)
          ? item.updatedAt as number
          : undefined
      if (timestamp === undefined) return false
      return (from === null || timestamp >= from) && (to === null || timestamp <= to)
    })
    .slice()
    .sort((left, right) => {
      const leftTime = Number.isFinite(left.createdAt) ? left.createdAt as number
        : Number.isFinite(left.updatedAt) ? left.updatedAt as number : 0
      const rightTime = Number.isFinite(right.createdAt) ? right.createdAt as number
        : Number.isFinite(right.updatedAt) ? right.updatedAt as number : 0
      return (leftTime - rightTime) * direction
    })
    .slice(0, normalizeBulkSelectionLimit(criteria.limit))
}

/**
 * Filter conversations locally by title with case-insensitive substring matching.
 * Empty or whitespace-only query returns all conversations.
 */
export function filterConversationsByTitle(
  conversations: readonly ConversationListItem[],
  query: string
): ConversationListItem[] {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return conversations.slice()
  return conversations.filter(item => (item.title || '').toLowerCase().includes(trimmed))
}

/**
 * Deduplicate selection IDs preserving order.
 */
export function dedupeSelectionIds(ids: Iterable<string>): string[] {
  return Array.from(new Set(ids))
}

/**
 * Toggle selection of a single conversation ID with deduplication.
 */
export function toggleSingleSelection(allSelectedIds: readonly string[], id: string): string[] {
  const set = new Set(allSelectedIds)
  if (set.has(id)) {
    set.delete(id)
  } else {
    set.add(id)
  }
  return Array.from(set)
}

/**
 * Toggle select-all for currently visible (filtered) conversations.
 * If all visible items are already selected, deselect ONLY the visible items
 * (preserving selections that are hidden under other filters/queries).
 * Otherwise, select all visible items (unioning with existing selections and deduplicating).
 */
export function toggleSelectAllVisible(
  allSelectedIds: readonly string[],
  visibleConversations: readonly ConversationListItem[]
): string[] {
  const visibleIds = visibleConversations.map(c => c.id)
  if (visibleIds.length === 0) return dedupeSelectionIds(allSelectedIds)

  const selectedSet = new Set(allSelectedIds)
  const allVisibleSelected = visibleIds.every(id => selectedSet.has(id))

  if (allVisibleSelected) {
    const visibleSet = new Set(visibleIds)
    return allSelectedIds.filter(id => !visibleSet.has(id))
  } else {
    return dedupeSelectionIds([...allSelectedIds, ...visibleIds])
  }
}

/**
 * Apply date and limit criteria to current filtered results without clearing
 * selections from other filters. Selections for items outside `filteredConversations`
 * are strictly preserved.
 */
export function applyBulkSelectionToFiltered(
  allSelectedIds: readonly string[],
  filteredConversations: readonly ConversationListItem[],
  criteria: BulkSelectionCriteria
): string[] {
  const filteredIds = new Set(filteredConversations.map(c => c.id))
  // Keep selections from other filters (items not in current filtered view)
  const outsideSelectedIds = allSelectedIds.filter(id => !filteredIds.has(id))

  // Select matching items within the current filtered view
  const matching = selectBulkConversations(filteredConversations, criteria)
  const matchingIds = matching.map(c => c.id)

  return dedupeSelectionIds([...outsideSelectedIds, ...matchingIds])
}
