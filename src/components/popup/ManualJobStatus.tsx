/**
 * Banner for the background (manual) export job: progress, stop/resume/retry
 * and the failed-items list.
 */

import { t, type Locale } from '../../lib/i18n'
import type { ManualExportJob } from '../../lib/manual-export-job'
import { getCategoryLabel, type Translate } from './popup-utils'

interface ManualJobStatusProps {
  manualJob: ManualExportJob
  loading: boolean
  locale: Locale
  T: Translate
  onStop: () => void
  onResume: () => void
  onRetryFailed: () => void
}

export function ManualJobStatus({ manualJob, loading, locale, T, onStop, onResume, onRetryFailed }: ManualJobStatusProps) {
  return (
    <div className="manual-job-status" role="status">
      <div className="manual-job-summary">
        <span>{T('Background export')} · {manualJob.diagnosticCount ? `${T('Export diagnostics')}: ${manualJob.diagnosticCount} · ` : ''} {manualJob.completedIds.length}/{manualJob.items.length} · {t('Failed: {0}', locale, manualJob.failed.length)} · {T(manualJob.status === 'running' ? 'Running' : manualJob.status === 'done' ? 'Finished' : manualJob.status === 'cancelled' ? 'Cancelled' : 'Interrupted')}</span>
        <span className="manual-job-actions">
          {manualJob.status === 'running'
            ? <button type="button" className="link-btn" onClick={onStop}>{T('Stop Export')}</button>
            : <>
                {manualJob.completedIds.length < manualJob.items.length && <button type="button" className="link-btn" onClick={onResume}>{T('Resume remaining')}</button>}
                {manualJob.failed.length > 0 && (
                  <button
                    type="button"
                    className="link-btn retry-failed-btn"
                    onClick={onRetryFailed}
                    disabled={loading}
                    aria-label={t('Retry failed ({0})', locale, manualJob.failed.length)}
                  >
                    {t('Retry failed ({0})', locale, manualJob.failed.length)}
                  </button>
                )}
              </>}
        </span>
      </div>
      {/* Reuse the foreground bulk failed panel: titles come from the job's
          own items, ids/categories from manualJob.failed. */}
      {manualJob.status !== 'running' && manualJob.failed.length > 0 && (
        <div className="bulk-failed-list">
          <span className="section-label">{T('Failed items:')}</span>
          <div className="bulk-failed-items">
            {manualJob.failed.map(item => {
              const title = manualJob.items.find(entry => entry.id === item.id)?.title || item.id
              return (
                <div key={item.id} className="bulk-failed-item">
                  <span className="bulk-failed-title" title={title}>{title}</span>
                  <span className={`badge badge-error badge-${item.category}`}>{getCategoryLabel(item.category, locale)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
