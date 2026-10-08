/**
 * PageSnapshotPanel
 *
 * Manual page-snapshot entry for the current conversation. The panel owns its
 * capture lifecycle: it talks to the content script with the DOM-only
 * CAPTURE_PAGE_SNAPSHOT request, never reuses the popup's verified/API
 * conversation, and stays clickable while full verification is loading or has
 * failed. A captured snapshot is immutable here; exports reference its
 * captureId and remain allowed after the source tab navigates or closes.
 *
 * Optional local recovery is off by default and is only toggled through the
 * background recovery messages. Closing the popup must never stop protection,
 * so this component has no unmount side effects on recovery state.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExtensionSettings, PageSnapshot } from '../lib/types'
import {
  isPageSnapshot,
  snapshotNotice,
  prepareSnapshotForOutput,
  buildSnapshotExportOptions,
} from '../lib/page-snapshot'
import { downloadPageSnapshot } from '../lib/snapshot-download'
import { requestPageSnapshotPreview } from '../lib/page-snapshot-cache'
import { conversationToMarkdown } from '../lib/export-markdown'
import { isExportCancelledError } from '../lib/export-cancel'
import { t, localeTag, type Locale } from '../lib/i18n'
import '../styles/page-snapshot.css'

/** Mirrors the background RecoveryStatus contract (session identity lives in the background). */
type RecoveryStatus = {
  sessionKey: string
  token?: string
  state: 'off' | 'protected' | 'paused'
  lastSavedAt?: number
  error?: string
  draftId?: string
}

type CaptureResponse = {
  data?: unknown
  error?: unknown
  meta?: { requestId?: unknown }
}

export interface PageSnapshotPanelProps {
  /** Tab whose page the snapshot is captured from. */
  sourceTabId?: number
  /** Current privacy/output settings; shared by preview, copy, and downloads. */
  settings?: Partial<ExtensionSettings>
  locale: Locale
  /**
   * Local recovery drafts are only implemented for Gemini. Other providers get
   * the snapshot itself as the fallback when export verification fails.
   */
  recoveryAvailable?: boolean
}

const CAPTURE_NOT_RECOGNIZED = 'The capture response was not recognized. Please retry.'
const PAGE_CHANGED = 'The page changed while capturing. Please retry.'

export function PageSnapshotPanel({ sourceTabId, settings, locale, recoveryAvailable = true }: PageSnapshotPanelProps) {
  const T = useCallback((key: string, ...args: Array<string | number>) => t(key, locale, ...args), [locale])

  const [snapshot, setSnapshot] = useState<PageSnapshot | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [tabClosed, setTabClosed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copying, setCopying] = useState(false)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [recovery, setRecovery] = useState<RecoveryStatus | null>(null)
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const [recoveryError, setRecoveryError] = useState<string | null>(null)
  // Recovery settings stay collapsed by default so the long opt-in/privacy
  // copy never crowds the capture actions out of the small popup.
  const [recoveryOpen, setRecoveryOpen] = useState(false)

  // Monotonic capture guard: only the latest request may commit a snapshot.
  const captureSequenceRef = useRef(0)
  const activeCaptureIdRef = useRef<string | null>(null)
  const capturingRef = useRef(false)
  const downloadControllerRef = useRef<AbortController | null>(null)
  const recoverySequenceRef = useRef(0)

  /** Reject every in-flight capture. A stable snapshot is never cleared here. */
  const invalidateCapture = useCallback((reason: string | null) => {
    captureSequenceRef.current += 1
    activeCaptureIdRef.current = null
    if (capturingRef.current) {
      capturingRef.current = false
      setCapturing(false)
      setCaptureError(reason)
    }
  }, [])

  const refreshRecoveryStatus = useCallback(async () => {
    if (typeof sourceTabId !== 'number') {
      setRecovery(null)
      return
    }
    const sequence = ++recoverySequenceRef.current
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_RECOVERY_STATUS', data: { tabId: sourceTabId } })
      if (sequence !== recoverySequenceRef.current) return
      const data = response?.data as RecoveryStatus | undefined
      setRecovery(data && (data.state === 'protected' || data.state === 'paused') ? data : { sessionKey: data?.sessionKey ?? '', state: 'off' })
    } catch {
      if (sequence === recoverySequenceRef.current) setRecovery(null)
    }
  }, [sourceTabId])

  // A different source tab means a different conversation: reset capture state
  // and re-read the recovery status for the new tab.
  useEffect(() => {
    invalidateCapture(null)
    setSnapshot(null)
    setCaptureError(null)
    setTabClosed(false)
    setActionMessage(null)
    setActionError(null)
    setRecoveryError(null)
    void refreshRecoveryStatus()
  }, [sourceTabId, invalidateCapture, refreshRecoveryStatus])

  // Navigation, reload, or tab close invalidates the in-flight capture. The
  // already-captured snapshot deliberately survives: it is a fixed record.
  useEffect(() => {
    if (typeof sourceTabId !== 'number') return
    const onUpdated = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (tabId !== sourceTabId) return
      if (changeInfo.url !== undefined || changeInfo.status === 'loading') {
        invalidateCapture(T(PAGE_CHANGED))
        void refreshRecoveryStatus()
      }
    }
    const onRemoved = (tabId: number) => {
      if (tabId !== sourceTabId) return
      invalidateCapture(T('The source tab was closed before the capture finished. Please retry.'))
      setTabClosed(true)
      void refreshRecoveryStatus()
    }
    chrome.tabs.onUpdated.addListener(onUpdated)
    chrome.tabs.onRemoved.addListener(onRemoved)
    return () => {
      chrome.tabs.onUpdated.removeListener(onUpdated)
      chrome.tabs.onRemoved.removeListener(onRemoved)
    }
  }, [sourceTabId, invalidateCapture, refreshRecoveryStatus, T])

  // Recovery status refreshes come from storage change notifications only;
  // there is deliberately no polling loop.
  useEffect(() => {
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return
      if (Object.keys(changes).some(key => key.toLowerCase().includes('recovery'))) void refreshRecoveryStatus()
    }
    chrome.storage.onChanged.addListener(onChanged)
    return () => chrome.storage.onChanged.removeListener(onChanged)
  }, [refreshRecoveryStatus])

  /** Run a DOM-only capture on the bound tab; never touches provider APIs. */
  const capture = useCallback(async () => {
    if (typeof sourceTabId !== 'number') {
      setCaptureError(T('Open a supported conversation tab to capture a snapshot.'))
      return
    }
    const sequence = ++captureSequenceRef.current
    const requestId = crypto.randomUUID()
    activeCaptureIdRef.current = requestId
    capturingRef.current = true
    setCapturing(true)
    setCaptureError(null)
    setActionMessage(null)
    setActionError(null)
    try {
      const before = await chrome.tabs.get(sourceTabId)
      const startUrl = before?.url ?? ''
      if (!startUrl) throw new Error(T('Open a supported conversation tab to capture a snapshot.'))
      const response = (await chrome.tabs.sendMessage(sourceTabId, {
        type: 'CAPTURE_PAGE_SNAPSHOT',
        data: { requestId },
      })) as CaptureResponse | undefined
      // Late or superseded responses are dropped without touching state.
      if (sequence !== captureSequenceRef.current || activeCaptureIdRef.current !== requestId) return
      if (response?.meta?.requestId !== requestId) throw new Error(T(CAPTURE_NOT_RECOGNIZED))
      if (typeof response?.error === 'string' && response.error) throw new Error(response.error)
      // Re-read the tab: a navigation during capture voids the result. The URL
      // is only a consistency check, never proof of conversation identity —
      // identity comes from the echoed requestId plus the update/close
      // listeners above.
      const after = await chrome.tabs.get(sourceTabId).catch(() => null)
      if (!after?.url || after.url !== startUrl) throw new Error(T(PAGE_CHANGED))
      if (!isPageSnapshot(response?.data)) throw new Error(T(CAPTURE_NOT_RECOGNIZED))
      setSnapshot(response.data)
      setTabClosed(false)
    } catch (err) {
      if (sequence !== captureSequenceRef.current) return
      setCaptureError(err instanceof Error ? T(err.message) : T('Capture failed. Please retry.'))
    } finally {
      if (sequence === captureSequenceRef.current) {
        capturingRef.current = false
        setCapturing(false)
        activeCaptureIdRef.current = null
      }
    }
  }, [sourceTabId, T])

  /** Quick Markdown save; no preview-cache write is required beforehand. */
  const saveMarkdown = useCallback(async () => {
    if (!snapshot || saving) return
    const controller = new AbortController()
    downloadControllerRef.current = controller
    setSaving(true)
    setActionMessage(null)
    setActionError(null)
    try {
      const filename = await downloadPageSnapshot(snapshot, 'markdown', settings, { signal: controller.signal })
      setActionMessage(T('Saved {0}', filename))
    } catch (err) {
      if (isExportCancelledError(err)) setActionMessage(T('Download cancelled. Nothing was saved.'))
      else setActionError(err instanceof Error ? T(err.message) : T('Export failed'))
    } finally {
      if (downloadControllerRef.current === controller) downloadControllerRef.current = null
      setSaving(false)
    }
  }, [snapshot, saving, settings, T])

  const cancelDownload = useCallback(() => {
    downloadControllerRef.current?.abort()
  }, [])

  /** Copy the same Markdown policy used by downloads, honoring privacy settings. */
  const copyMarkdown = useCallback(async () => {
    if (!snapshot || copying) return
    setCopying(true)
    setActionMessage(null)
    setActionError(null)
    try {
      const prepared = prepareSnapshotForOutput(snapshot, settings)
      const markdown = conversationToMarkdown(
        prepared.conversation,
        buildSnapshotExportOptions('markdown', settings, snapshot.capturedAt)
      )
      await navigator.clipboard.writeText(markdown)
      setActionMessage(T('Copied Markdown!'))
    } catch (err) {
      setActionError(err instanceof Error ? T(err.message) : T('Copy failed'))
    } finally {
      setCopying(false)
    }
  }, [snapshot, copying, settings, T])

  /**
   * Preview/PDF share one hand-off: the snapshot is stored under its captureId
   * first; the tab only opens after the write is confirmed. Storage failures
   * surface as errors instead of opening an empty preview.
   */
  const openPreview = useCallback(async (forPdf: boolean) => {
    if (!snapshot || previewBusy) return
    setPreviewBusy(true)
    setActionMessage(null)
    setActionError(null)
    try {
      await requestPageSnapshotPreview(snapshot, settings)
      const url = chrome.runtime.getURL('tabs/preview.html')
        + `?snapshot=${encodeURIComponent(snapshot.captureId)}`
        + (forPdf ? '&format=pdf' : '')
      await chrome.tabs.create({ url })
    } catch (err) {
      setActionError(err instanceof Error ? T(err.message) : T('Preview is unavailable right now.'))
    } finally {
      setPreviewBusy(false)
    }
  }, [snapshot, previewBusy, settings, T])

  const enableRecovery = useCallback(async () => {
    if (typeof sourceTabId !== 'number' || recoveryBusy) return
    setRecoveryBusy(true)
    setRecoveryError(null)
    try {
      const response = await chrome.runtime.sendMessage({ type: 'START_RECOVERY_PROTECTION', data: { tabId: sourceTabId } })
      if (response?.error) throw new Error(T(String(response.error)))
      await refreshRecoveryStatus()
    } catch (err) {
      setRecoveryError(err instanceof Error ? T(err.message) : T('Protection could not be enabled. Please retry.'))
    } finally {
      setRecoveryBusy(false)
    }
  }, [sourceTabId, recoveryBusy, refreshRecoveryStatus, T])

  const stopRecovery = useCallback(async () => {
    if (typeof sourceTabId !== 'number' || recoveryBusy) return
    setRecoveryBusy(true)
    setRecoveryError(null)
    try {
      const response = await chrome.runtime.sendMessage({ type: 'STOP_RECOVERY_PROTECTION', data: { tabId: sourceTabId } })
      if (response?.error) throw new Error(T(String(response.error)))
      await refreshRecoveryStatus()
    } catch (err) {
      setRecoveryError(err instanceof Error ? T(err.message) : T('Protection could not be stopped. Please retry.'))
    } finally {
      setRecoveryBusy(false)
    }
  }, [sourceTabId, recoveryBusy, refreshRecoveryStatus, T])

  const openRecoveryPage = useCallback(() => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('tabs/recovery.html') })
  }, [])

  const capturedTime = snapshot ? new Date(snapshot.capturedAt).toLocaleString(localeTag(locale)) : ''
  const generationLabel = snapshot
    ? snapshot.generationState === 'generating'
      ? T('Still generating')
      : snapshot.generationState === 'idle'
        ? T('Generation stopped')
        : T('Generation status unknown')
    : ''
  const recoveryActive = recovery?.state === 'protected' || recovery?.state === 'paused'

  return (
    <section className="snapshot-panel" aria-label={T('Page snapshot')}>
      <span className="section-label">{T('Page snapshot')}</span>
      <p className="snapshot-description text-xs text-muted">
        {T('Save the conversation content currently loaded and readable on this page. The full history is not verified.')}
      </p>

      {!snapshot ? (
        <div className="snapshot-capture">
          <button
            type="button"
            className="btn btn-outline btn-compact"
            onClick={() => void capture()}
            disabled={capturing || typeof sourceTabId !== 'number'}
          >
            {capturing ? T('Capturing…') : T('Capture page snapshot')}
          </button>
          {captureError && <div className="message error" role="alert">{captureError}</div>}
        </div>
      ) : (
        <div className="snapshot-result">
          <div className="snapshot-meta" role="status">
            <span>{T('Captured: {0}', capturedTime)}</span>
            <span>{t('{0} messages', locale, snapshot.conversation.messages.length)}</span>
            <span className={`snapshot-generation snapshot-generation-${snapshot.generationState}`}>{generationLabel}</span>
          </div>
          <p className="snapshot-scope text-xs">{T('Scope: content observed on this page (DOM only)')}</p>
          <p className="snapshot-notice text-xs text-muted">{snapshotNotice(snapshot, locale)}</p>
          {tabClosed && (
            <p className="snapshot-tab-closed text-xs text-muted">
              {T('The source tab was closed. This captured snapshot can still be exported.')}
            </p>
          )}
          <div className="snapshot-actions">
            {saving ? (
              <button type="button" className="btn btn-outline btn-compact" onClick={cancelDownload}>
                {T('Stop Export')}
              </button>
            ) : (
              <button type="button" className="btn btn-primary btn-compact" onClick={() => void saveMarkdown()}>
                {T('Save Markdown')}
              </button>
            )}
            <button type="button" className="btn btn-outline btn-compact" onClick={() => void copyMarkdown()} disabled={copying || saving}>
              {copying ? T('Copying…') : T('Copy Markdown')}
            </button>
            <button type="button" className="btn btn-outline btn-compact" onClick={() => void openPreview(false)} disabled={previewBusy || saving}>
              {T('Preview ↗')}
            </button>
            <button type="button" className="btn btn-outline btn-compact" onClick={() => void openPreview(true)} disabled={previewBusy || saving}>
              {T('Export PDF ↗')}
            </button>
            <button type="button" className="link-btn" onClick={() => void capture()} disabled={capturing}>
              {T('Recapture')}
            </button>
          </div>
          {previewBusy && (
            <p className="text-xs text-muted">{T('Preparing preview…')}</p>
          )}
          <p className="snapshot-pdf-note text-xs text-muted">
            {T('PDF opens in the preview page; keep that tab open until the download finishes.')}
          </p>
          {actionMessage && <div className="message success" role="status">{actionMessage}</div>}
          {actionError && <div className="message error" role="alert">{actionError}</div>}
        </div>
      )}

      <p className="snapshot-limits text-xs text-muted">
        {T('Markdown and PDF only — no ZIP archives, raw provider data, or tool records. Output follows your current privacy settings.')}
      </p>

      {recoveryAvailable && (
      <div className="snapshot-recovery">
        <details className="snapshot-recovery-details" open={recoveryOpen}>
          <summary
            className="snapshot-recovery-summary"
            onClick={(event) => { event.preventDefault(); setRecoveryOpen(open => !open) }}
          >
            <span className="section-label">{T('Local recovery')}</span>
            <span className={`snapshot-recovery-state snapshot-recovery-state-${recovery?.state ?? 'off'}`}>
              {recovery?.state === 'protected'
                ? T('Protection on')
                : recovery?.state === 'paused'
                  ? T('Paused')
                  : T('Off')}
            </span>
            {recoveryActive && recovery?.lastSavedAt ? (
              <span className="snapshot-recovery-saved text-xs text-muted">
                {T('Last saved: {0}', new Date(recovery.lastSavedAt).toLocaleString(localeTag(locale)))}
              </span>
            ) : null}
            {recovery?.error ? <span className="snapshot-recovery-flag text-xs">{T('Save failed')}</span> : null}
          </summary>
        {recoveryActive ? (
          <div className="snapshot-recovery-status" role="status">
            <p className="text-xs">
              {recovery?.state === 'protected'
                ? T('Local protection is on for this conversation.')
                : T('Local protection is paused for this conversation.')}
            </p>
            {recovery?.error && (
              <p className="snapshot-recovery-error text-xs" role="alert">{T('Save failed: {0}', T(recovery.error))}</p>
            )}
            <div className="snapshot-recovery-actions">
              <button type="button" className="btn btn-outline btn-compact" onClick={() => void stopRecovery()} disabled={recoveryBusy}>
                {T('Stop protection')}
              </button>
              <button type="button" className="link-btn" onClick={openRecoveryPage}>
                {T('Open recovery page')}
              </button>
            </div>
            <p className="text-xs text-muted">{T('Drafts can be viewed and cleared on the recovery page.')}</p>
          </div>
        ) : (
          <div className="snapshot-recovery-off">
            <p className="text-xs text-muted">
              {T('Optional and off by default. When enabled, the visible content of this conversation is kept as a recovery draft that stays only in this browser — retained for up to 7 days and limited to 4 MiB. Nothing is uploaded or synced, and protection does not restart by itself after the browser restarts.')}
            </p>
            <div className="snapshot-recovery-actions">
              <button
                type="button"
                className="btn btn-outline btn-compact"
                onClick={() => void enableRecovery()}
                disabled={recoveryBusy || typeof sourceTabId !== 'number'}
              >
                {recoveryBusy ? T('Working…') : T('Enable local protection for this conversation')}
              </button>
              <button type="button" className="link-btn" onClick={openRecoveryPage}>
                {T('Open recovery page')}
              </button>
            </div>
          </div>
        )}
        {recoveryError && <div className="message error" role="alert">{recoveryError}</div>}
        </details>
      </div>
      )}
    </section>
  )
}

export default PageSnapshotPanel
