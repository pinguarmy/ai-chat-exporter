/**
 * Run limits and housekeeping for scheduled export: request delay,
 * platform parallelism, total cap and tab cleanup.
 */

import { Toggle } from '../Toggle'
import { InfoTooltip } from '../InfoTooltip'
import { t, type Locale, type MessageKey } from '../../core/i18n'
import type { ScheduledExportSettings } from '../../core/types'
import { COPY } from './options-constants'

interface ScheduleLimitsProps {
  scheduleSettings: ScheduledExportSettings
  locale: Locale
  T: (key: MessageKey) => string
  saveScheduleSettings: (schedule: ScheduledExportSettings) => Promise<void>
}

export function ScheduleLimits({ scheduleSettings, locale, T, saveScheduleSettings }: ScheduleLimitsProps) {
  return (
    <>
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
    </>
  )
}
