/**
 * Current-chat export: saves the verified conversation, or (when the source
 * cannot be verified) a clearly labelled page snapshot instead.
 */

import { useCallback } from 'react'
import { requestPageSnapshotFromTab } from '../../../lib/page-snapshot-capture'
import { requestPageSnapshotPreview } from '../../../lib/page-snapshot-cache'
import { downloadPageSnapshot } from '../../../lib/snapshot-download'
import { exportConversationFile } from '../../../lib/export-download'
import { buildExportOptions } from '../../../lib/export-options'
import { isExportCancelledError } from '../../../lib/export-cancel'
import { analyzeConversationIntegrity, conversationIntegrityError, isConversationExportable } from '../../../lib/conversation-integrity'
import { tDynamic, type Locale } from '../../../lib/i18n'
import type { Conversation, ExportFormat, ExtensionSettings } from '../../../lib/types'
import type { Translate } from '../popup-utils'
import type { ExportRun } from './useExportRun'
import type { PopupStatus } from './usePopupStatus'
import type { MutableRefObject } from 'react'

interface Options {
  T: Translate
  locale: Locale
  conversation: Conversation | null
  format: ExportFormat
  settings: ExtensionSettings | null
  sourceTabId: number | undefined
  detectionSequenceRef: MutableRefObject<number>
  run: ExportRun
  status: PopupStatus
}

export function useCurrentExport({
  T, locale, conversation, format, settings, sourceTabId, detectionSequenceRef, run, status,
}: Options) {
  const { setLoading, setStoppingExport, activeExportControllerRef } = run
  const {
    setError, setSuccess, setExportNotice, setExportResult, setSnapshotNoticeMessage,
  } = status

  /** Handle export action for current conversation. */
  const handleExport = useCallback(async () => {
    if (!conversation) {
      setError(T('No conversation to export'))
      return
    }

    const integrity = analyzeConversationIntegrity(conversation)
    if (!isConversationExportable(conversation)) {
      // The full source could not be verified (for example Gemini with history
      // turned off). Instead of stopping with only an error, save what the page
      // has loaded as a page snapshot. The file is labelled as a snapshot and is
      // never registered as a complete archive.
      if (typeof sourceTabId !== 'number') {
        setError(conversationIntegrityError(integrity))
        return
      }
      setLoading(true)
      setStoppingExport(false)
      setError(null)
      setSuccess(null)
      setExportNotice(null)
      setExportResult(null)
      setSnapshotNoticeMessage(null)
      const snapshotController = new AbortController()
      activeExportControllerRef.current = snapshotController
      const detectionSequence = detectionSequenceRef.current
      const isCurrent = () => detectionSequenceRef.current === detectionSequence && !snapshotController.signal.aborted
      try {
        const snapshot = await requestPageSnapshotFromTab(sourceTabId, undefined, isCurrent)
        if (!snapshot || !isCurrent()) return
        if (format === 'pdf') {
          await requestPageSnapshotPreview(snapshot, settings ?? undefined)
          if (!isCurrent()) return
          await chrome.tabs.create({ url: chrome.runtime.getURL('tabs/preview.html') + `?snapshot=${encodeURIComponent(snapshot.captureId)}&format=pdf` })
          setSnapshotNoticeMessage(T('PDF export does not start automatically. Choose Download PDF below when you are ready.'))
          return
        }
        const filename = await downloadPageSnapshot(snapshot, format, settings ?? undefined, { signal: snapshotController.signal })
        setSuccess(T('This chat could not be verified as complete, so a page snapshot was saved instead: {0}. It contains what the page has loaded.', filename))
      } catch (err) {
        if (isExportCancelledError(err)) setSnapshotNoticeMessage(T('Download cancelled. Nothing was saved.'))
        else setError(`${conversationIntegrityError(integrity)} ${T('A page snapshot could not be saved either: {0}', err instanceof Error ? tDynamic(err.message, locale) : T('Export failed'))}`)
      } finally {
        if (activeExportControllerRef.current === snapshotController) activeExportControllerRef.current = null
        setStoppingExport(false)
        setLoading(false)
      }
      return
    }

    // The title was already resolved at detection time (see
    // detectPlatformAndConversation), so this conversation object is the same
    // one the heading, preflight and preview showed.
    setLoading(true)
    setStoppingExport(false)
    setError(null)
    setSuccess(null)
    setExportNotice(null)
    setExportResult(null)
    const controller = new AbortController()
    activeExportControllerRef.current = controller

    try {
      // exportConversationFile resolves with the filename only after the
      // browser reports the download complete, so this success state always
      // reflects a real saved file — never a queued or cancelled one.
      const filename = await exportConversationFile(conversation, buildExportOptions(format, settings ?? undefined), settings ?? undefined, { signal: controller.signal })
      setExportResult(filename)
    } catch (err) {
      // A cancelled export is a neutral outcome, not a success: keep the
      // button immediately retryable and say plainly that nothing new ran.
      if (isExportCancelledError(err)) setExportNotice(T('Export stopped. Completed files were kept.'))
      else setError(err instanceof Error ? err.message : T('Export failed'))
    } finally {
      if (activeExportControllerRef.current === controller) activeExportControllerRef.current = null
      setStoppingExport(false)
      setLoading(false)
    }
  }, [conversation, format, settings, sourceTabId, locale])

  /** Reveal the browser's download folder; never guess a file path ourselves. */
  const openDownloadFolder = () => {
    try {
      chrome.downloads?.showDefaultFolder?.()
    } catch {
      setExportNotice(T('Could not open the download folder.'))
    }
  }

  return { handleExport, openDownloadFolder }
}
