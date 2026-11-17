/**
 * Popup entry point (thin shell).
 * Wires the popup hooks together and lays out the header, the Current Chat /
 * Bulk Export tabs and the footers. State and effects live in
 * `components/popup/hooks`, markup in `components/popup`.
 *
 * Hook call order matters: effects run in call order, so the effectful hooks
 * (settings load, tab detection, manual job, workspace hand-off, theme/locale
 * sync) are called in the same order the original single component declared
 * their effects.
 */

import { useState } from 'react'
import './styles/popup.css'
import { QuickStartGuide } from './components/QuickStartGuide'
import { BulkExportPanel } from './components/popup/BulkExportPanel'
import { CurrentChatPanel } from './components/popup/CurrentChatPanel'
import { ManualJobStatus } from './components/popup/ManualJobStatus'
import { PopupHeader } from './components/popup/PopupHeader'
import { BulkFooter, SupportFooter } from './components/popup/PopupFooters'
import { getBulkCounts, getBulkFolderLabel, getQuickExportFormatDesc } from './components/popup/popup-derived'
import type { TabMode } from './components/popup/popup-utils'
import { useBulkExport } from './components/popup/hooks/useBulkExport'
import { useBulkSelectionRules } from './components/popup/hooks/useBulkSelectionRules'
import { useConversationList } from './components/popup/hooks/useConversationList'
import { useCurrentConversation } from './components/popup/hooks/useCurrentConversation'
import { useCurrentExport } from './components/popup/hooks/useCurrentExport'
import { useExportRun } from './components/popup/hooks/useExportRun'
import { useHandoffRefs } from './components/popup/hooks/useHandoffRefs'
import { useManualJob } from './components/popup/hooks/useManualJob'
import { usePopupSettings } from './components/popup/hooks/usePopupSettings'
import { usePopupStatus } from './components/popup/hooks/usePopupStatus'
import { useWorkspaceHandoff } from './components/popup/hooks/useWorkspaceHandoff'
import { useThemeSync } from './lib/use-theme-sync'
import { useLocaleSync } from './lib/use-locale-sync'
import type { ExportFormat } from './lib/types'

/**
 * Main Popup component
 */
export default function Popup() {
  const status = usePopupStatus()
  const [format, setFormat] = useState<ExportFormat>('markdown')
  const [tabMode, setTabMode] = useState<TabMode>('current')
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [bulkOptionsOpen, setBulkOptionsOpen] = useState(false)

  const {
    locale, T, settings, setSettings, pendingSettingsRef, settingsDirty, setSettingsDirty,
    handleOptionChange, saveExportDefaults, resetExportDefaults,
  } = usePopupSettings({ setError: status.setError, setFormat })

  const handoff = useHandoffRefs()
  const list = useConversationList({ locale, handoff, setHandoffNotice: status.setHandoffNotice })
  const rules = useBulkSelectionRules({
    T,
    conversationList: list.conversationList,
    settings,
    exportedConversationIds: list.exportedConversationIds,
    setSelectedIds: list.setSelectedIds,
    setError: status.setError,
  })
  const current = useCurrentConversation({
    T,
    handoff,
    resetListForNewTab: list.resetForNewTab,
    setSuccess: status.setSuccess,
    setExportNotice: status.setExportNotice,
    setExportResult: status.setExportResult,
  })
  const job = useManualJob({
    T,
    platform: current.platform,
    setExportedConversationIds: list.setExportedConversationIds,
    setError: status.setError,
  })
  const run = useExportRun({ T, manualJob: job.manualJob, setError: status.setError })

  const { openWorkspace } = useWorkspaceHandoff({
    T,
    handoff,
    settings,
    setSettings,
    pendingSettingsRef,
    setSettingsDirty,
    tabMode,
    setTabMode,
    format,
    setFormat,
    selectedIds: list.selectedIds,
    setSelectedIds: list.setSelectedIds,
    searchQuery: rules.searchQuery,
    setSearchQuery: rules.setSearchQuery,
    bulkFromDate: rules.bulkFromDate,
    setBulkFromDate: rules.setBulkFromDate,
    bulkToDate: rules.bulkToDate,
    setBulkToDate: rules.setBulkToDate,
    bulkSelectionLimit: rules.bulkSelectionLimit,
    setBulkSelectionLimit: rules.setBulkSelectionLimit,
    setHandoffNotice: status.setHandoffNotice,
    setWorkspaceHandoffError: status.setWorkspaceHandoffError,
    fetchConversationList: list.fetchConversationList,
  })

  useThemeSync(settings?.theme)
  useLocaleSync(locale)

  const { handleExport, openDownloadFolder } = useCurrentExport({
    T,
    locale,
    conversation: current.conversation,
    format,
    settings,
    sourceTabId: current.sourceTabId,
    detectionSequenceRef: current.detectionSequenceRef,
    run,
    status,
  })
  const bulk = useBulkExport({
    T,
    format,
    settings,
    selectedIds: list.selectedIds,
    conversationList: list.conversationList,
    exportedConversationIds: list.exportedConversationIds,
    setExportedConversationIds: list.setExportedConversationIds,
    setManualJob: job.setManualJob,
    run,
    status,
  })

  const openOptions = () => {
    chrome.runtime.openOptionsPage()
  }

  const switchToBulk = () => {
    setTabMode('bulk')
    status.setError(null)
    if (list.conversationList.length === 0) list.fetchConversationList()
  }

  const { skippedCount, bulkEligibleCount } = getBulkCounts(settings, list.selectedIds, list.exportedConversationIds)

  return (
    <div className="popup-container">
      {job.manualJob && (
        <ManualJobStatus
          manualJob={job.manualJob}
          loading={run.loading}
          locale={locale}
          T={T}
          onStop={run.stopActiveExport}
          onResume={job.resumeManualJob}
          onRetryFailed={job.retryManualJobFailed}
        />
      )}
      <PopupHeader
        theme={settings?.theme}
        locale={locale}
        T={T}
        onToggleTheme={() => handleOptionChange('theme', settings?.theme === 'dark' ? 'light' : 'dark')}
        onOpenSettings={openOptions}
      />

      {/* Body */}
      <div className="popup-body">
        <div className="tabs">
          <button type="button" className={`tab ${tabMode === 'current' ? 'active' : ''}`} aria-pressed={tabMode === 'current'} onClick={() => setTabMode('current')}>
            {T('Current Chat')}
          </button>
          <button type="button" className={`tab ${tabMode === 'bulk' ? 'active' : ''}`} aria-pressed={tabMode === 'bulk'} onClick={switchToBulk}>
            {T('Bulk Export')}
          </button>
        </div>

        {status.handoffNotice && <div className="message notice" role="status">{status.handoffNotice}</div>}

        {tabMode === 'current' && (
          <CurrentChatPanel
            platform={current.platform}
            conversation={current.conversation}
            currentReadError={current.currentReadError}
            error={status.error}
            noCurrentConversation={current.noCurrentConversation}
            sourceTabId={current.sourceTabId}
            locale={locale}
            T={T}
            settings={settings}
            format={format}
            setFormat={setFormat}
            loading={run.loading}
            stoppingExport={run.stoppingExport}
            snapshotNoticeMessage={status.snapshotNoticeMessage}
            exportNotice={status.exportNotice}
            exportResult={status.exportResult}
            success={status.success}
            optionsOpen={optionsOpen}
            setOptionsOpen={setOptionsOpen}
            settingsDirty={settingsDirty}
            setError={status.setError}
            handleOptionChange={handleOptionChange}
            saveExportDefaults={saveExportDefaults}
            resetExportDefaults={resetExportDefaults}
            handleExport={handleExport}
            stopActiveExport={run.stopActiveExport}
            openDownloadFolder={openDownloadFolder}
            openOptions={openOptions}
            openWorkspace={() => openWorkspace()}
            detectPlatformAndConversation={current.detectPlatformAndConversation}
            switchToBulk={switchToBulk}
          />
        )}

        {current.platform && <QuickStartGuide locale={locale} />}
        {tabMode === 'bulk' && (
          <BulkExportPanel
            platform={current.platform}
            conversation={current.conversation}
            locale={locale}
            T={T}
            settings={settings}
            format={format}
            loading={run.loading}
            stoppingExport={run.stoppingExport}
            conversationList={list.conversationList}
            conversationListMeta={list.conversationListMeta}
            conversationListNotice={list.conversationListNotice}
            bulkLoading={list.bulkLoading}
            selectedIds={list.selectedIds}
            skippedCount={skippedCount}
            fetchConversationList={list.fetchConversationList}
            filteredConversations={rules.filteredConversations}
            searchQuery={rules.searchQuery}
            setSearchQuery={rules.setSearchQuery}
            bulkFromDate={rules.bulkFromDate}
            setBulkFromDate={rules.setBulkFromDate}
            bulkToDate={rules.bulkToDate}
            setBulkToDate={rules.setBulkToDate}
            bulkSelectionLimit={rules.bulkSelectionLimit}
            setBulkSelectionLimit={rules.setBulkSelectionLimit}
            bulkDateRangeInvalid={rules.bulkDateRangeInvalid}
            applyBulkSelection={rules.applyBulkSelection}
            handleSelect={rules.handleSelect}
            handleToggleVisible={rules.handleToggleVisible}
            handleDeselectVisible={rules.handleDeselectVisible}
            bulkProgress={bulk.bulkProgress}
            bulkFailedItems={bulk.bulkFailedItems}
            handleBulkExport={() => bulk.handleBulkExport()}
            handleRetryFailed={bulk.handleRetryFailed}
            stopActiveExport={run.stopActiveExport}
            bulkOptionsOpen={bulkOptionsOpen}
            setBulkOptionsOpen={setBulkOptionsOpen}
            settingsDirty={settingsDirty}
            handleOptionChange={handleOptionChange}
            saveExportDefaults={saveExportDefaults}
            resetExportDefaults={resetExportDefaults}
            exportNotice={status.exportNotice}
            error={status.error}
            success={status.success}
            workspaceHandoffError={status.workspaceHandoffError}
            openWorkspace={openWorkspace}
          />
        )}
      </div>
      <SupportFooter locale={locale} T={T} />
      {tabMode === 'bulk' && (
        <BulkFooter
          locale={locale}
          T={T}
          format={format}
          setFormat={setFormat}
          settings={settings}
          loading={run.loading}
          bulkEligibleCount={bulkEligibleCount}
          quickExportFormatDesc={getQuickExportFormatDesc(format, settings, T)}
          bulkFolderLabel={getBulkFolderLabel(settings, T)}
          handleOptionChange={handleOptionChange}
          handleBulkExport={() => bulk.handleBulkExport()}
        />
      )}
    </div>
  )
}
