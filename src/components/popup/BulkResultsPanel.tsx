/**
 * Outcome of the last foreground bulk run: counts, retry and failed items.
 * Rendered only after a run has produced results and is no longer running.
 */

import { t, type Locale } from '../../lib/i18n'
import type { BulkFailedItem } from '../../lib/bulk-selection'
import type { BulkExportProgress, ConversationListItem } from '../../lib/types'
import { getCategoryLabel, type Translate } from './popup-utils'

interface BulkResultsPanelProps {
  bulkProgress: BulkExportProgress
  bulkFailedItems: BulkFailedItem[]
  conversationList: ConversationListItem[]
  loading: boolean
  bulkLoading: boolean
  locale: Locale
  T: Translate
  handleRetryFailed: () => void
}

export function BulkResultsPanel({
  bulkProgress, bulkFailedItems, conversationList, loading, bulkLoading, locale, T, handleRetryFailed,
}: BulkResultsPanelProps) {
  return (
    <div className="bulk-results-panel" role="region" aria-label={T('Export results')}>
      <div className="bulk-results-summary">
        <span className="bulk-results-count">
          {t('Completed: {0} · Failed: {1}', locale, bulkProgress.completed, bulkProgress.failed)}
        </span>
        {bulkFailedItems.length > 0 && (
          <button
            type="button"
            className="btn btn-outline btn-compact retry-failed-btn"
            onClick={handleRetryFailed}
            disabled={loading || bulkLoading}
            aria-label={t('Retry failed ({0})', locale, bulkFailedItems.length)}
          >
            {t('Retry failed ({0})', locale, bulkFailedItems.length)}
          </button>
        )}
      </div>
      {bulkFailedItems.length > 0 && (
        <div className="bulk-failed-list">
          <span className="section-label">{T('Failed items:')}</span>
          <div className="bulk-failed-items">
            {bulkFailedItems.map(item => {
              const conv = conversationList.find(c => c.id === item.id)
              const title = conv?.title || item.id
              const categoryLabel = getCategoryLabel(item.category, locale)
              return (
                <div key={item.id} className="bulk-failed-item">
                  <span className="bulk-failed-title" title={title}>{title}</span>
                  <span className={`badge badge-error badge-${item.category}`}>{categoryLabel}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
