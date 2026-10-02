/**
 * Local recovery drafts page.
 *
 * Reachable from the popup and options without any provider tab. All data
 * flows through background recovery messages; the page never reads draft
 * bodies from storage directly. List/select requests are sequence-guarded so
 * a late response can never display the wrong draft, and storage.onChanged
 * only triggers re-reads (this page never writes recovery storage, so the
 * listener cannot loop).
 *
 * Delete semantics mirror the store: deleting a draft invalidates its
 * protection token, so protection for that draft stops and does not resume
 * by itself. Stopping protection keeps the saved draft.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExtensionSettings, PageSnapshot } from '../lib/types'
import { DEFAULT_SETTINGS, mergeExtensionSettings } from '../lib/types'
import { isPageSnapshot, snapshotNotice } from '../lib/page-snapshot'
import { requestPageSnapshotPreview } from '../lib/page-snapshot-cache'
import type { RecoveryDraftSummary } from '../lib/recovery-drafts'
import { t, localeTag, type Locale } from '../lib/i18n'
import { useFullPageScroll } from '../lib/use-full-page-scroll'
import { useThemeSync } from '../lib/use-theme-sync'
import '../styles/popup.css'
import '../styles/recovery.css'

async function recoveryRequest<T>(type: string, data?: object): Promise<T> {
  const response = await chrome.runtime.sendMessage({ type, ...(data ? { data } : {}) })
  if (!response || response.error) throw new Error('Recovery request failed. Please retry.')
  return response.data as T
}

export default function Recovery() {
  useFullPageScroll()

  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS)
  const locale: Locale = settings.locale
  const T = useCallback((key: string, ...args: Array<string | number>) => t(key, locale, ...args), [locale])
  useThemeSync(settings.theme)

  const [drafts, setDrafts] = useState<RecoveryDraftSummary[]>([])
  const [selected, setSelected] = useState<PageSnapshot | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<string | 'all' | null>(null)
  const [loading, setLoading] = useState(true)

  // Monotonic guards: only the latest list/select request may commit state.
  const listSequenceRef = useRef(0)
  const selectSequenceRef = useRef(0)
  const confirmRegionRef = useRef<HTMLDivElement | null>(null)

  const loadSettings = useCallback(async () => {
    try {
      const stored = await chrome.storage.local.get('settings')
      setSettings(mergeExtensionSettings(stored.settings))
    } catch { /* keep defaults; the page stays readable */ }
  }, [])

  const refresh = useCallback(async () => {
    const sequence = ++listSequenceRef.current
    try {
      const list = await recoveryRequest<RecoveryDraftSummary[]>('LIST_RECOVERY_DRAFTS')
      if (sequence !== listSequenceRef.current) return
      if (!Array.isArray(list)) throw new Error('Invalid recovery list')
      setDrafts(list)
    } catch (err) {
      if (sequence !== listSequenceRef.current) return
      setError(T(err instanceof Error ? err.message : 'Recovery list unavailable'))
    } finally {
      if (sequence === listSequenceRef.current) setLoading(false)
    }
  }, [T])

  useEffect(() => { void loadSettings(); void refresh() }, [loadSettings, refresh])

  // Re-read on relevant storage changes only. Reads never write recovery
  // storage, and the sequence guard drops stale completions — no busy loop.
  useEffect(() => {
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return
      if ('settings' in changes) void loadSettings()
      if (Object.keys(changes).some(key => key.toLowerCase().includes('recovery'))) void refresh()
    }
    chrome.storage.onChanged.addListener(onChanged)
    return () => chrome.storage.onChanged.removeListener(onChanged)
  }, [refresh, loadSettings])

  // Move focus into the confirmation region and let Escape dismiss it.
  // The region is inline and non-modal; the rest of the page stays usable.
  useEffect(() => {
    if (!confirm) return
    confirmRegionRef.current?.querySelector<HTMLButtonElement>('[data-safe-action]')?.focus()
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setConfirm(null) }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [confirm])

  const select = async (id: string) => {
    const sequence = ++selectSequenceRef.current
    setError(''); setSelected(null); setBusy(true)
    try {
      const draft = await recoveryRequest<PageSnapshot | null>('GET_RECOVERY_DRAFT', { id })
      if (sequence !== selectSequenceRef.current) return
      if (!isPageSnapshot(draft)) throw new Error(T('Recovery draft is missing or invalid'))
      setSelected(draft)
    } catch (err) {
      if (sequence === selectSequenceRef.current) setError(T(err instanceof Error ? err.message : 'Recovery draft unavailable'))
    } finally {
      if (sequence === selectSequenceRef.current) setBusy(false)
    }
  }

  const preview = async () => {
    if (!selected || busy) return
    setBusy(true); setError('')
    try {
      await requestPageSnapshotPreview(selected, settings)
      window.open(chrome.runtime.getURL('tabs/preview.html') + `?snapshot=${encodeURIComponent(selected.captureId)}`, '_blank', 'noopener')
    } catch (err) { setError(T(err instanceof Error ? err.message : 'Preview could not be opened')) }
    finally { setBusy(false) }
  }

  /** Stop protection for one draft; the saved draft itself is kept. */
  const stop = async (id: string) => {
    if (busy) return
    setBusy(true); setError('')
    try {
      await recoveryRequest('STOP_RECOVERY_DRAFT', { id })
      await refresh()
    } catch { setError(T('Protection could not be stopped. Please retry.')) }
    finally { setBusy(false) }
  }

  const remove = async (id: string | 'all') => {
    if (busy) return
    setBusy(true); setError('')
    try {
      await recoveryRequest(id === 'all' ? 'CLEAR_RECOVERY_DRAFTS' : 'DELETE_RECOVERY_DRAFT', id === 'all' ? undefined : { id })
      setSelected(null); setConfirm(null); await refresh()
    } catch {
      setError(T(id === 'all'
        ? 'The recovery drafts could not be deleted. Saved content was retained; please retry.'
        : 'The recovery draft could not be deleted. Saved content was retained; please retry.'))
    } finally { setBusy(false) }
  }

  const stateLabel = (state: RecoveryDraftSummary['state'] | undefined) =>
    state === 'protected' ? T('Protection on') : state === 'paused' ? T('Paused') : T('Off')
  const formatTime = (value: number | undefined) =>
    typeof value === 'number' ? new Date(value).toLocaleString(localeTag(locale)) : T('Date unavailable')

  return (
    <main className="recovery-page">
      <header className="recovery-header">
        <h1>{T('Local recovery drafts')}</h1>
        <p>{T('Saved checkpoints contain only observed page content, not complete verified history. They cannot restore a conversation to its provider.')}</p>
        <p>{T('Stopping protection does not delete saved drafts. Deleting a draft also stops that draft\'s protection, and protection does not resume by itself.')}</p>
        <p className="recovery-retention">{T('Drafts stay only in this browser — retained for up to 7 days and limited to 4 MiB.')}</p>
        <button type="button" className="btn btn-outline btn-compact" disabled={busy} onClick={() => void refresh()}>
          {T('Refresh')}
        </button>
      </header>
      {error && <p role="alert" className="recovery-error">{error}</p>}
      {loading ? <p>{T('Loading recovery drafts…')}</p> : drafts.length === 0 ? <p>{T('No recovery drafts available.')}</p> : (
        <>
          <ul className="recovery-list">
            {drafts.map(draft => (
              <li key={draft.id}>
                <button type="button" className="recovery-draft-title" onClick={() => void select(draft.id)}>
                  {draft.title || T('Untitled conversation')}
                </button>
                <span className="recovery-draft-meta">
                  {`${draft.platform} · ${T('Captured {0}', formatTime(draft.capturedAt))} · ${T('Last saved {0}', formatTime(draft.lastSavedAt))} · ${stateLabel(draft.state)} · ${t('{0} messages', locale, draft.messageCount ?? 0)}`}
                </span>
                {draft.state === 'protected' && (
                  <button type="button" className="btn btn-outline btn-compact" disabled={busy} onClick={() => void stop(draft.id)}>
                    {T('Stop protection')}
                  </button>
                )}
                <button type="button" className="btn btn-outline btn-compact recovery-delete" disabled={busy} onClick={() => setConfirm(draft.id)}>
                  {T('Delete')}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-outline btn-compact recovery-delete" disabled={busy} onClick={() => setConfirm('all')}>
            {T('Delete all drafts')}
          </button>
        </>
      )}
      {selected && (
        <section className="recovery-selected">
          <h2>{selected.conversation.title || T('Untitled conversation')}</h2>
          <p>{snapshotNotice(selected, locale)}</p>
          <p>{t('{0} messages', locale, selected.conversation.messages.length)}{` · ${selected.conversation.platform}`}</p>
          <button type="button" className="btn btn-outline btn-compact" disabled={busy} onClick={() => void preview()}>
            {T('Open fixed snapshot preview (copy / Markdown / PDF)')}
          </button>
        </section>
      )}
      {confirm && (
        <div className="recovery-confirm" role="group" aria-label={T('Confirm deletion')} ref={confirmRegionRef}>
          <p>
            {confirm === 'all'
              ? T('Permanently delete all local recovery drafts? This cannot be undone. Any draft still under protection loses that protection and it does not resume by itself.')
              : T('Permanently delete this local recovery draft? This cannot be undone. If this draft is still protected, protection stops and does not resume by itself.')}
          </p>
          <div className="recovery-confirm-actions">
            <button type="button" className="btn recovery-delete-confirm" disabled={busy} onClick={() => void remove(confirm)}>
              {T('Delete permanently')}
            </button>
            <button type="button" className="btn btn-outline" data-safe-action disabled={busy} onClick={() => setConfirm(null)}>
              {T('Cancel')}
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
