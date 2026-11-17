/**
 * Current Chat tab body once a conversation is loaded: summary, quick export
 * controls, status messages, export button and per-export options.
 */

import { Pill } from '../Pill'
import { ExportButton } from '../ExportButton'
import { FormatSelector } from '../FormatSelector'
import { ExportDiagnostics } from '../ExportDiagnostics'
import { ExportCoverage } from '../ExportCoverage'
import { ExportOptionsPanel } from '../ExportOptionsPanel'
import { localizeProviderError } from '../../lib/provider-errors'
import { buildExportOptions } from '../../lib/export-options'
import { isTranscriptVerified } from '../../lib/conversation-integrity'
import { requestPreviewSnapshot } from '../../lib/preview-snapshots'
import { t, type Locale } from '../../lib/i18n'
import type { Conversation, ExportFormat, ExtensionSettings } from '../../lib/types'
import { AiIcon } from './popup-icons'
import { estimateSize, type Translate } from './popup-utils'

interface CurrentConversationViewProps {
  conversation: Conversation
  platform: string
  platformLabel: string | null
  locale: Locale
  T: Translate
  settings: ExtensionSettings | null
  format: ExportFormat
  setFormat: (format: ExportFormat) => void
  loading: boolean
  stoppingExport: boolean
  snapshotFallback: boolean
  currentError: string | null
  snapshotNoticeMessage: string | null
  exportNotice: string | null
  exportResult: string | null
  success: string | null
  quickExportFilename: string
  quickExportFormatDesc: string
  bulkFolderLabel: string
  optionsOpen: boolean
  setOptionsOpen: (open: boolean) => void
  settingsDirty: boolean
  setError: (error: string | null) => void
  handleOptionChange: (key: keyof ExtensionSettings, value: any) => void
  saveExportDefaults: () => void
  resetExportDefaults: () => void
  handleExport: () => void
  stopActiveExport: () => void
  openDownloadFolder: () => void
  openOptions: () => void
  openWorkspace: () => void | Promise<void>
}

export function CurrentConversationView({
  conversation, platform, platformLabel, locale, T, settings, format, setFormat, loading,
  stoppingExport, snapshotFallback, currentError, snapshotNoticeMessage, exportNotice,
  exportResult, success, quickExportFilename, quickExportFormatDesc, bulkFolderLabel,
  optionsOpen, setOptionsOpen, settingsDirty, setError, handleOptionChange,
  saveExportDefaults, resetExportDefaults, handleExport, stopActiveExport,
  openDownloadFolder, openOptions, openWorkspace,
}: CurrentConversationViewProps) {
  return (
    <>
      <div className="conversation-info">
        <div className="conversation-info-header">
          <Pill label={platformLabel || ''} platform={platform} icon={<AiIcon />} />
        </div>
        <h2>{conversation.title || T('Untitled Conversation')}</h2>
        <div className="preview-summary">
          <span>
            {t('{0} messages', locale, conversation.messages.length)} · {estimateSize(conversation, settings)}
            {isTranscriptVerified(conversation) === true ? ` · ${T('Verified source')}` : ''}
            {/* Full verification diagnostics UI is PR-12. */}
          </span>
          <button
            type="button"
            className="link-btn"
            onClick={async () => {
              try {
                await requestPreviewSnapshot({ ...conversation, previewSettings: settings || undefined })
                await chrome.tabs.create({ url: chrome.runtime.getURL('tabs/preview.html') + `?id=${encodeURIComponent(conversation.id)}` })
              } catch { setError(T('Preview is unavailable right now.')) }
            }}
            title={T('Preview lets you select messages or save only the last answer.')}
          >
            {T('Preview & select messages')}
          </button>
        </div>
      </div>

      <div className="flex-col gap-2">
        <span className="section-label">{T('Quick Export')}</span>
        <ExportDiagnostics conversation={conversation} T={T} />
        <FormatSelector value={format} onChange={setFormat} disabled={loading} archiveBundle={!snapshotFallback && settings?.archiveBundle} onArchiveChange={snapshotFallback ? undefined : value => handleOptionChange('archiveBundle', value)} locale={locale} />
        <p className="text-xs text-muted format-purpose">{T(format === 'pdf' ? 'PDF for reading or printing.' : !snapshotFallback && settings?.archiveBundle ? 'ZIP contains Markdown, a manifest and captured inline files. External files are not downloaded.' : 'Markdown for editing in a notes app.')}</p>
      </div>

      {snapshotFallback && <p className="message notice snapshot-preflight" role="note">{T('Complete history could not be verified. This action saves only content loaded on this page as a labelled snapshot, not a complete archive.')} {T('Markdown and PDF only — no ZIP archives, raw provider data, or tool records. Output follows your current privacy settings.')}</p>}
      {currentError && <div className="message error" role="alert">{localizeProviderError(currentError, locale)}</div>}
      {snapshotNoticeMessage && <div className="message" role="status">{snapshotNoticeMessage}</div>}
      {exportNotice && <div className="message notice" role="status">{exportNotice}</div>}
      {(exportResult || success) && (
        <div className="message success" role="status">
          <span style={{ overflowWrap: 'anywhere' }}>{exportResult ? T('Exported: {0}', exportResult) : success}</span>
          <button type="button" className="link-btn open-downloads-link" onClick={openDownloadFolder}>
            {T('Open download folder')}
          </button>
        </div>
      )}

      <div className="mt-1">
        <ExportButton onClick={handleExport} disabled={!conversation} loading={loading} format={format} text={snapshotFallback ? T(format === 'pdf' ? 'Preview page snapshot PDF' : 'Save page snapshot Markdown') : undefined} isSuccess={!!(exportResult || success)} locale={locale} archiveBundle={settings?.archiveBundle} />
        {loading && (
          <button type="button" className="btn btn-outline export-stop-btn" onClick={stopActiveExport} disabled={stoppingExport}>
            {stoppingExport ? T('Stopping…') : T('Stop Export')}
          </button>
        )}
        <p className="text-xs text-muted mt-1" style={{ overflowWrap: 'anywhere' }}>
          {snapshotFallback ? T('The snapshot filename includes its capture time and is not added to complete-archive history.') : T('Will download: {0} ({1})', quickExportFilename, quickExportFormatDesc)}
        </p>
        <p className="text-xs text-muted mt-1 export-destination">{t('Saved to: {0}', locale, settings?.askForSaveLocation ? T('Choose a location when saving') : bulkFolderLabel)} <button type="button" className="link-btn" onClick={openOptions}>{T('Change in Settings')}</button></p>
        {(format === 'pdf' || settings?.askForSaveLocation) && <p className="text-xs text-muted mt-1">{T('Keep this page open for PDF or Save As exports. Use the full workspace for long runs.')} <button type="button" className="link-btn" onClick={() => void openWorkspace()}>{T('Open full export workspace')}</button></p>}
        {settings?.safeShare && <p className="text-xs text-muted mt-1">{T('Share copy is on. Common credentials are hidden, but review private content before sharing.')}</p>}
        {!snapshotFallback && <p className="text-xs text-muted mt-1">{T('Source structure is verified, not authenticity or all external resources.')}</p>}
        {/* Real coverage of what this export includes (messages,
            citations, attachments, artifacts) — distinct from source
            structure verification. Provided by the shared component. */}
        <ExportCoverage
          conversation={conversation}
          options={buildExportOptions(format, settings ?? undefined)}
          locale={locale}
        />
      </div>

      <ExportOptionsPanel
        open={optionsOpen}
        onToggle={() => setOptionsOpen(!optionsOpen)}
        settings={settings}
        conversation={conversation}
        format={format}
        loading={loading}
        onOptionChange={handleOptionChange}
    settingsDirty={settingsDirty}
    onSaveDefaults={saveExportDefaults}
    onResetDefaults={resetExportDefaults}
        T={T}
      />
    </>
  )
}
