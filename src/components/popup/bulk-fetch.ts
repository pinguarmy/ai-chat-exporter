/**
 * Per-conversation detail fetch used by foreground bulk export: ask the
 * provider tab first, then (except for Claude) fall back to a background tab.
 */

import type { MutableRefObject } from 'react'
import { hasUsableConversation } from '../../lib/bulk-conversation'
import { throwIfExportCancelled } from '../../lib/export-cancel'
import type { Conversation, ConversationListItem } from '../../lib/types'

interface FetcherOptions {
  tabId: number
  signal: AbortSignal
  activeBackgroundFetchIdsRef: MutableRefObject<Set<string>>
  backgroundFetchSequenceRef: MutableRefObject<number>
}

export function createConversationFetcher({
  tabId,
  signal,
  activeBackgroundFetchIdsRef,
  backgroundFetchSequenceRef,
}: FetcherOptions) {
  return async (convItem: ConversationListItem): Promise<Conversation> => {
    throwIfExportCancelled(signal)
    let directError: string | null = null
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: 'FETCH_CONVERSATION_DETAIL',
        data: { id: convItem.id, title: convItem.title }
      })
      if (hasUsableConversation(response?.data as Conversation | null | undefined, convItem.id)) {
        return response.data as Conversation
      }
      directError = typeof response?.error === 'string' ? response.error : null
    } catch (error) {
      directError = error instanceof Error ? error.message : null
    }

    // Claude's page uses the same authoritative API path and its live DOM
    // is virtualized, so opening another tab cannot safely recover detail.
    // Skipping that fallback also prevents repeated API calls during a
    // provider outage or authentication failure.
    if (convItem.platform === 'claude') {
      throw new Error(directError || `Could not verify complete Claude content for ${convItem.title || 'this conversation'}`)
    }

    throwIfExportCancelled(signal)
    const requestId = `popup-detail-${Date.now()}-${++backgroundFetchSequenceRef.current}`
    activeBackgroundFetchIdsRef.current.add(requestId)
    try {
      const backgroundResponse = await chrome.runtime.sendMessage({
        type: 'FETCH_CONVERSATION_DETAIL_IN_BACKGROUND_TAB',
        data: { item: convItem, requestId }
      })
      throwIfExportCancelled(signal)
      if (hasUsableConversation(backgroundResponse?.data as Conversation | null | undefined, convItem.id)) {
        return backgroundResponse.data as Conversation
      }
    } finally {
      activeBackgroundFetchIdsRef.current.delete(requestId)
    }

    throw new Error(`Could not load real content for ${convItem.title || 'this conversation'}`)
  }
}
