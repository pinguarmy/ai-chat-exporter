/**
 * Card 3: scheduled auto-export. The rail states the contract, the platform
 * ledger holds the detail and the status panel reports the background task.
 */

import { Toggle } from '../Toggle'
import type { Locale, MessageKey } from '../../lib/i18n'
import type { ExportablePlatform, ScheduledExportSettings, ScheduledExportStatus } from '../../lib/types'
import { PlatformScheduleLedger } from './PlatformScheduleLedger'
import { ScheduleLimits } from './ScheduleLimits'
import { ScheduleRail } from './ScheduleRail'
import { ScheduleStatusPanel } from './ScheduleStatusPanel'
import { COPY } from './options-constants'

interface ScheduleCardProps {
  scheduleSettings: ScheduledExportSettings
  scheduleExpanded: boolean
  setScheduleExpanded: (update: boolean | ((previous: boolean) => boolean)) => void
  scheduleStatus: ScheduledExportStatus | null
  nextRunAt: Partial<Record<ExportablePlatform, number>>
  stoppingScheduledExport: boolean
  locale: Locale
  T: (key: MessageKey) => string
  previewFolder: string
  saveScheduleSettings: (schedule: ScheduledExportSettings) => Promise<void>
  triggerScheduledExport: () => void
  stopScheduledExport: () => void
  clearExportHistory: () => void
}

export function ScheduleCard({
  scheduleSettings, scheduleExpanded, setScheduleExpanded, scheduleStatus, nextRunAt,
  stoppingScheduledExport, locale, T, previewFolder, saveScheduleSettings,
  triggerScheduledExport, stopScheduledExport, clearExportHistory,
}: ScheduleCardProps) {
  return (
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
          <ScheduleRail
            scheduleSettings={scheduleSettings}
            locale={locale}
            T={T}
            previewFolder={previewFolder}
            saveScheduleSettings={saveScheduleSettings}
          />

        <p className="schedule-note">
          {T(COPY.markdownOnly)}
        </p>

          {scheduleSettings.enabled && (
            <div className="schedule-panel">
              <PlatformScheduleLedger
                scheduleSettings={scheduleSettings}
                scheduleStatus={scheduleStatus}
                nextRunAt={nextRunAt}
                locale={locale}
                T={T}
                saveScheduleSettings={saveScheduleSettings}
              />

              <ScheduleLimits
                scheduleSettings={scheduleSettings}
                locale={locale}
                T={T}
                saveScheduleSettings={saveScheduleSettings}
              />
            </div>
          )}

          {/* Scheduled Export Status and History panel */}
          <ScheduleStatusPanel
            scheduleStatus={scheduleStatus}
            stoppingScheduledExport={stoppingScheduledExport}
            locale={locale}
            T={T}
            triggerScheduledExport={triggerScheduledExport}
            stopScheduledExport={stopScheduledExport}
            clearExportHistory={clearExportHistory}
          />
        </div>
      )}
    </div>
  )
}
