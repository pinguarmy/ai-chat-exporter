/**
 * Bulk Export tab: history summary, quick-selection rules, progress, the
 * conversation list, workspace hand-off hints, options and run results.
 */

import { ConversationList } from '../ConversationList'
import { ExportOptionsPanel } from '../ExportOptionsPanel'
import { Pill } from '../Pill'
import { localizeProviderError } from '../../providers/provider-errors'
import { t, type Locale } from '../../core/i18n'
import type { BulkFailedItem } from '../../core/bulk-selection'
import type {
  BulkExportProgress, Conversation, ConversationListItem, ExportFormat, ExtensionSettings, OptionChangeHandler,
} from '../../core/types'
import { BulkProgressBar } from './BulkProgressBar'
import { BulkResultsPanel } from './BulkResultsPanel'
import { BulkSelectionPanel } from './BulkSelectionPanel'
import { getHistoryState } from './popup-derived'
import { AiIcon, RefreshIcon } from './popup-icons'
import { getPlatformLabel, type ConversationListLoadMeta, type Translate } from './popup-utils'

interface BulkExportPanelProps {
  platform: string | null
  conversation: Conversation | null
  locale: Locale
  T: Translate
  settings: ExtensionSettings | null
  format: ExportFormat
  loading: boolean
  stoppingExport: boolean
  // Conversation list
  conversationList: ConversationListItem[]
  conversationListMeta: ConversationListLoadMeta | null
  conversationListNotice: string | null
  bulkLoading: boolean
  selectedIds: string[]
  skippedCount: number
  fetchConversationList: () => void
  // Selection rules
  filteredConversations: ConversationListItem[]
  searchQuery: string
  setSearchQuery: (query: string) => void
  bulkFromDate: string
  setBulkFromDate: (value: string) => void
  bulkToDate: string
  setBulkToDate: (value: string) => void
  bulkSelectionLimit: string
  setBulkSelectionLimit: (value: string) => void
  bulkDateRangeInvalid: boolean
  applyBulkSelection: () => void
  handleSelect: (id: string) => void
  handleToggleVisible: () => void
  handleDeselectVisible: () => void
  // Run state
  bulkProgress: BulkExportProgress
  bulkFailedItems: BulkFailedItem[]
  handleBulkExport: () => void
  handleRetryFailed: () => void
  stopActiveExport: () => void
  // Settings/options
  bulkOptionsOpen: boolean
  setBulkOptionsOpen: (open: boolean) => void
  settingsDirty: boolean
  handleOptionChange: OptionChangeHandler
  saveExportDefaults: () => void
  resetExportDefaults: () => void
  // Messages / workspace
  exportNotice: string | null
  error: string | null
  success: string | null
  workspaceHandoffError: boolean
  openWorkspace: (withoutSelection?: boolean) => void | Promise<void>
}

export function BulkExportPanel({
  platform, conversation, locale, T, settings, format, loading, stoppingExport,
  conversationList, conversationListMeta, conversationListNotice, bulkLoading, selectedIds,
  skippedCount, fetchConversationList, filteredConversations, searchQuery, setSearchQuery,
  bulkFromDate, setBulkFromDate, bulkToDate, setBulkToDate, bulkSelectionLimit,
  setBulkSelectionLimit, bulkDateRangeInvalid, applyBulkSelection, handleSelect,
  handleToggleVisible, handleDeselectVisible, bulkProgress, bulkFailedItems,
  handleBulkExport, handleRetryFailed, stopActiveExport, bulkOptionsOpen, setBulkOptionsOpen,
  settingsDirty, handleOptionChange, saveExportDefaults, resetExportDefaults,
  exportNotice, error, success, workspaceHandoffError, openWorkspace,
}: BulkExportPanelProps) {
  const platformLabel = getPlatformLabel(platform)
  const historyState = getHistoryState({
    bulkLoading, conversationListNotice, conversationListMeta, platform, platformLabel, locale, T,
  })

  return (
    <div className="tab-content" style={{ gap: '10px' }}>
      <div className="flex justify-between items-center">
        <Pill label={platformLabel || T('Unknown')} platform={platform || 'unknown'} icon={<AiIcon />} />
        <button 
          type="button"
          className="btn btn-outline btn-compact flex items-center gap-1" 
          onClick={fetchConversationList}
          disabled={loading || bulkLoading}
          title={T('Refresh conversation list')}
          aria-label={T('Refresh conversation list')}
        >
          <RefreshIcon /> 
          <span className="text-xs font-bold">{T('Refresh')}</span>
        </button>
      </div>

      <div className="bulk-history-summary" aria-live="polite">
        <span className="text-xs text-muted">
          {bulkLoading
            ? (platform === 'gemini' ? T('Loading full Gemini history…') : T('Loading conversations...'))
            : `${conversationList.length} ${T('conversations found')}`}
        </span>
        {historyState && (
          <p className={`bulk-history-state ${historyState.warning ? 'bulk-history-state-warning' : 'bulk-history-state-success'}`} role="status">
            {historyState.message}
          </p>
        )}
      </div>

      <BulkSelectionPanel
        locale={locale}
        T={T}
        settings={settings}
        loading={loading}
        bulkLoading={bulkLoading}
        hasVisibleConversations={filteredConversations.length > 0}
        bulkFromDate={bulkFromDate}
        setBulkFromDate={setBulkFromDate}
        bulkToDate={bulkToDate}
        setBulkToDate={setBulkToDate}
        bulkSelectionLimit={bulkSelectionLimit}
        setBulkSelectionLimit={setBulkSelectionLimit}
        bulkDateRangeInvalid={bulkDateRangeInvalid}
        applyBulkSelection={applyBulkSelection}
        handleOptionChange={handleOptionChange}
      />

      {(bulkProgress.status === 'fetching' || bulkProgress.status === 'exporting') && (
        <BulkProgressBar bulkProgress={bulkProgress} stoppingExport={stoppingExport} T={T} stopActiveExport={stopActiveExport} />
      )}

      <p className="text-xs text-muted" role="status">{t('Selected {0} · Will export {1} · Skip {2}', locale, selectedIds.length, selectedIds.length - skippedCount, skippedCount)}</p>
      <ConversationList
        conversations={filteredConversations}
        totalCount={conversationList.length}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedIds={selectedIds}
        onSelect={handleSelect}
        onSelectAll={handleToggleVisible}
        onDeselectAll={handleDeselectVisible}
        onExport={() => handleBulkExport()}
        loading={loading}
        bulkLoading={bulkLoading}
        T={T}
      />

      {(format === 'pdf' || settings?.askForSaveLocation) && <button type="button" className="link-btn" onClick={() => void openWorkspace()}>{T('Open full export workspace')}</button>}
      {workspaceHandoffError && (
        <div className="message error" role="alert">
          <span>{T('Your current selection could not be carried over: session storage is unavailable. The workspace was not opened.')}</span>
          <button type="button" className="link-btn" onClick={() => void openWorkspace(true)}>
            {T('Open workspace without selection')}
          </button>
        </div>
      )}
      {(format === 'pdf' || settings?.askForSaveLocation) && <p className="text-xs text-muted">{T('Keep this page open for PDF or Save As exports. Use the full workspace for long runs.')}</p>}
      <ExportOptionsPanel
        open={bulkOptionsOpen}
        onToggle={() => setBulkOptionsOpen(!bulkOptionsOpen)}
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

      {bulkProgress.total > 0 && bulkProgress.status !== 'exporting' && bulkProgress.status !== 'fetching' && (
        <BulkResultsPanel
          bulkProgress={bulkProgress}
          bulkFailedItems={bulkFailedItems}
          conversationList={conversationList}
          loading={loading}
          bulkLoading={bulkLoading}
          locale={locale}
          T={T}
          handleRetryFailed={handleRetryFailed}
        />
      )}

      {exportNotice && <div className="message notice" role="status">{exportNotice}</div>}
      {error && <div className="message error" role="alert">{localizeProviderError(error, locale)}</div>}
      {success && <div className="message success" role="alert">{success}</div>}


    </div>
  )
}
