/**
 * Options Page Component
 * Redesigned settings page featuring visually distinct card layouts,
 * theme configuration, auto-save feedback, and rate-limiting scheduled exports.
 */

import React, { useState, useEffect, useCallback } from 'react'
import './styles/popup.css'
import './styles/options.css'
import { Toggle } from './components/Toggle'
import { Section } from './components/Section'
import type {
  ExtensionSettings,
  ExportFormat,
  DownloadFolderOption,
  ScheduledExportSettings,
  ScheduledExportStatus,
  ExportablePlatform,
  ScheduleFrequency,
} from './lib/types'
import { DEFAULT_SETTINGS } from './lib/types'
import { getDefaultScheduledExportSettings } from './lib/scheduled-export'
import { t, type Locale } from './lib/i18n'
import { useFullPageScroll } from './lib/use-full-page-scroll'

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

/** Frequency display labels */
const FREQUENCY_LABELS: Record<ScheduleFrequency, string> = {
  hourly: 'Hourly',
  every6h: 'Every 6 Hours',
  daily: 'Daily',
  weekly: 'Weekly',
}

/** Inline SVG Icons */
const SettingsIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </svg>
)

/** Sun icon (light mode) */
const SunIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4"></circle>
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path>
  </svg>
)

/** Moon icon (dark mode) */
const MoonIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
  </svg>
)

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
  const [scheduleStatus, setScheduleStatus] = useState<ScheduledExportStatus | null>(null)

  const locale: Locale = settings.locale ?? 'en'
  const T = (key: string) => t(key, locale)

  // Load settings on mount
  useEffect(() => {
    loadSettings()
    loadScheduleSettings()
  }, [])

  // Synchronize HTML data-theme attribute with theme setting
  useEffect(() => {
    if (settings.theme) {
      document.documentElement.setAttribute('data-theme', settings.theme)
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light')
    }
  }, [settings.theme])

  // Poll status periodically
  useEffect(() => {
    const loadStatus = async () => {
      try {
        const result = await chrome.storage.local.get('scheduledExportStatus')
        setScheduleStatus(result.scheduledExportStatus || null)
      } catch {}
    }
    loadStatus()
    const interval = setInterval(loadStatus, 5000)
    return () => clearInterval(interval)
  }, [])

  /**
   * Load settings from storage
   */
  const loadSettings = async () => {
    try {
      const result = await chrome.storage.local.get('settings')
      if (result.settings) {
        setSettings({ ...DEFAULT_SETTINGS, ...result.settings })
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
        setScheduleSettings(result.settings.scheduledExport)
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

  /**
   * Clear all exported history
   */
  const clearExportHistory = async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'SCHEDULED_EXPORT_CLEAR_HISTORY' })
    } catch (err) {
      console.error('Failed to clear export history:', err)
    }
  }

  const now = new Date()
  const previewFilename = settings.filenamePattern
    .replace(/\{date\}/g, now.toISOString().split('T')[0])
    .replace(/\{title\}/g, 'my-chat')
    .replace(/\{platform\}/g, 'chatgpt')
    .replace(/\{index\}/g, '001')
    .replace(/\{msgcount\}/g, '24')
    .replace(/\{datetime\}/g, now.toISOString().replace(/[:.]/g, '').split('T').join('T').substring(0, 19))
    .replace(/\{conv_date\}/g, '2026-06-08')
    .replace(/\{conv_datetime\}/g, '2026-06-08T093000')
    .replace(/\{end_date\}/g, now.toISOString().split('T')[0])

  const platformKeys = Object.keys(scheduleSettings.platforms) as ExportablePlatform[]

  return (
    <div className="options-container">
      <header className="options-hero">
        <div className="options-hero-title">
          <p className="options-kicker">{T('Extension Settings')}</p>
          <h1>
            <SettingsIcon /> AI Chat Exporter
          </h1>
        </div>
        <div className="options-hero-actions">
          <button
            className="btn-icon"
            onClick={() => updateSetting('theme', settings.theme === 'dark' ? 'light' : 'dark')}
            title={T('Toggle Theme')}
            aria-label={T('Toggle Theme')}
          >
            {settings.theme === 'dark' ? <SunIcon /> : <MoonIcon />}
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
            <div className="option-label">{T('Default Format')}</div>
            <div className="option-description">{T('Primary format used for one-click exports')}</div>
          </div>
          <select 
            className="input options-select" 
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
            <div className="option-label">{T('UI Theme')}</div>
            <div className="option-description">{T('Select color theme for extension popup and options')}</div>
          </div>
          <select
            className="input options-select"
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
            <div className="option-description">{T('Select UI language')}</div>
          </div>
          <select 
            className="input options-select" 
            value={settings.locale ?? 'en'}
            onChange={(e) => updateSetting('locale', e.target.value as Locale)}
            aria-label={T('Language')}
          >
            <option value="en">{T('English')}</option>
            <option value="zh-CN">{T('简体中文')}</option>
            <option value="zh-TW">{T('繁體中文')}</option>
          </select>
        </div>

        <div className="options-row options-row-divider">
          <div>
            <div className="option-label">{T('Download Folder Strategy')}</div>
            <div className="option-description">{T('Organize downloaded exports into subfolders')}</div>
          </div>
          <select
            className="input options-select"
            value={settings.downloadFolder}
            onChange={(e) => updateSetting('downloadFolder', e.target.value as DownloadFolderOption)}
            aria-label={T('Download folder strategy')}
          >
            <option value="default">{T('Default Downloads Folder')}</option>
            <option value="by-platform">{T('Organize By Platform')}</option>
            <option value="custom">{T('Use Custom Subfolder')}</option>
          </select>
        </div>

        {settings.downloadFolder === 'custom' && (
          <div className="options-row" style={{ animation: 'fadeIn 200ms ease' }}>
            <div>
              <div className="option-label">{T('Custom Subfolder Name')}</div>
              <div className="option-description">{T('Exports will be placed inside: Downloads/[folder name]')}</div>
            </div>
            <input
              className="input options-control"
              value={settings.customFolderName}
              onChange={(e) => updateSetting('customFolderName', e.target.value)}
              placeholder="AI Chat Exports"
              aria-label={T('Custom folder name')}
            />
          </div>
        )}
      </div>

      {/* CARD 2: Export Content Configuration */}
      <div className="options-card content-card">
        <div className="options-card-header">
          <h2>{T('Export Content Configuration')}</h2>
        </div>

        <Section title={T('Content Elements')} className="mb-2">
          <Toggle
            label={T('Include Metadata')}
            description={T('Add exporting metadata (date, title, source platform) at the header')}
            checked={settings.includeMetadata}
            onChange={(val) => updateSetting('includeMetadata', val)}
          />
          
          <Toggle
            label={T('Include Code Blocks')}
            description={T('Export syntax-highlighted code containers inside chats')}
            checked={settings.includeCodeBlocks}
            onChange={(val) => updateSetting('includeCodeBlocks', val)}
          />
          
          <Toggle
            label={T('Include Images')}
            description={T('Download and embed images rendered in responses')}
            checked={settings.includeImages}
            onChange={(val) => updateSetting('includeImages', val)}
          />

          <Toggle
            label={T('Include Uploaded Files')}
            description={T('Preserve links and names of user-uploaded files')}
            checked={settings.includeUploadedFiles}
            onChange={(val) => updateSetting('includeUploadedFiles', val)}
          />
        </Section>

        <Section title={T('Structure Layout')} className="mt-2">
          <Toggle
            label={T('Export Code Artifacts')}
            description={T('Extract code artifacts or document blocks as structured sections')}
            checked={settings.exportArtifacts}
            onChange={(val) => updateSetting('exportArtifacts', val)}
          />
        </Section>
      </div>

      {/* CARD 3: Filename Pattern */}
      <div className="options-card filename-card">
        <div className="options-card-header">
          <h2>{T('Filename Pattern')}</h2>
        </div>
        
        <div className="flex-col gap-3">
          <div className="flex-col gap-1">
            <span className="text-sm font-medium">{T('Filename Pattern')}</span>
            <div className="flex items-center gap-2">
              <input 
                className="input flex-1" 
                value={settings.filenamePattern}
                onChange={(e) => updateSetting('filenamePattern', e.target.value)}
                placeholder="{date}-{title}"
                aria-label={T('Filename pattern template')}
              />
              <button 
                className="btn btn-outline" 
                style={{ width: 'auto', whiteSpace: 'nowrap' }}
                onClick={() => updateSetting('filenamePattern', '{date}-{title}')}
              >
                {T('Reset Default')}
              </button>
            </div>
            <div className="filename-preview">
              <span>{T('Preview')}</span>
              <code>{previewFilename}.{settings.defaultFormat === 'pdf' ? 'pdf' : 'md'}</code>
            </div>
          </div>
        </div>
      </div>

      {/* CARD 4: Scheduled Auto-Export (Continuous Backup) */}
      <div className="options-card schedule-card">
        <div className="options-card-header">
          <h2>{T('Scheduled Auto-Export')}</h2>
        </div>
        <p className="options-card-intro">
          {T('Silently export new chats automatically from platforms when extension is running in background. Files are saved in Markdown.')}
        </p>

        {/* Global Auto-export toggle */}
        <Toggle
          label={T('Enable Scheduled Export')}
          description={T('Enables automated background scans and continuous backup')}
          checked={scheduleSettings.enabled}
          onChange={(val) => saveScheduleSettings({ ...scheduleSettings, enabled: val })}
        />

        {scheduleSettings.enabled && (
          <div className="schedule-panel">
            
            {/* Delay range slider */}
            <div className="options-row">
              <div>
                <div className="option-label text-sm">{T('Request Rate Limit Delay')}</div>
                <div className="option-description">
                  {T('Rest interval between background page loads (')}{((scheduleSettings.requestDelayMs / 1000).toFixed(0))}{T('s)')}
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
                aria-label="Request delay range"
              />
            </div>

            {/* Max total per run */}
            <div className="options-row">
              <div>
                <div className="option-label text-sm">{T('Max Conversations Per Run')}</div>
                <div className="option-description">{T('Cap limit on exports processed in a single run (1–200)')}</div>
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
                aria-label="Max total conversations per run"
              />
            </div>

            {/* Close tab after export */}
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

            {/* Per-platform cards */}
            <div className="platform-schedule-section">
              <span className="section-label mb-2 block">{T('Platform Schedule Details')}</span>
              <div className="platform-grid">
                {platformKeys.map((platform) => {
                  const pConfig = scheduleSettings.platforms[platform]
                  return (
                    <div
                      key={platform}
                      className={`platform-card ${pConfig.enabled ? 'is-enabled' : ''}`}
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-primary">
                          {PLATFORM_LABELS[platform]}
                        </span>
                        <input
                          type="checkbox"
                          className="toggle"
                          checked={pConfig.enabled}
                          onChange={(e) => {
                            const newPlatforms = {
                              ...scheduleSettings.platforms,
                              [platform]: { ...pConfig, enabled: e.target.checked },
                            }
                            saveScheduleSettings({ ...scheduleSettings, platforms: newPlatforms })
                          }}
                          aria-label={`Enable schedule for ${PLATFORM_LABELS[platform]}`}
                        />
                      </div>

                      {pConfig.enabled && (
                        <div className="platform-controls">
                          <label>
                            <span>Frequency</span>
                            <select
                              className="select"
                              value={pConfig.frequency}
                              onChange={(e) => {
                                const newPlatforms = {
                                  ...scheduleSettings.platforms,
                                  [platform]: { ...pConfig, frequency: e.target.value as ScheduleFrequency },
                                }
                                saveScheduleSettings({ ...scheduleSettings, platforms: newPlatforms })
                              }}
                              aria-label={`Frequency for ${PLATFORM_LABELS[platform]}`}
                            >
                              {Object.entries(FREQUENCY_LABELS).map(([val, label]) => (
                                <option key={val} value={val}>{label}</option>
                              ))}
                            </select>
                          </label>

                          <label>
                            <span>Max</span>
                            <input
                              type="number"
                              className="input"
                              min={1}
                              max={100}
                              value={pConfig.maxPerRun}
                              onChange={(e) => {
                                const newPlatforms = {
                                  ...scheduleSettings.platforms,
                                  [platform]: {
                                    ...pConfig,
                                    maxPerRun: Math.min(100, Math.max(1, Number(e.target.value))),
                                  },
                                }
                                saveScheduleSettings({ ...scheduleSettings, platforms: newPlatforms })
                              }}
                              aria-label={`Max limit for ${PLATFORM_LABELS[platform]}`}
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* Scheduled Export Status and History panel */}
        <div className="status-panel">
          <span className="section-label mb-2 block">{T('Background Task Status')}</span>

          {scheduleStatus?.isRunning ? (
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="spinner" style={{ borderTopColor: 'var(--primary)', width: '12px', height: '12px' }}></span>
              <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{T('Running Auto-Export...')}</span>
              {scheduleStatus.currentPlatform && (
                <span className="badge" style={{ textTransform: 'capitalize' }}>{PLATFORM_LABELS[scheduleStatus.currentPlatform]}</span>
              )}
            </div>
          ) : scheduleStatus?.lastRunAt ? (
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
              <div><strong>Last active:</strong> {new Date(scheduleStatus.lastRunAt).toLocaleString()}</div>
              <div style={{ marginTop: '2px' }}>
                <span>Exported: <strong style={{ color: 'var(--success)' }}>{scheduleStatus.lastRunExported}</strong></span>
                {scheduleStatus.lastRunFailed > 0 && (
                  <span style={{ marginLeft: '10px' }}>Failed: <strong style={{ color: 'var(--error)' }}>{scheduleStatus.lastRunFailed}</strong></span>
                )}
              </div>
              {scheduleStatus.lastRunError && (
                <div style={{ color: 'var(--error)', marginTop: '4px' }}>
                  <strong>Error:</strong> {scheduleStatus.lastRunError}
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
              {T('No background exports completed yet.')}
            </div>
          )}

          {/* Action buttons */}
          <div className="status-actions">
            <button
              className="btn btn-outline btn-compact"
              onClick={triggerScheduledExport}
              disabled={scheduleStatus?.isRunning}
            >
              {T('Trigger Run Now')}
            </button>
            <button
              className="btn btn-outline btn-compact"
              onClick={clearExportHistory}
            >
              {T('Clear Logs & History')}
            </button>
          </div>
        </div>
      </div>

      {/* CARD 5: About & License */}
      <div className="options-card about-card">
        <div className="options-card-header">
          <h2>{T('About')}</h2>
        </div>
        <div className="flex justify-between items-center text-sm">
          <div className="flex-col gap-1">
            <div className="font-bold" style={{ color: 'var(--text-primary)' }}>AI Chat Exporter <span className="text-xs text-muted" style={{ fontWeight: 'normal' }}>v{APP_VERSION}</span></div>
            <div className="text-xs text-muted">MIT License &bull; Free and Open Source Software</div>
          </div>
          <a 
            href="https://github.com/pinguarmy/ai-chat-exporter" 
            target="_blank" 
            rel="noopener noreferrer"
            className="github-chip"
            style={{ padding: '6px 12px', fontSize: '11px' }}
            title="Visit GitHub repository"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}>
              <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
            </svg>
            github.com/pinguarmy/ai-chat-exporter
          </a>
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
