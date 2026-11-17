/**
 * Foreground bulk export (and retry of failed items), including the hand-off
 * to the background worker for plain Markdown runs.
 */

import { useCallback, useState } from 'react'
import { dedupeSelectionIds, categorizeBulkError, reconcileFailedItems, type BulkFailedItem } from '../../../core/bulk-selection'
import { exportConversationFile } from '../../../platform/export-download'
import { buildExportOptions } from '../../../core/export-options'
import { isExportCancelledError } from '../../../core/export-cancel'
import { analyzeConversationIntegrity, conversationIntegrityError, isConversationExportable } from '../../../core/conversation-integrity'
import { mergeExtensionSettings } from '../../../core/types'
import type { ManualExportJob } from '../../../platform/manual-export-job'
import type { BulkExportProgress, Conversation, ConversationListItem, ExportFormat, ExtensionSettings } from '../../../core/types'
import { createConversationFetcher } from '../bulk-fetch'
import { targetTabs, type Translate } from '../popup-utils'
import type { ExportRun } from './useExportRun'
import type { PopupStatus } from './usePopupStatus'
import { sendBackgroundMessage } from '../../../platform/background-messages'

interface Options {
  T: Translate
  format: ExportFormat
  settings: ExtensionSettings | null
  selectedIds: string[]
  conversationList: ConversationListItem[]
  exportedConversationIds: string[]
  setExportedConversationIds: (update: (previous: string[]) => string[]) => void
  setManualJob: (job: ManualExportJob | null) => void
  run: ExportRun
  status: PopupStatus
}

export function useBulkExport({
  T, format, settings, selectedIds, conversationList, exportedConversationIds,
  setExportedConversationIds, setManualJob, run, status,
}: Options) {
  const {
    setLoading, setStoppingExport, activeExportControllerRef,
    activeBackgroundFetchIdsRef, backgroundFetchSequenceRef,
  } = run
  const { setError, setSuccess, setExportNotice, setExportResult } = status
  const [bulkProgress, setBulkProgress] = useState<BulkExportProgress>({
    total: 0,
    completed: 0,
    failed: 0,
    current: '',
    status: 'idle'
  })
  const [bulkFailedItems, setBulkFailedItems] = useState<BulkFailedItem[]>([])

  /** Handle bulk export or retry of failed items. */
  const handleBulkExport = useCallback(async (retryTargets?: BulkFailedItem[]) => {
    const isRetry = Array.isArray(retryTargets) && retryTargets.length > 0
    const targetIds = isRetry
      ? dedupeSelectionIds(retryTargets.map(f => f.id))
      : dedupeSelectionIds(selectedIds)

    if (targetIds.length === 0) {
      setError(T('No conversations selected'))
      return
    }

    const targetConversations = targetIds
      .map(id => conversationList.find(conversation => conversation.id === id))
      .filter((conversation): conversation is ConversationListItem => !!conversation)

    if (targetConversations.length === 0) {
      setError(T('No conversations selected'))
      return
    }

    const skipAlreadyExported = settings?.skipAlreadyExported ?? true
    const eligibleConversations = (skipAlreadyExported && !isRetry)
      ? targetConversations.filter(item => !exportedConversationIds.includes(item.id))
      : targetConversations

    if (eligibleConversations.length === 0) {
      setError(T('All selected conversations are already archived. Turn off duplicate protection to export them again.'))
      return
    }

    // A new run supersedes every previous outcome — error, success, neutral
    // notice, current-chat receipt, stale progress/results. This reset must
    // happen before the background-job branch as well, which returns early.
    setError(null)
    setSuccess(null)
    setExportNotice(null)
    setExportResult(null)
    setBulkProgress({
      total: 0,
      completed: 0,
      failed: 0,
      current: '',
      status: 'idle'
    })
    // A retry keeps its failed list visible until the fresh results are
    // reconciled against it at the end of the run.
    if (!isRetry) {
      setBulkFailedItems([])
    }

    if (format === 'markdown' && !settings?.askForSaveLocation) {
      setLoading(true)
      try {
        const result = await sendBackgroundMessage({ type: 'START_MANUAL_EXPORT', data: { items: eligibleConversations, settings: mergeExtensionSettings(settings || {}) } })
        if (result?.error) throw new Error(result.error)
        setManualJob(result!.data)
      } catch (err) { setError(err instanceof Error ? err.message : T('Export failed')) }
      finally { setLoading(false) }
      return
    }
    const controller = new AbortController()
    activeExportControllerRef.current = controller
    setLoading(true)
    setStoppingExport(false)

    setBulkProgress({
      total: eligibleConversations.length,
      completed: 0,
      failed: 0,
      current: '',
      status: 'fetching'
    })

    try {
      const [tab] = await targetTabs()
      if (!tab?.id) throw new Error('No active tab')

      const exportOptions = buildExportOptions(format, settings ?? undefined)
      if (format === 'pdf') exportOptions.pdfRenderMode = 'bulk'

      const fetchConversation = createConversationFetcher({
        tabId: tab.id,
        signal: controller.signal,
        activeBackgroundFetchIdsRef,
        backgroundFetchSequenceRef,
      })

      const startConversationFetch = async (convItem: ConversationListItem): Promise<{
        conversation?: Conversation
        error?: unknown
      }> => {
        try {
          return { conversation: await fetchConversation(convItem) }
        } catch (error) {
          return { error }
        }
      }

      let currentConversationFetch = startConversationFetch(eligibleConversations[0])
      const newlyCompletedIds: string[] = []
      const newlyFailedItems: BulkFailedItem[] = []
      let completed = 0
      let failed = 0
      let cancelled = false
      for (let i = 0; i < eligibleConversations.length; i++) {
        if (controller.signal.aborted) {
          cancelled = true
          break
        }

        const convItem = eligibleConversations[i]
        setBulkProgress(prev => ({ ...prev, current: convItem.title, status: 'exporting' }))

        let nextConversationFetch: Promise<{ conversation?: Conversation; error?: unknown }> | null = null
        try {
          const result = await currentConversationFetch
          if (controller.signal.aborted) {
            cancelled = true
            break
          }
          nextConversationFetch = i + 1 < eligibleConversations.length
            ? startConversationFetch(eligibleConversations[i + 1])
            : null
          if (result.error) throw result.error
          if (!result.conversation) throw new Error(`Could not load real content for ${convItem.title || 'this conversation'}`)

          const conv = result.conversation
          const integrity = analyzeConversationIntegrity(conv)
          if (!isConversationExportable(conv)) throw new Error(conversationIntegrityError(integrity))

          await exportConversationFile(conv, exportOptions, settings ?? undefined, { signal: controller.signal, index: i + 1 })

          setBulkProgress(prev => ({ ...prev, completed: prev.completed + 1 }))
          completed++
          newlyCompletedIds.push(conv.id)
          setExportedConversationIds(previous => previous.includes(conv.id) ? previous : [...previous, conv.id])
          currentConversationFetch = nextConversationFetch ?? currentConversationFetch
        } catch (err) {
          if (controller.signal.aborted || isExportCancelledError(err)) {
            cancelled = true
            break
          }
          const category = categorizeBulkError(err)
          newlyFailedItems.push({ id: convItem.id, category })
          setBulkProgress(prev => ({ ...prev, failed: prev.failed + 1 }))
          failed++
          currentConversationFetch = nextConversationFetch ?? (i + 1 < eligibleConversations.length
            ? startConversationFetch(eligibleConversations[i + 1])
            : currentConversationFetch)
        }
      }

      if (isRetry) {
        setBulkFailedItems(prev => reconcileFailedItems(prev, newlyCompletedIds, newlyFailedItems))
      } else {
        setBulkFailedItems(newlyFailedItems)
      }

      if (cancelled) {
        setBulkProgress(prev => ({ ...prev, status: 'cancelled', current: '' }))
        setExportNotice(T('Export stopped. Completed files were kept.'))
      } else if (completed === 0 && failed > 0) {
        setBulkProgress(prev => ({ ...prev, status: 'error' }))
        setError(T('Bulk export failed'))
      } else {
        setBulkProgress(prev => ({ ...prev, status: 'done' }))
        setSuccess(failed > 0 ? T('Bulk export completed with some failures.') : T('Bulk export completed!'))
      }
    } catch (err) {
      if (controller.signal.aborted || isExportCancelledError(err)) {
        setBulkProgress(prev => ({ ...prev, status: 'cancelled', current: '' }))
        setExportNotice(T('Export stopped. Completed files were kept.'))
      } else {
        setBulkProgress(prev => ({ ...prev, status: 'error' }))
        setError(err instanceof Error ? err.message : T('Bulk export failed'))
      }
    } finally {
      if (activeExportControllerRef.current === controller) activeExportControllerRef.current = null
      activeBackgroundFetchIdsRef.current.clear()
      setStoppingExport(false)
      setLoading(false)
    }
  }, [
    selectedIds, conversationList, format, settings, exportedConversationIds, T,
    // Stable state setters and refs, listed for completeness.
    setLoading, setStoppingExport, activeExportControllerRef, activeBackgroundFetchIdsRef, backgroundFetchSequenceRef,
    setError, setSuccess, setExportNotice, setExportResult, setExportedConversationIds, setManualJob,
  ])

  const handleRetryFailed = () => {
    if (bulkFailedItems.length === 0) return
    void handleBulkExport(bulkFailedItems)
  }

  return { bulkProgress, bulkFailedItems, handleBulkExport, handleRetryFailed }
}
