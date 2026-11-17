/**
 * Account conversation list for Bulk Export: the list itself, its provenance
 * (complete vs partial), the current selection, and the bounded archive index
 * used to skip already-exported conversations.
 */

import { useRef, useState } from 'react'
import { readConversationHistory, withReadTimeout } from '../../../providers/provider-read'
import { dedupeSelectionIds } from '../../../core/bulk-selection'
import { t, type Locale, type MessageKey } from '../../../core/i18n'
import type { ConversationListItem } from '../../../core/types'
import {
  getConversationListLoadMeta,
  targetTabs,
  type ConversationListLoadMeta
} from '../popup-utils'
import type { HandoffRefs } from './useHandoffRefs'
import { sendBackgroundMessage } from '../../../platform/background-messages'

interface Options {
  locale: Locale
  handoff: HandoffRefs
  setHandoffNotice: (notice: string | null) => void
}

export function useConversationList({ locale, handoff, setHandoffNotice }: Options) {
  const [conversationList, setConversationList] = useState<ConversationListItem[]>([])
  const [conversationListMeta, setConversationListMeta] = useState<ConversationListLoadMeta | null>(
    null
  )
  const [conversationListNotice, setConversationListNotice] = useState<MessageKey | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkLoading, setBulkLoading] = useState(false)
  const [exportedConversationIds, setExportedConversationIds] = useState<string[]>([])
  const listSequenceRef = useRef(0)

  /** Drop everything tied to the previous tab's list (detection saw a new tab). */
  const resetForNewTab = () => {
    ++listSequenceRef.current
    setConversationList([])
    setSelectedIds([])
    setConversationListMeta(null)
    setConversationListNotice(null)
    setBulkLoading(false)
  }

  /** Fetch conversation list via API and preserve whether the list is complete. */
  const fetchConversationList = async () => {
    const sequence = ++listSequenceRef.current
    const isLatest = () => sequence === listSequenceRef.current
    setBulkLoading(true)
    setConversationListMeta(null)
    setConversationListNotice(null)
    try {
      const [tab] = await targetTabs()
      if (!tab?.id) return

      const applyList = async (
        list: ConversationListItem[],
        meta: ConversationListLoadMeta | null
      ) => {
        if (!isLatest()) return
        setConversationList(list)
        setConversationListMeta(meta)
        setSelectedIds(previous =>
          dedupeSelectionIds(previous.filter(id => list.some(item => item.id === id)))
        )
        // A restored workspace selection is only valid against the freshly
        // loaded list; report dropped ids instead of assuming they applied.
        const restored = handoff.restoredSelectionRef.current
        if (restored) {
          handoff.restoredSelectionRef.current = null
          const dropped = restored.filter(id => !list.some(item => item.id === id)).length
          if (dropped > 0) {
            setHandoffNotice(
              t(
                '{0} restored selection(s) are not in the refreshed list and were skipped.',
                locale,
                dropped
              )
            )
          }
        }
        await loadExportedConversationIds(list, isLatest)
      }

      const response = await readConversationHistory(type =>
        chrome.tabs.sendMessage(tab.id, { type })
      )
      if (!isLatest()) return
      if (response.meta?.authRequired) {
        setConversationListNotice('Sign in to the provider, then refresh the conversation list.')
      } else if (response.error === 'Provider read timed out') {
        setConversationListNotice(
          'History loading timed out. Showing only visible sidebar conversations; refresh to retry.'
        )
      }
      await applyList(
        response.data as ConversationListItem[],
        getConversationListLoadMeta(response.meta)
      )
    } catch {
      if (!isLatest()) return
      setConversationList([])
      setSelectedIds([])
      setConversationListMeta(null)
      setConversationListNotice(
        'History could not be loaded. Reload the provider page and refresh the list.'
      )
    } finally {
      if (isLatest()) setBulkLoading(false)
    }
  }

  /** Read the bounded archive index used to skip duplicate bulk selections. */
  const loadExportedConversationIds = async (
    list: ConversationListItem[],
    isLatest = () => true
  ) => {
    const sourcePlatform = list[0]?.platform
    if (!sourcePlatform) {
      setExportedConversationIds([])
      return
    }
    try {
      const response = await withReadTimeout(
        sendBackgroundMessage({
          type: 'GET_EXPORTED_CONVERSATION_IDS',
          data: sourcePlatform
        }),
        5_000
      )
      if (!isLatest()) return
      setExportedConversationIds(Array.isArray(response?.data) ? response.data : [])
    } catch {
      setExportedConversationIds([])
    }
  }

  return {
    conversationList,
    conversationListMeta,
    conversationListNotice,
    selectedIds,
    setSelectedIds,
    bulkLoading,
    exportedConversationIds,
    setExportedConversationIds,
    fetchConversationList,
    resetForNewTab
  }
}
