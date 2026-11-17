/**
 * Live progress for a foreground bulk run (only rendered while fetching or
 * exporting) with the Stop action.
 */

import type { BulkExportProgress } from '../../lib/types'
import type { Translate } from './popup-utils'

interface BulkProgressBarProps {
  bulkProgress: BulkExportProgress
  stoppingExport: boolean
  T: Translate
  stopActiveExport: () => void
}

export function BulkProgressBar({ bulkProgress, stoppingExport, T, stopActiveExport }: BulkProgressBarProps) {
  return (
    <div className="flex-col gap-1">
      <div className="flex justify-between text-xs font-medium">
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '280px' }}>
          {bulkProgress.status === 'fetching' ? T('Fetching...') : `${T('Exporting:')}${bulkProgress.current}`}
        </span>
        <span>{Math.round((bulkProgress.completed / bulkProgress.total) * 100)}%</span>
      </div>
      <div className="progress-bg">
        <div className="progress-fill" style={{ width: `${(bulkProgress.completed / bulkProgress.total) * 100}%` }} />
      </div>
      <button type="button" className="btn btn-outline btn-compact export-stop-btn" onClick={stopActiveExport} disabled={stoppingExport}>
        {stoppingExport ? T('Stopping…') : T('Stop Export')}
      </button>
    </div>
  )
}
