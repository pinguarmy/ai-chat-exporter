/**
 * Start a browser download and wait until Chrome/Firefox reports that the
 * file is complete. A download id only means that the transfer was queued;
 * callers must await this helper before recording export history.
 */
import { EXPORT_CANCELLED_MESSAGE } from './export-cancel'

export interface DownloadWaitControl {
  /** Stops an in-flight transfer when the caller cancels its export queue. */
  signal?: AbortSignal
  /** Lets a coordinator durably retain the browser download id before waiting. */
  onStarted?: (downloadId: number) => void | Promise<void>
}

export async function downloadAndWait(
  options: chrome.downloads.DownloadOptions,
  timeoutMs = 60_000,
  downloadsApi: typeof chrome.downloads = chrome.downloads,
  control: DownloadWaitControl = {}
): Promise<number> {
  const { signal, onStarted } = control
  if (signal?.aborted) throw new Error(EXPORT_CANCELLED_MESSAGE)

  const downloadId = await downloadsApi.download(options)
  try {
    const started = onStarted?.(downloadId)
    if (started) await started
  } catch (error) {
    // If durable registration fails, do not leave an untracked download running.
    try { await downloadsApi.cancel?.(downloadId) } catch {}
    throw error
  }

  const cancelDownload = () => {
    if (!downloadsApi.cancel) return
    Promise.resolve(downloadsApi.cancel(downloadId)).catch(() => {
      // A data URL can complete before cancellation reaches the browser.
    })
  }

  if (signal?.aborted) {
    cancelDownload()
    throw new Error(EXPORT_CANCELLED_MESSAGE)
  }

  // Some unit-test/browser shims expose download() but not onChanged. Keep a
  // compatibility path for those environments; real extension manifests
  // include the downloads permission and provide the event API.
  if (!downloadsApi.onChanged?.addListener) return downloadId

  return new Promise<number>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => finish(new Error('Download completion timed out')), timeoutMs)

    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      try {
        downloadsApi.onChanged.removeListener(onChanged)
      } catch {
        // The browser may tear down the service context while the download is
        // still present; there is nothing useful left to clean up.
      }
    }

    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve(downloadId)
    }

    const onChanged = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id !== downloadId) return
      if (delta.error?.current) {
        finish(new Error(`Download interrupted: ${delta.error.current}`))
        return
      }
      if (delta.state?.current === 'interrupted') {
        finish(new Error('Download interrupted'))
        return
      }
      if (delta.state?.current === 'complete') finish()
    }

    const onAbort = () => {
      cancelDownload()
      finish(new Error(EXPORT_CANCELLED_MESSAGE))
    }

    downloadsApi.onChanged.addListener(onChanged)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }

    // The event can fire before the listener is attached, especially for a
    // small data URL. Search the item once to close that race window.
    if (downloadsApi.search) {
      downloadsApi.search({ id: downloadId }).then(items => {
        const state = items[0]?.state
        if (state === 'complete') finish()
        else if (state === 'interrupted') finish(new Error('Download interrupted'))
      }).catch(() => {
        // The event listener remains authoritative if search is unavailable.
      })
    }
  })
}
