/**
 * Per-provider schedule ledger: enable switch, last-check status, next run and
 * the frequency/limits controls for each supported platform.
 */

import { Toggle } from '../Toggle'
import { InfoTooltip } from '../InfoTooltip'
import { t, localeTag, type Locale } from '../../lib/i18n'
import type {
  ExportablePlatform,
  ScheduleFrequency,
  ScheduledExportSettings,
  ScheduledExportStatus,
} from '../../lib/types'
import {
  DEFAULT_SCHEDULE_INTERVAL_MINUTES,
  MAX_SCHEDULE_INTERVAL_MINUTES,
  MIN_SCHEDULE_INTERVAL_MINUTES,
  clampScheduledIntervalMinutes,
  ALL_PLATFORMS,
} from '../../lib/scheduled-export'
import {
  COPY,
  FREQUENCY_LABEL_KEYS,
  PLATFORM_LABELS,
  PLATFORM_STATUS_LABEL_KEYS,
} from './options-constants'

interface PlatformScheduleLedgerProps {
  scheduleSettings: ScheduledExportSettings
  scheduleStatus: ScheduledExportStatus | null
  nextRunAt: Partial<Record<ExportablePlatform, number>>
  locale: Locale
  T: (key: string) => string
  saveScheduleSettings: (schedule: ScheduledExportSettings) => Promise<void>
}

export function PlatformScheduleLedger({
  scheduleSettings, scheduleStatus, nextRunAt, locale, T, saveScheduleSettings,
}: PlatformScheduleLedgerProps) {
  const platformKeys = ALL_PLATFORMS

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

                  <Toggle
                    id={`scheduled-skip-archived-${platform}`}
                    label={T('Skip Already Archived')}
                    checked={pConfig.skipAlreadyExported}
                    onChange={(skipAlreadyExported) => updatePlatform({ skipAlreadyExported })}
                    description={T('Turn off to re-export up to N chats from the start of the provider list every run, using Per-platform max. Export history is kept.')}
                    ariaLabel={`${PLATFORM_LABELS[platform]}: ${T('Skip Already Archived')}`}
                  />

                  <Toggle
                    id={`scheduled-overwrite-existing-${platform}`}
                    label={T('Overwrite same-name scheduled files')}
                    checked={pConfig.overwriteExistingFiles ?? false}
                    onChange={(overwriteExistingFiles) => updatePlatform({ overwriteExistingFiles })}
                    description={T('Replaces an existing file only when the full download path matches. Use {platform}-{full_id} for one stable file per chat. Old differently named files are not removed. Manual exports are unchanged.')}
                    ariaLabel={`${PLATFORM_LABELS[platform]}: ${T('Overwrite same-name scheduled files')}`}
                  />

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
                          <InfoTooltip text={T('Most chats to attempt from this platform in one scheduled run.')} />
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
  )
}
