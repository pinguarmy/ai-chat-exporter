/**
 * Active-tab detection: which provider the bound tab is on and the verified,
 * exportable conversation read from it. Re-runs (debounced) when the tab
 * navigates, and only the latest request may commit state.
 */

import { useEffect, useRef, useState } from 'react'
import { withReadTimeout } from '../../../providers/provider-read'
import { requestPreviewSnapshot } from '../../../platform/preview-snapshots'
import { resolveConversationTitle } from '../../../core/conversation-title'
import type { Conversation } from '../../../core/types'
import { detectPlatformFromUrl, targetTabs, type Translate } from '../popup-utils'
import type { HandoffRefs } from './useHandoffRefs'

interface Options {
  T: Translate
  handoff: HandoffRefs
  resetListForNewTab: () => void
  setSuccess: (value: string | null) => void
  setExportNotice: (value: string | null) => void
  setExportResult: (value: string | null) => void
}

export function useCurrentConversation({
  T,
  handoff,
  resetListForNewTab,
  setSuccess,
  setExportNotice,
  setExportResult,
}: Options) {
  const [platform, setPlatform] = useState<string | null>(null)
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [currentReadError, setCurrentReadError] = useState<string | null>(null)
  const [noCurrentConversation, setNoCurrentConversation] = useState(false)
  // Content-script/API reads may resolve out of order while the active tab is
  // navigating. Only the latest detection request may commit popup state.
  const detectionSequenceRef = useRef(0)
  const detectedTabRef = useRef<number | null>(null)
  // The tab the popup is bound to (via ?sourceTab= or the active tab). Drives
  // the page-snapshot panel and immediate navigation invalidation.
  const [sourceTabId, setSourceTabId] = useState<number | undefined>(undefined)
  const sourceTabIdRef = useRef<number | undefined>(undefined)

  /** Detect the active provider and load a safe exportable conversation. */
  const detectPlatformAndConversation = async () => {
    const requestSequence = ++detectionSequenceRef.current
    const isLatestRequest = () => detectionSequenceRef.current === requestSequence
    setNoCurrentConversation(false)
    setCurrentReadError(null)
    let detected: ReturnType<typeof detectPlatformFromUrl> = null
    try {
      const [tab] = await targetTabs()
      if (!isLatestRequest() || !tab?.id || !tab.url) return

      // Bind the snapshot panel and the navigation guard to this tab before
      // any content-script round trip so mid-flight updates can invalidate.
      if (sourceTabIdRef.current !== tab.id) {
        sourceTabIdRef.current = tab.id
        setSourceTabId(tab.id)
      }

      if (detectedTabRef.current !== tab.id) {
        detectedTabRef.current = tab.id
        // A workspace hand-off restore owns the selection/list for this tab;
        // the detection reset must not wipe or supersede it, even when the
        // first detection resolves after the restore has already applied.
        if (handoff.handoffInflightRef.current || handoff.restoredSelectionRef.current || handoff.handoffResetSkipRef.current) {
          handoff.handoffResetSkipRef.current = false
        } else {
          resetListForNewTab()
        }
      }
      detected = detectPlatformFromUrl(tab.url)
      setPlatform(detected)
      setSuccess(null)
      setExportNotice(null)
      setExportResult(null)
      if (!detected) {
        setConversation(null)
        setCurrentReadError(null)
        return
      }

      // Popup reads are user-facing verification attempts. Bypass the short
      // background cooldown so Refresh actually retries the provider API.
      const response = await withReadTimeout(chrome.tabs.sendMessage(tab.id, {
        type: 'PARSE_CONVERSATION',
        data: { forceVerify: true }
      }))
      if (!isLatestRequest()) return

      if (response?.data) {
        // Resolve placeholder titles (empty/Untitled/UUID) once here, from the
        // already-fetched tab title or the first user message, so the heading,
        // filename preflight, preview hand-off and download all share the same
        // resolved conversation. No extra tab or network request is made.
        const resolvedConversation = resolveConversationTitle(response.data as Conversation, tab.title)
        setConversation(resolvedConversation)
        setCurrentReadError(null)
        // This cache is only a preview hand-off. Do not let its best-effort
        // storage write delay or supersede the latest visible conversation.
        void requestPreviewSnapshot(resolvedConversation).catch(() => undefined)
      } else if (response?.meta?.noConversation) {
        setConversation(null)
        setCurrentReadError(null)
        setNoCurrentConversation(true)
      } else {
        setConversation(null)
        setCurrentReadError(typeof response?.error === 'string' && response.error
          ? response.error
          : 'Conversation content could not be verified for export.')
      }
    } catch (err) {
      if (!isLatestRequest()) return
      setConversation(null)
      // Keep a correctly detected provider visible; a content-script/API error
      // must not masquerade as "No Chat Detected".
      if (!detected) setPlatform(null)
      setCurrentReadError(err instanceof Error ? err.message : T('Could not read this conversation.'))
    }
  }

  useEffect(() => {
    detectPlatformAndConversation()

    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const handleTabUpdate = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      // A navigation on the bound source tab invalidates the in-flight
      // detection immediately; waiting for the 300ms debounce would let a
      // stale parse commit results for a page that no longer exists. Updates
      // from other tabs must not reset this popup's detection state.
      if (tabId === sourceTabIdRef.current && (changeInfo.url !== undefined || changeInfo.status === 'loading')) {
        ++detectionSequenceRef.current
      }
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => detectPlatformAndConversation(), 300)
    }

    chrome.tabs.onUpdated.addListener(handleTabUpdate)
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      chrome.tabs.onUpdated.removeListener(handleTabUpdate)
    }
  }, [])

  return {
    platform,
    conversation,
    currentReadError,
    noCurrentConversation,
    sourceTabId,
    detectionSequenceRef,
    detectPlatformAndConversation,
  }
}
