/**
 * Schedule rail: the at-a-glance contract of scheduled export (on/off,
 * background check interval, output format and destination).
 */

import { InfoTooltip } from '../InfoTooltip'
import { t, type Locale } from '../../lib/i18n'
import type { ScheduledExportSettings } from '../../lib/types'
import {
  DEFAULT_SCHEDULE_CHECK_INTERVAL_MINUTES,
  MAX_SCHEDULE_CHECK_INTERVAL_MINUTES,
  MIN_SCHEDULE_CHECK_INTERVAL_MINUTES,
  applyGlobalScheduledInterval,
} from '../../lib/scheduled-export'
import { COPY } from './options-constants'

interface ScheduleRailProps {
  scheduleSettings: ScheduledExportSettings
  locale: Locale
  T: (key: string) => string
  previewFolder: string
  saveScheduleSettings: (schedule: ScheduledExportSettings) => Promise<void>
}

export function ScheduleRail({ scheduleSettings, locale, T, previewFolder, saveScheduleSettings }: ScheduleRailProps) {
  return (
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
  )
}
