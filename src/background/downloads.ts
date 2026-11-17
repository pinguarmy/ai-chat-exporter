import { reconcilePendingDownloads } from '../platform/pending-downloads'
import { isScheduledRunActive } from './scheduled-export'
import { createLogger } from '../core/logger'

const log = createLogger('Scheduled Export')

// A late completion can wake a fresh MV3 worker. The ledger survives both
// timeout cleanup and worker restarts, unlike an in-memory promise.
//
// Do not register chrome.downloads.onDeterminingFilename here: a listener that
// does not call suggest() with the requested filename would override the
// filenames chosen by the exporters.
export function registerDownloadListeners(): void {
  chrome.downloads?.onChanged?.addListener(delta => {
    if (!isScheduledRunActive() && (delta.state?.current === 'complete' || delta.state?.current === 'interrupted')) {
      void reconcilePendingDownloads().catch(() => log.warn('Download reconciliation failed; records retained'))
    }
  })
}
