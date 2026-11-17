/**
 * Current Chat tab: picks the empty/pending/loaded view for the active tab and
 * adds the page-snapshot panel whenever the provider source is unverified.
 */

import { PageSnapshotPanel } from '../PageSnapshotPanel'
import { isTranscriptVerified } from '../../core/conversation-integrity'
import type { Locale } from '../../core/i18n'
import type { Conversation, ExportFormat, ExtensionSettings, OptionChangeHandler } from '../../core/types'
import { ConversationPendingState, NoChatDetectedState } from './CurrentChatEmptyStates'
import { CurrentConversationView } from './CurrentConversationView'
import { getBulkFolderLabel, getQuickExportFilename, getQuickExportFormatDesc } from './popup-derived'
import { getPlatformLabel, type Translate } from './popup-utils'

interface CurrentChatPanelProps {
  platform: string | null
  conversation: Conversation | null
  currentReadError: string | null
  error: string | null
  noCurrentConversation: boolean
  sourceTabId: number | undefined
  locale: Locale
  T: Translate
  settings: ExtensionSettings | null
  format: ExportFormat
  setFormat: (format: ExportFormat) => void
  loading: boolean
  stoppingExport: boolean
  snapshotNoticeMessage: string | null
  exportNotice: string | null
  exportResult: string | null
  success: string | null
  optionsOpen: boolean
  setOptionsOpen: (open: boolean) => void
  settingsDirty: boolean
  setError: (error: string | null) => void
  handleOptionChange: OptionChangeHandler
  saveExportDefaults: () => void
  resetExportDefaults: () => void
  handleExport: () => void
  stopActiveExport: () => void
  openDownloadFolder: () => void
  openOptions: () => void
  openWorkspace: () => void | Promise<void>
  detectPlatformAndConversation: () => void
  switchToBulk: () => void
}

export function CurrentChatPanel({
  platform, conversation, currentReadError, error, noCurrentConversation, sourceTabId,
  locale, T, settings, format, detectPlatformAndConversation, switchToBulk, ...view
}: CurrentChatPanelProps) {
  const platformLabel = getPlatformLabel(platform)
  const currentError = currentReadError || error
  // Offer the observed-page snapshot whenever the provider source could not be
  // verified, so a blocked export always comes with a way to save the page.
  const snapshotFallback = Boolean(platform) && (
    Boolean(currentReadError) || (conversation ? isTranscriptVerified(conversation) === false : false)
  )
  const quickExportFilename = getQuickExportFilename(conversation, format, settings)
  const quickExportFormatDesc = getQuickExportFormatDesc(format, settings, T)
  const bulkFolderLabel = getBulkFolderLabel(settings, T)

  return (
    <div className="tab-content">
      {!platform ? (
        <NoChatDetectedState locale={locale} T={T} />
      ) : !conversation ? (
        <ConversationPendingState
          currentError={currentError}
          noCurrentConversation={noCurrentConversation}
          snapshotFallback={snapshotFallback}
          locale={locale}
          T={T}
          onRefresh={detectPlatformAndConversation}
          onOpenBulk={switchToBulk}
        />
      ) : (
        <CurrentConversationView
          {...view}
          conversation={conversation}
          platform={platform}
          platformLabel={platformLabel}
          locale={locale}
          T={T}
          settings={settings}
          format={format}
          snapshotFallback={snapshotFallback}
          currentError={currentError}
          quickExportFilename={quickExportFilename}
          quickExportFormatDesc={quickExportFormatDesc}
          bulkFolderLabel={bulkFolderLabel}
        />
      )}
      {/* The snapshot panel captures DOM directly and does not depend on
          API verification, so it stays available while detection is
          running and after it fails. Gemini always shows it (history can
          be off there); other providers show it as the fallback once
          export verification has failed, instead of a dead end. */}
      {(platform === 'gemini' || snapshotFallback) && (
        conversation && snapshotFallback ? <details className="snapshot-secondary">
          <summary>{T('Capture without downloading')}</summary>
          <p className="text-xs text-muted">{T('Capture first to inspect or copy the page before saving. The main save button above captures and downloads in one step.')}</p>
          <PageSnapshotPanel sourceTabId={sourceTabId} settings={settings ?? undefined} locale={locale} recoveryAvailable={platform === 'gemini'} />
        </details> : <PageSnapshotPanel
          sourceTabId={sourceTabId}
          settings={settings ?? undefined}
          locale={locale}
          recoveryAvailable={platform === 'gemini'}
        />
      )}
    </div>
  )
}
