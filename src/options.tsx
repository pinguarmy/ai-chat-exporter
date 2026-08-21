/**
 * Options Page Component
 * Redesigned settings page featuring visually distinct card layouts,
 * theme configuration, auto-save feedback, and rate-limiting scheduled exports.
 */

import { useState, useEffect, useCallback } from 'react'
import './styles/popup.css'
import './styles/options.css'
import { Toggle } from './components/Toggle'
import { Section } from './components/Section'
import { InfoTooltip } from './components/InfoTooltip'
import { FilenameEditor } from './components/FilenameEditor'
import { SunIcon, MoonIcon, SettingsGearIcon, GithubChip } from './components/icons'
import type {
  ExtensionSettings,
  ExportFormat,
  DownloadFolderOption,
  ScheduledExportSettings,
  ScheduledExportStatus,
  ExportablePlatform,
  ScheduleFrequency,
  ScheduledExportFailureReason,
  ScheduledExportPlatformState,
} from './lib/types'
import { DEFAULT_SETTINGS, mergeExtensionSettings } from './lib/types'
import {
  DEFAULT_SCHEDULE_CHECK_INTERVAL_MINUTES,
  MAX_SCHEDULE_CHECK_INTERVAL_MINUTES,
  MIN_SCHEDULE_CHECK_INTERVAL_MINUTES,
  DEFAULT_SCHEDULE_INTERVAL_MINUTES,
  MAX_SCHEDULE_INTERVAL_MINUTES,
  MIN_SCHEDULE_INTERVAL_MINUTES,
  applyGlobalScheduledInterval,
  clampScheduledIntervalMinutes,
  ALL_PLATFORMS,
  getDefaultScheduledExportSettings,
  getNextScheduledRunAt,
  mergeScheduledExportSettings,
} from './lib/scheduled-export'
import { t, localeTag, type Locale } from './lib/i18n'
import { useFullPageScroll } from './lib/use-full-page-scroll'
import { useThemeSync } from './lib/use-theme-sync'

/** App version pulled from the extension manifest (single source of truth) */
const APP_VERSION = chrome.runtime.getManifest()?.version ?? '1.2.0'

/** Platform display names */
const PLATFORM_LABELS: Record<ExportablePlatform, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  grok: 'Grok',
}

/** Frequency translation keys */
const FREQUENCY_LABEL_KEYS: Record<ScheduleFrequency, string> = {
  hourly: 'Hourly',
  every6h: 'Every 6 Hours',
  daily: 'Daily',
  weekly: 'Weekly',
  custom: 'Custom interval',
}

/** Safe aggregate labels: diagnostic state deliberately never includes chat titles or content. */
const SCHEDULED_FAILURE_LABEL_KEYS: Record<ScheduledExportFailureReason, string> = {
  rate_limited: 'Provider rate limit reached',
  authentication_required: 'Sign-in required',
  detail_unavailable: 'Conversation details unavailable',
  detail_incomplete: 'Conversation details incomplete',
  fallback_unavailable: 'Page fallback unavailable',
  fallback_incomplete: 'Page fallback incomplete',
  serialization_failed: 'Export content could not be prepared',
  download_request_failed: 'Download request rejected',
  download_interrupted: 'Download interrupted',
  download_timed_out: 'Download did not complete in time',
  history_write_failed: 'Export history could not be saved',
}

const PLATFORM_STATUS_LABEL_KEYS: Record<ScheduledExportPlatformState, string> = {
  ready: 'Ready — signed in',
  auth_required: 'Sign-in required',
  rate_limited: 'Rate limited — retry later',
  error: 'Check failed',
}

/**
 * Archive Desk copy introduced with the schedule rail. Keys are passed to
 * T/t via variables (the same pattern as FREQUENCY_LABEL_KEYS).
 */
const COPY = {
  railSchedule: 'Schedule',
  railOn: 'On',
  railOff: 'Off',
  railChecks: 'Export interval',
  railCadence: 'Runs every {0} minutes for enabled platforms. You can override an individual platform below.',
  checkInterval: 'Scheduled export interval (minutes)',
  minutesSuffix: 'min',
  railOutput: 'Output',
  railSavedTo: 'Saved to',
  markdownOnly:
    'Scheduled exports are Markdown only — the background worker cannot render PDF. PDF remains available from manual Current Chat and Bulk Export.',
  timing:
    'Runs while Chrome and the extension are alive. Changing the interval above applies that rolling schedule to every enabled platform; individual platform settings can override it. A set time means at or shortly after it — never to the exact second.',
  timeLocal: 'Time (local)',
  day: 'Day',
  runAt: 'Runs at or shortly after {0}, local time.',
  rolling: 'No time set — runs on a rolling interval from the last run.',
  customInterval: 'Interval (minutes)',
  customIntervalHint: 'Runs on a rolling interval from the last completed run. Very short intervals can trigger provider rate limits.',
  everyMinutes: 'Runs every {0} minutes, at or shortly after the interval is due.',
  runNowHint: 'Runs immediately, bypassing the next-due check',
  localTimeFor: 'Local time for {0}',
  weekdayFor: 'Weekday for {0}',
  conversationConcurrency: 'Conversation concurrency',
  conversationConcurrencyHint:
    'Up to {0} detail reads may overlap for {1}. 1 is recommended; higher can finish sooner when requests are slow, but may trigger this provider’s rate limit.',
  concurrentChoice: '{0} concurrent read{1}',
  recommendedChoice: '1 — Recommended',
  parallelProviderOne: '1 — One platform at a time',
  parallelProviderBalanced: '2 — Balanced (recommended)',
  parallelProviderFast: '3 — Fastest (up to 3 platforms)',
  parallelProviders:
    'How many different providers may run together (1–3). This is separate from each provider’s conversation concurrency.',
  requestDelay:
    'Minimum interval between starting detail reads for each provider ({0}s)',
  rateLimitStatus:
    'Rate limited: {0}. New reads for these providers stopped; queued conversations remain eligible next run. Reduce conversation concurrency or increase the request delay before retrying.',
  nextRun: 'Next run: {0}',
  dueNow: 'Due on the next background check',
  nextRunPending: 'Calculating next run…',
  statusChecked: 'Checked {0}',
  platformStatusNotChecked: 'Not checked yet',
  platformStatusHint: 'Status reflects the last background check; it does not keep your provider credentials.',
}

/**
 * Options page component
 */
export default function Options() {
  useFullPageScroll()

  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS)
  const [saved, setSaved] = useState(false)
  const [scheduleSettings, setScheduleSettings] = useState<ScheduledExportSettings>(
    getDefaultScheduledExportSettings()
  )
  // Keep the optional feature out of the way by default for users who do not
  // use background export. An enabled saved schedule re-opens automatically.
  const [scheduleExpanded, setScheduleExpanded] = useState(false)
  const [scheduleStatus, setScheduleStatus] = useState<ScheduledExportStatus | null>(null)
  const [nextRunAt, setNextRunAt] = useState<Partial<Record<ExportablePlatform, number>>>({})
  const [stoppingScheduledExport, setStoppingScheduledExport] = useState(false)

  const locale: Locale = settings.locale ?? 'en'
  const T = (key: string) => t(key, locale)
  const platformKeys = ALL_PLATFORMS

  // Load settings on mount
  useEffect(() => {
    loadSettings()
    loadScheduleSettings()
  }, [])

  // The background task owns the final state. Keep the destructive action
  // disabled while its cancellation is unwinding, then re-enable it as soon
  // as storage confirms the run has finished.
  useEffect(() => {
    if (scheduleStatus && !scheduleStatus.isRunning) {
      setStoppingScheduledExport(false)
    }
  }, [scheduleStatus])

  // Synchronize HTML data-theme attribute with theme setting
  useThemeSync(settings.theme)

  // Poll status and the per-platform checkpoints periodically. The next run
  // is derived locally from the same schedule rules as the worker, so it does
  // not need another persisted field that could drift from the checkpoint.
  useEffect(() => {
    const loadStatus = async () => {
      try {
        const checkpointKeys = platformKeys.map(platform => `scheduledExport-lastRun-${platform}`)
        const result = await chrome.storage.local.get(['scheduledExportStatus', ...checkpointKeys])
        const status = (result.scheduledExportStatus as ScheduledExportStatus | undefined) || null
        setScheduleStatus(status)

        if (!scheduleSettings.enabled) {
          setNextRunAt({})
          return
        }

        const now = Date.now()
        const nextRuns: Partial<Record<ExportablePlatform, number>> = {}
        for (const platform of platformKeys) {
          const config = scheduleSettings.platforms[platform]
          if (!config?.enabled) continue
          const lastRunValue = result[`scheduledExport-lastRun-${platform}`]
          const lastRun = typeof lastRunValue === 'number' && Number.isFinite(lastRunValue)
            ? lastRunValue
            : 0
          nextRuns[platform] = getNextScheduledRunAt(config, lastRun, now)
        }
        setNextRunAt(nextRuns)
      } catch {}
    }
    loadStatus()
    const interval = setInterval(loadStatus, 5000)
    return () => clearInterval(interval)
  }, [scheduleSettings])

  /**
   * Load settings from storage
   */
  const loadSettings = async () => {
    try {
      const result = await chrome.storage.local.get('settings')
      if (result.settings) {
        setSettings(mergeExtensionSettings(result.settings))
      }
    } catch (err) {
      // Use defaults
    }
  }

  /**
   * Load scheduled export settings from storage
   */
  const loadScheduleSettings = async () => {
    try {
      const result = await chrome.storage.local.get('settings')
      if (result.settings?.scheduledExport) {
        const resolved = mergeScheduledExportSettings(result.settings.scheduledExport)
        setScheduleSettings(resolved)
        if (resolved.enabled) setScheduleExpanded(true)
      }
    } catch {}
  }

  /**
   * Save settings to storage
   */
  const saveSettings = useCallback(async (newSettings: ExtensionSettings) => {
    setSettings(newSettings)
    try {
      await chrome.storage.local.set({ settings: newSettings })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      // Handle error
    }
  }, [])

  /**
   * Save scheduled export settings
   */
  const saveScheduleSettings = useCallback(async (newSchedule: ScheduledExportSettings) => {
    setScheduleSettings(newSchedule)
    const updated = { ...settings, scheduledExport: newSchedule }
    setSettings(updated)
    try {
      await chrome.storage.local.set({ settings: updated })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      // Handle error
    }
  }, [settings])

  /**
   * Update a single setting
   */
  const updateSetting = <K extends keyof ExtensionSettings>(
    key: K,
    value: ExtensionSettings[K]
  ) => {
    saveSettings({ ...settings, [key]: value })
  }

  /**
   * Trigger manual scheduled export run
   */
  const triggerScheduledExport = async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'SCHEDULED_EXPORT_RUN' })
    } catch (err) {
      console.error('Failed to trigger scheduled export:', err)
    }
  }

  const stopScheduledExport = async () => {
    setStoppingScheduledExport(true)
    try {
      const result = await chrome.runtime.sendMessage({ type: 'SCHEDULED_EXPORT_STOP' })
      if (result?.error) throw new Error(result.error)
      if (!result?.data) {
        setStoppingScheduledExport(false)
        return
      }
      setScheduleStatus(previous => previous
        ? { ...previous, lastRunCancelled: true, stopRequested: true }
        : previous
      )
    } catch (err) {
      setStoppingScheduledExport(false)
      console.error('Failed to stop scheduled export:', err)
    }
  }

  const openDownloadsFolder = () => {
    try {
      chrome.downloads.showDefaultFolder()
    } catch (err) {
      console.error('Failed to open downloads folder:', err)
    }
  }

  /**
   * Clear all exported history
   */
  const clearExportHistory = async () => {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'SCHEDULED_EXPORT_CLEAR_HISTORY' })
      if (result?.error) throw new Error(result.error)
      // The worker removes the persisted status; reflect that immediately
      // instead of leaving an old failure panel visible until the next poll.
      setScheduleStatus(null)
    } catch (err) {
      console.error('Failed to clear export history:', err)
    }
  }

  const now = new Date()
  const previewExportDate = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
  const previewConversationDate = '2026-06-08'
  const previewConversationDateTime = '2026-06-08T093000'
  const previewFilename = settings.filenamePattern
    .replace(/\{date\}/g, previewConversationDate)
    .replace(/\{title\}/g, 'my-chat')
    .replace(/\{platform\}/g, 'chatgpt')
    .replace(/\{index\}/g, '001')
    .replace(/\{msgcount\}/g, '24')
    .replace(/\{datetime\}/g, previewConversationDateTime)
    .replace(/\{conv_date\}/g, previewConversationDate)
    .replace(/\{conv_datetime\}/g, previewConversationDateTime)
    .replace(/\{end_date\}/g, previewExportDate)

  /** Destination folder prefix shown in the live filename preview */
  const previewFolder =
    settings.downloadFolder === 'by-platform'
      ? 'ChatGPT/'
      : settings.downloadFolder === 'custom'
        ? `${settings.customFolderName || 'AI Chat Exports'}/`
        : ''
  const previewPath = `Downloads/${previewFolder}${previewFilename}.${settings.defaultFormat === 'pdf' ? 'pdf' : 'md'}`

  /** Localized Sunday-first weekday names for weekly schedules */
  const weekdayFormatter = new Intl.DateTimeFormat(localeTag(locale), { weekday: 'long' })
  // 2024-01-07 was a Sunday, so index 0–6 maps to Sunday–Saturday.
  const WEEKDAY_NAMES = Array.from({ length: 7 }, (_, day) =>
    weekdayFormatter.format(new Date(2024, 0, 7 + day))
  )

  const nextRunFormatter = new Intl.DateTimeFormat(localeTag(locale), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="options-container">
      <header className="options-hero">
        <div className="options-hero-title">
          <p className="options-kicker">{T('Extension Settings')}</p>
          <h1>
            <SettingsGearIcon /> AI Chat Exporter
          </h1>
        </div>
        <div className="options-hero-actions">
          <button
            className="btn-icon"
            onClick={() => updateSetting('theme', settings.theme === 'dark' ? 'light' : 'dark')}
            title={T('Toggle Theme')}
            aria-label={T('Toggle Theme')}
          >
            {settings.theme === 'dark' ? <SunIcon size={18} /> : <MoonIcon size={18} />}
          </button>
          <span className="options-version">v{APP_VERSION}</span>
        </div>
      </header>

      {/* CARD 1: General & Appearance */}
      <div className="options-card general-card">
        <div className="options-card-header">
          <h2>{T('General & Appearance')}</h2>
        </div>
        
        <div className="options-row">
          <div>
            <div className="option-label">
              {T('Default Format')}
              <InfoTooltip text={T('Primary format used for one-click exports')} />
            </div>
          </div>
          <select
            className="input select"
            value={settings.defaultFormat}
            onChange={(e) => updateSetting('defaultFormat', e.target.value as ExportFormat)}
            aria-label={T('Default Format')}
          >
            <option value="markdown">{T('Markdown (.md)')}</option>
            <option value="pdf">{T('PDF Document')}</option>
          </select>
        </div>

        <div className="options-row">
          <div>
            <div className="option-label">
              {T('UI Theme')}
              <InfoTooltip text={T('Select color theme for extension popup and options')} />
            </div>
          </div>
          <select
            className="input select"
            value={settings.theme}
            onChange={(e) => updateSetting('theme', e.target.value as ExtensionSettings['theme'])}
            aria-label={T('UI Theme')}
          >
            <option value="light">{T('Light Mode')}</option>
            <option value="dark">{T('Dark Mode')}</option>
          </select>
        </div>

        <div className="options-row">
          <div>
            <div className="option-label">{T('Language')}</div>
          </div>
          <select
            className="input select"
            value={settings.locale ?? 'en'}
            onChange={(e) => updateSetting('locale', e.target.value as Locale)}
            aria-label={T('Language')}
          >
            <option value="en">{T('English')}</option>
            <option value="zh-CN">{T('简体中文')}</option>
            <option value="zh-TW">{T('繁體中文')}</option>
            <option value="de">Deutsch</option>
            <option value="ja">日本語</option>
            <option value="ko">한국어</option>
          </select>
        </div>

        <div className="options-row options-row-divider">
          <div>
            <div className="option-label">
              {T('Download Folder Strategy')}
              <InfoTooltip text={T('Organize downloaded exports into subfolders')} />
            </div>
          </div>
          <select
            className="input select"
            value={settings.downloadFolder}
            onChange={(e) => updateSetting('downloadFolder', e.target.value as DownloadFolderOption)}
            aria-label={T('Download Folder Strategy')}
          >
            <option value="default">{T('Default Downloads Folder')}</option>
            <option value="by-platform">{T('Organize By Platform')}</option>
            <option value="custom">{T('Use Custom Subfolder')}</option>
          </select>
        </div>

        {settings.downloadFolder === 'custom' && (
          <div className="options-row" style={{ animation: 'fadeIn 200ms ease' }}>
            <div>
              <div className="option-label">
                {T('Custom Subfolder Name')}
                <InfoTooltip text={T('Exports will be placed inside: Downloads/[folder name]')} />
              </div>
            </div>
            <input
              className="input"
              value={settings.customFolderName}
              onChange={(e) => updateSetting('customFolderName', e.target.value)}
              placeholder="AI Chat Exports"
              aria-label={T('Custom Subfolder Name')}
            />
          </div>
        )}

        <div className="download-boundary-note">
          <div>
            <span className="download-boundary-title">
              {T('Where files can go')}
              <InfoTooltip text={T('Choose Downloads root, a platform subfolder, or your own Downloads subfolder. Browser extensions cannot write directly to an arbitrary absolute path.')} />
            </span>
          </div>
          <button type="button" className="btn btn-outline btn-compact" onClick={openDownloadsFolder}>
            {T('Open Downloads Folder')}
          </button>
        </div>

        <Toggle
          label={T('Ask where to save interactive exports')}
          description={T('Opens the browser Save As chooser so you can select any local folder. This prompts once per file and is not used by scheduled export.')}
          checked={settings.askForSaveLocation ?? false}
          onChange={(value) => updateSetting('askForSaveLocation', value)}
        />

        <div className="filename-settings-panel">
          <div className="options-subsection-heading">
            <div>
              <span className="option-label">
                {T('Filename Pattern')}
                <InfoTooltip text={T('Write your own pattern or insert variables. {date} is the first day of this conversation; {end_date} is the export day.')} />
              </span>
            </div>
          </div>
          <FilenameEditor
            value={settings.filenamePattern}
            onChange={(pattern) => updateSetting('filenamePattern', pattern)}
            defaultOpen
          />
          <div className="filename-preview">
            <span>{T('Preview')}</span>
            <code>{previewPath}</code>
          </div>
        </div>
      </div>

      {/* CARD 2: Export Content Configuration */}
      <div className="options-card content-card">
        <div className="options-card-header">
          <h2>{T('Export Content Configuration')}</h2>
        </div>

        <Section title={T('Export Content')} className="mb-2">
          <Toggle
            label={T('Include Metadata')}
            description={T('Add date, title, and platform at the top of exports')}
            checked={settings.includeMetadata}
            onChange={(val) => updateSetting('includeMetadata', val)}
          />
          
          <Toggle
            label={T('Include Code Blocks')}
            description={T('Export code blocks in messages')}
            checked={settings.includeCodeBlocks}
            onChange={(val) => updateSetting('includeCodeBlocks', val)}
          />
          
          <Toggle
            label={T('Include Images')}
            description={T('Export images embedded in conversations')}
            checked={settings.includeImages}
            onChange={(val) => updateSetting('includeImages', val)}
          />

          <Toggle
            label={T('Include Uploaded Files')}
            description={T('Preserve references to files you uploaded to chat')}
            checked={settings.includeUploadedFiles}
            onChange={(val) => updateSetting('includeUploadedFiles', val)}
          />

          <div className="options-row">
            <div>
              <div className="option-label">{T('Source References')}</div>
              <div className="option-description">{T('Control citation titles and private connector links')}</div>
            </div>
            <select
              className="input select"
              value={settings.referenceExportMode}
              onChange={(e) => updateSetting('referenceExportMode', e.target.value as ExtensionSettings['referenceExportMode'])}
              aria-label={T('Source References')}
            >
              <option value="off">{T('Do not export references')}</option>
              <option value="titles">{T('Titles only (recommended)')}</option>
              <option value="safe-links">{T('Public links')}</option>
              <option value="all-links">{T('All sanitized links')}</option>
            </select>
          </div>
        </Section>

        <Section title={T('PDF')} className="mt-2">
          <div className="options-row">
            <div>
              <div className="option-label">{T('PDF Appearance')}</div>
              <div className="option-description">{T('Use a centered, neutral reading layout')}</div>
            </div>
            <select
              className="input select"
              value={settings.pdfStyle ?? 'minimal'}
              onChange={(e) => updateSetting('pdfStyle', e.target.value as ExtensionSettings['pdfStyle'])}
              aria-label={T('PDF Appearance')}
            >
              <option value="minimal">{T('Minimal centered (recommended)')}</option>
              <option value="classic">{T('Classic conversation cards')}</option>
            </select>
          </div>

          <div className="options-row">
            <div>
              <div className="option-label">{T('Assistant Label')}</div>
              <div className="option-description">{T('Use provider or model name when available')}</div>
            </div>
            <input
              className="input"
              value={settings.assistantDisplayName ?? ''}
              onChange={(e) => updateSetting('assistantDisplayName', e.target.value)}
              placeholder={T('Auto (provider/model)')}
              aria-label={T('Assistant Label')}
            />
          </div>

          <Toggle
            label={T('Searchable Text')}
            description={T('Add a searchable and copyable text layer to PDF pages')}
            checked={settings.pdfTextLayer ?? true}
            onChange={(val) => updateSetting('pdfTextLayer', val)}
          />
          <Toggle
            label={T('Message Timestamps')}
            description={T('Show input and answer times when available')}
            checked={settings.showMessageTimestamps ?? true}
            onChange={(val) => updateSetting('showMessageTimestamps', val)}
          />
        </Section>

        <Section title={T('Structure')} className="mt-2">
          <Toggle
            label={T('Export Artifacts')}
            description={T('Isolate code artifacts and documents')}
            checked={settings.exportArtifacts}
            onChange={(val) => updateSetting('exportArtifacts', val)}
          />
        </Section>
      </div>

      {/* CARD 3: Scheduled Auto-Export — rail states the contract, ledger holds the detail */}
      <div className="options-card schedule-card">
        <div className="options-card-header schedule-card-header">
          <h2>{T('Scheduled Auto-Export')}</h2>
          <div className="schedule-card-header-actions">
            <Toggle
              label={T('Enable Scheduled Export')}
              description={T('Enables automated background scans and continuous backup')}
              checked={scheduleSettings.enabled}
              onChange={(val) => {
                if (val) setScheduleExpanded(true)
                void saveScheduleSettings({ ...scheduleSettings, enabled: val })
              }}
              className="schedule-enable-toggle"
            />
            <button
              type="button"
              className="schedule-collapse-button"
              onClick={() => setScheduleExpanded(value => !value)}
              aria-expanded={scheduleExpanded}
              aria-controls="scheduled-export-details"
            >
              <span>{scheduleExpanded ? T('Collapse') : T('Expand')}</span>
              <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
                <path d="m4 6 4 4 4-4" />
              </svg>
            </button>
          </div>
        </div>

        {scheduleExpanded && (
          <div id="scheduled-export-details">
            <p className="options-card-intro">
              {T('Silently export new chats automatically from platforms when extension is running in background. Files are saved in Markdown.')}
            </p>

            {/* Schedule rail: the output contract, legible before any detailed control */}
            <div className="schedule-rail">
              <div className="schedule-rail-cell">
                <span className="schedule-rail-label">
                  {T(COPY.railSchedule)}
                  <InfoTooltip text={T(COPY.timing)} />
                </span>
                <span className={`schedule-rail-value ${scheduleSettings.enabled ? 'is-on' : ''}`}>
                  {scheduleSettings.enabled ? T(COPY.railOn) : T(COPY.railOff)}
                </span>
              </div>
              <div className="schedule-rail-cell">
                <span className="schedule-rail-label">
                  {T(COPY.railChecks)}
                  <InfoTooltip
                    text={t(COPY.railCadence, locale, scheduleSettings.checkIntervalMinutes ?? DEFAULT_SCHEDULE_CHECK_INTERVAL_MINUTES)}
                  />
                </span>
                <label className="schedule-rail-interval-control">
                  <input
                    type="number"
                    min={MIN_SCHEDULE_CHECK_INTERVAL_MINUTES}
                    max={MAX_SCHEDULE_CHECK_INTERVAL_MINUTES}
                    step={1}
                    value={scheduleSettings.checkIntervalMinutes ?? DEFAULT_SCHEDULE_CHECK_INTERVAL_MINUTES}
                    onChange={(e) =>
                      void saveScheduleSettings(
                        applyGlobalScheduledInterval(scheduleSettings, e.target.value)
                      )
                    }
                    aria-label={T(COPY.checkInterval)}
                  />
                  <span>{T(COPY.minutesSuffix)}</span>
                </label>
              </div>
              <div className="schedule-rail-cell">
                <span className="schedule-rail-label">{T(COPY.railOutput)}</span>
                <span className="schedule-rail-value schedule-rail-mono">Markdown (.md)</span>
              </div>
              <div className="schedule-rail-cell">
                <span className="schedule-rail-label">{T(COPY.railSavedTo)}</span>
                <span className="schedule-rail-value schedule-rail-mono">Downloads/{previewFolder}</span>
              </div>
            </div>

            <p className="schedule-note">
              {T(COPY.markdownOnly)}
            </p>

            {scheduleSettings.enabled && (
              <div className="schedule-panel">

            {/* Per-provider ledger */}
            <div className="platform-schedule-section">
              <span className="section-label mb-2 block">
                {T('Platform Schedule Details')}
                <InfoTooltip text={T(COPY.platformStatusHint)} />
              </span>
              <div className="platform-ledger">
                {platformKeys.map((platform) => {
                  const pConfig = scheduleSettings.platforms[platform]
                  const usesTimeOfDay = pConfig.frequency === 'daily' || pConfig.frequency === 'weekly'
                  const isWeekly = pConfig.frequency === 'weekly'
                  const isCustom = pConfig.frequency === 'custom'
                  const storedPlatformStatus = scheduleStatus?.platformStatuses?.[platform]
                  const platformState = storedPlatformStatus
                    && PLATFORM_STATUS_LABEL_KEYS[storedPlatformStatus.state]
                    ? storedPlatformStatus.state
                    : undefined
                  const platformCheckedAt = typeof storedPlatformStatus?.checkedAt === 'number'
                    && Number.isFinite(storedPlatformStatus.checkedAt)
                    ? storedPlatformStatus.checkedAt
                    : undefined
                  const platformNextRun = nextRunAt[platform]
                  const updatePlatform = (patch: Partial<typeof pConfig>) => {
                    const newPlatforms = {
                      ...scheduleSettings.platforms,
                      [platform]: { ...pConfig, ...patch },
                    }
                    saveScheduleSettings({ ...scheduleSettings, platforms: newPlatforms })
                  }
                  return (
                    <div
                      key={platform}
                      className={`platform-row ${pConfig.enabled ? 'is-enabled' : ''}`}
                    >
                      <div className="platform-row-head">
                        <Toggle
                          label={PLATFORM_LABELS[platform]}
                          checked={pConfig.enabled}
                          onChange={(enabled) => updatePlatform({ enabled })}
                          ariaLabel={t('Enable schedule for {0}', locale, PLATFORM_LABELS[platform])}
                          className="platform-row-toggle"
                        />
                      </div>

                      {pConfig.enabled && (
                        <div className="platform-row-meta">
                          <div className={`platform-status-chip${platformState ? ` is-${platformState}` : ''}`}>
                            <span className="platform-status-dot" aria-hidden="true" />
                            <span>
                              {platformState
                                ? T(PLATFORM_STATUS_LABEL_KEYS[platformState])
                                : T(COPY.platformStatusNotChecked)}
                            </span>
                            {platformCheckedAt && (
                              <span className="platform-status-checked">
                                {t(COPY.statusChecked, locale, nextRunFormatter.format(platformCheckedAt))}
                              </span>
                            )}
                          </div>
                          <div className="platform-next-run" role="status">
                            {platformNextRun === undefined
                              ? T(COPY.nextRunPending)
                              : platformNextRun <= Date.now()
                                ? T(COPY.dueNow)
                                : t(COPY.nextRun, locale, nextRunFormatter.format(platformNextRun))}
                          </div>
                        </div>
                      )}

                      {pConfig.enabled && (
                        <>
                          <div className="platform-row-controls">
                            <label className="platform-field">
                              <span>{T('Frequency')}</span>
                              <select
                                className="input select schedule-control"
                                value={pConfig.frequency}
                                onChange={(e) => {
                                  const frequency = e.target.value as ScheduleFrequency
                                  updatePlatform({
                                    frequency,
                                    ...(frequency === 'custom' && !pConfig.intervalMinutes
                                      ? { intervalMinutes: DEFAULT_SCHEDULE_INTERVAL_MINUTES }
                                      : {}),
                                  })
                                }}
                                aria-label={t('Frequency for {0}', locale, PLATFORM_LABELS[platform])}
                              >
                                {Object.entries(FREQUENCY_LABEL_KEYS).map(([val, labelKey]) => (
                                  <option key={val} value={val}>{T(labelKey)}</option>
                                ))}
                              </select>
                            </label>
                          </div>

                          <details className="platform-advanced">
                            <summary>{T('Advanced options')}</summary>
                            <div className="platform-row-controls">
                              {isCustom && (
                                <label className="platform-field">
                                  <span>
                                    {T(COPY.customInterval)}
                                    <InfoTooltip text={T(COPY.customIntervalHint)} />
                                  </span>
                                  <input
                                    type="number"
                                    className="input schedule-control schedule-number-control"
                                    min={MIN_SCHEDULE_INTERVAL_MINUTES}
                                    max={MAX_SCHEDULE_INTERVAL_MINUTES}
                                    step={1}
                                    value={pConfig.intervalMinutes ?? DEFAULT_SCHEDULE_INTERVAL_MINUTES}
                                    onChange={(e) => updatePlatform({
                                      intervalMinutes: clampScheduledIntervalMinutes(e.target.value),
                                    })}
                                    aria-label={t('Custom interval for {0}', locale, PLATFORM_LABELS[platform])}
                                  />
                                </label>
                              )}

                              {usesTimeOfDay && (
                                <label className="platform-field">
                                  <span>{T(COPY.timeLocal)}</span>
                                  <input
                                    type="time"
                                    className="input schedule-control schedule-time-control"
                                    value={pConfig.timeOfDay ?? ''}
                                    onChange={(e) => updatePlatform({ timeOfDay: e.target.value || undefined })}
                                    aria-label={t(COPY.localTimeFor, locale, PLATFORM_LABELS[platform])}
                                  />
                                </label>
                              )}

                              {isWeekly && (
                                <label className="platform-field">
                                  <span>{T(COPY.day)}</span>
                                  <select
                                    className="input select schedule-control"
                                    value={pConfig.dayOfWeek ?? 1}
                                    onChange={(e) => updatePlatform({ dayOfWeek: Number(e.target.value) })}
                                    aria-label={t(COPY.weekdayFor, locale, PLATFORM_LABELS[platform])}
                                  >
                                    {WEEKDAY_NAMES.map((name, dayIndex) => (
                                      <option key={dayIndex} value={dayIndex}>{name}</option>
                                    ))}
                                  </select>
                                </label>
                              )}

                              <label className="platform-field platform-field-max">
                                <span>
                                  {T('Per-platform max')}
                                  <InfoTooltip text={T('Most new chats to attempt from this platform in one scheduled run.')} />
                                </span>
                                <input
                                  type="number"
                                  className="input schedule-control schedule-number-control"
                                  min={1}
                                  max={100}
                                  value={pConfig.maxPerRun}
                                  onChange={(e) =>
                                    updatePlatform({
                                      maxPerRun: Math.min(100, Math.max(1, Number(e.target.value))),
                                    })
                                  }
                                  aria-label={t('Max limit for {0}', locale, PLATFORM_LABELS[platform])}
                                />
                              </label>

                              <label className="platform-field">
                                <span>
                                  {T(COPY.conversationConcurrency)}
                                  <InfoTooltip
                                    text={t(
                                      COPY.conversationConcurrencyHint,
                                      locale,
                                      pConfig.maxConcurrentConversations,
                                      PLATFORM_LABELS[platform]
                                    )}
                                  />
                                </span>
                                <select
                                  className="input select schedule-control"
                                  value={pConfig.maxConcurrentConversations}
                                  onChange={(e) =>
                                    updatePlatform({
                                      maxConcurrentConversations: Math.min(3, Math.max(1, Number(e.target.value))),
                                    })
                                  }
                                  aria-label={t('Conversation concurrency for {0}', locale, PLATFORM_LABELS[platform])}
                                >
                                  {[1, 2, 3].map(value => (
                                    <option key={value} value={value}>
                                      {value === 1
                                        ? T(COPY.recommendedChoice)
                                        : t(COPY.concurrentChoice, locale, value, value === 1 ? '' : 's')}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                          </details>

                          {(usesTimeOfDay || isCustom) && (
                            <p className="platform-hint">
                              {isCustom
                                ? t(COPY.everyMinutes, locale, pConfig.intervalMinutes ?? DEFAULT_SCHEDULE_INTERVAL_MINUTES)
                                : pConfig.timeOfDay
                                ? t(COPY.runAt, locale, pConfig.timeOfDay)
                                : T(COPY.rolling)}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Run limits & housekeeping */}
            <div className="options-row options-row-divider">
              <div>
                <div className="option-label text-sm">
                  {T('Request Rate Limit Delay')}
                  <InfoTooltip
                    text={t(COPY.requestDelay, locale, (scheduleSettings.requestDelayMs / 1000).toFixed(0))}
                  />
                </div>
              </div>
              <input
                type="range"
                min={1000}
                max={10000}
                step={1000}
                value={scheduleSettings.requestDelayMs}
                onChange={(e) =>
                  saveScheduleSettings({
                    ...scheduleSettings,
                    requestDelayMs: Number(e.target.value),
                  })
                }
                className="options-range"
                aria-label={T('Request delay range')}
              />
            </div>

            <div className="options-row">
              <div>
                <div className="option-label text-sm">
                  {T('Platforms in Parallel')}
                  <InfoTooltip text={T(COPY.parallelProviders)} />
                </div>
              </div>
              <select
                className="input select schedule-control"
                value={scheduleSettings.maxConcurrentPlatforms}
                onChange={(e) =>
                  saveScheduleSettings({
                    ...scheduleSettings,
                    maxConcurrentPlatforms: Math.min(3, Math.max(1, Number(e.target.value))),
                  })
                }
                aria-label={T('Platforms in Parallel')}
              >
                <option value={1}>{T(COPY.parallelProviderOne)}</option>
                <option value={2}>{T(COPY.parallelProviderBalanced)}</option>
                <option value={3}>{T(COPY.parallelProviderFast)}</option>
              </select>
            </div>

            <div className="options-row">
              <div>
                <div className="option-label text-sm">
                  {T('Max Conversations Per Run')}
                  <InfoTooltip text={T('Total limit across every enabled platform in this one run (1–200). It is a safety budget, not the number saved forever.')} />
                </div>
              </div>
              <input
                type="number"
                className="input options-number"
                min={1}
                max={200}
                value={scheduleSettings.maxTotalPerRun}
                onChange={(e) =>
                  saveScheduleSettings({
                    ...scheduleSettings,
                    maxTotalPerRun: Math.min(200, Math.max(1, Number(e.target.value))),
                  })
                }
                aria-label={T('Max total conversations per run')}
              />
            </div>

            <Toggle
              label={T('Close Tab After Export')}
              description={T('Automatically close tabs spawned for background fetching')}
              checked={scheduleSettings.closeTabAfterExport}
              onChange={(val) =>
                saveScheduleSettings({
                  ...scheduleSettings,
                  closeTabAfterExport: val,
                })
              }
            />
          </div>
        )}

        {/* Scheduled Export Status and History panel */}
        <div className="status-panel">
          <span className="section-label mb-2 block">{T('Background Task Status')}</span>

          {scheduleStatus?.isRunning ? (
            <>
              <div className="status-running">
                <span className="spinner status-spinner"></span>
                <span className="status-running-label">{T('Running Auto-Export...')}</span>
                {(scheduleStatus.activePlatforms?.length
                  ? scheduleStatus.activePlatforms
                  : scheduleStatus.currentPlatform ? [scheduleStatus.currentPlatform] : []
                ).map(platform => (
                  <span key={platform} className="badge" style={{ textTransform: 'capitalize' }}>{PLATFORM_LABELS[platform]}</span>
                ))}
              </div>
              {scheduleStatus.stopRequested && (
                <div className="status-stopping" role="status">
                  {T('Stop requested — finishing the current browser operation.')}
                </div>
              )}
            </>
          ) : scheduleStatus?.lastRunAt ? (
            <div className="status-summary">
              <div>{T('Last started:')} {new Date(scheduleStatus.lastRunAt).toLocaleString()}</div>
              {scheduleStatus.lastRunFinishedAt && (
                <div>{T('Last finished:')} {new Date(scheduleStatus.lastRunFinishedAt).toLocaleString()}</div>
              )}
              <div className="status-counts">
                <span>{T('Exported:')} <strong className="status-ok">{scheduleStatus.lastRunExported}</strong></span>
                {scheduleStatus.lastRunFailed > 0 && (
                  <span>{T('Failed:')} <strong className="status-bad">{scheduleStatus.lastRunFailed}</strong></span>
                )}
                {(scheduleStatus.lastRunFallbackRecovered ?? 0) > 0 && (
                  <span>{T('Recovered by page fallback:')} <strong className="status-ok">{scheduleStatus.lastRunFallbackRecovered}</strong></span>
                )}
              </div>
              {Object.entries(scheduleStatus.lastRunFailureBreakdown ?? {}).map(([reason, count]) => {
                if (!count || !(reason in SCHEDULED_FAILURE_LABEL_KEYS)) return null
                return (
                  <div key={reason} className="status-bad status-error">
                    {T(SCHEDULED_FAILURE_LABEL_KEYS[reason as ScheduledExportFailureReason])}: {count}
                  </div>
                )
              })}
              {(scheduleStatus.lastRunRateLimitedPlatforms?.length ?? 0) > 0 && (
                <div className="status-rate-limited" role="status">
                  {t(
                    COPY.rateLimitStatus,
                    locale,
                    scheduleStatus.lastRunRateLimitedPlatforms!
                      .map(platform => PLATFORM_LABELS[platform])
                      .join(', ')
                  )}
                </div>
              )}
              {scheduleStatus.lastRunError && (
                <div className="status-bad status-error">
                  {T('Error:')} {scheduleStatus.lastRunError}
                </div>
              )}
              {scheduleStatus.lastRunCancelled && (
                <div className="status-cancelled">
                  {T('Stopped by user. Completed files were kept; queued conversations will be eligible next run.')}
                </div>
              )}
            </div>
          ) : (
            <div className="status-empty">
              {T('No background exports completed yet.')}
            </div>
          )}

          {/* Action buttons */}
          <div className="status-actions">
            <button
              className="btn btn-outline btn-compact"
              onClick={triggerScheduledExport}
              disabled={scheduleStatus?.isRunning}
              title={T(COPY.runNowHint)}
            >
              {T('Trigger Run Now')}
            </button>
            {scheduleStatus?.isRunning && (
              <button
                className="btn btn-outline btn-compact status-stop-btn"
                onClick={stopScheduledExport}
                disabled={stoppingScheduledExport}
              >
                {stoppingScheduledExport ? T('Stopping…') : T('Stop Export')}
              </button>
            )}
            <button
              className="btn btn-outline btn-compact"
              onClick={clearExportHistory}
              disabled={scheduleStatus?.isRunning}
            >
              {T('Clear Logs & History')}
            </button>
          </div>
        </div>
          </div>
        )}
      </div>

      {/* CARD 4: About & License */}
      <div className="options-card about-card">
        <div className="options-card-header">
          <h2>{T('About')}</h2>
        </div>
        <div className="flex justify-between items-center text-sm">
          <div className="flex-col gap-1">
            <div className="font-bold" style={{ color: 'var(--text-primary)' }}>AI Chat Exporter <span className="text-xs text-muted" style={{ fontWeight: 'normal' }}>v{APP_VERSION}</span></div>
            <div className="text-xs text-muted">MIT License &bull; Free and Open Source Software</div>
          </div>
          <GithubChip
            title={t('View GitHub Repository', locale)}
            label="github.com/pinguarmy/ai-chat-exporter"
            iconSize={12}
            iconMarginRight="6px"
            style={{ padding: '6px 12px', fontSize: '11px' }}
          />
        </div>
      </div>

      {saved && (
        <div className="save-notification" role="status" aria-live="polite">
          {T('Settings saved successfully!')}
        </div>
      )}
    </div>
  )
}
