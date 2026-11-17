/**
 * Bulk selection rules: title search, date range, quantity cap, and the
 * handlers that turn them (or manual clicks) into a selection.
 */

import { useMemo, useState } from 'react'
import {
  normalizeBulkSelectionLimit,
  filterConversationsByTitle,
  toggleSingleSelection,
  toggleSelectAllVisible,
  applyBulkSelectionToFiltered,
} from '../../../core/bulk-selection'
import type { ConversationListItem, ExtensionSettings } from '../../../core/types'
import type { Translate } from '../popup-utils'

interface Options {
  T: Translate
  conversationList: ConversationListItem[]
  settings: ExtensionSettings | null
  exportedConversationIds: string[]
  setSelectedIds: (update: (previous: string[]) => string[]) => void
  setError: (error: string | null) => void
}

export function useBulkSelectionRules({
  T,
  conversationList,
  settings,
  exportedConversationIds,
  setSelectedIds,
  setError,
}: Options) {
  const [bulkFromDate, setBulkFromDate] = useState('')
  const [bulkToDate, setBulkToDate] = useState('')
  const [bulkSelectionLimit, setBulkSelectionLimit] = useState('100')
  const bulkDateRangeInvalid = Boolean(bulkFromDate && bulkToDate && bulkFromDate > bulkToDate)
  const [searchQuery, setSearchQuery] = useState('')
  const filteredConversations = useMemo(
    () => filterConversationsByTitle(conversationList, searchQuery),
    [conversationList, searchQuery]
  )

  const handleSelect = (id: string) => {
    setSelectedIds(prev => toggleSingleSelection(prev, id))
  }

  const handleToggleVisible = () => {
    setSelectedIds(prev => toggleSelectAllVisible(prev, filteredConversations))
  }

  const handleDeselectVisible = () => {
    const visibleSet = new Set(filteredConversations.map(c => c.id))
    setSelectedIds(prev => prev.filter(id => !visibleSet.has(id)))
  }

  const applyBulkSelection = () => {
    if (bulkDateRangeInvalid) {
      setError(T('The start date must be on or before the end date.'))
      return
    }
    setSelectedIds(prev => applyBulkSelectionToFiltered(prev, filteredConversations, {
      from: bulkFromDate || undefined,
      to: bulkToDate || undefined,
      limit: normalizeBulkSelectionLimit(Number(bulkSelectionLimit)),
      excludedIds: (settings?.skipAlreadyExported ?? true) ? exportedConversationIds : [],
    }))
    setError(null)
  }

  return {
    bulkFromDate, setBulkFromDate,
    bulkToDate, setBulkToDate,
    bulkSelectionLimit, setBulkSelectionLimit,
    bulkDateRangeInvalid,
    searchQuery, setSearchQuery,
    filteredConversations,
    handleSelect,
    handleToggleVisible,
    handleDeselectVisible,
    applyBulkSelection,
  }
}
