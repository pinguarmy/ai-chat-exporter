/**
 * Background task status and history: running/last-run summary, failure
 * breakdown and the Trigger / Stop / Clear actions.
 */

import { t, type Locale, type MessageKey } from '../../lib/i18n'
import type { ScheduledExportFailureReason, ScheduledExportStatus } from '../../lib/types'
import { COPY, PLATFORM_LABELS, SCHEDULED_FAILURE_LABEL_KEYS } from './options-constants'

interface ScheduleStatusPanelProps {
  scheduleStatus: ScheduledExportStatus | null
  stoppingScheduledExport: boolean
  locale: Locale
  T: (key: MessageKey) => string
  triggerScheduledExport: () => void
  stopScheduledExport: () => void
  clearExportHistory: () => void
}

export function ScheduleStatusPanel({
  scheduleStatus, stoppingScheduledExport, locale, T,
  triggerScheduledExport, stopScheduledExport, clearExportHistory,
}: ScheduleStatusPanelProps) {
  return (
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
  )
}
