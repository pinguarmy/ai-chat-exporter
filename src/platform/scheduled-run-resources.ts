import { EXPORT_CANCELLED_MESSAGE } from '../core/export-cancel'
import { reconcilePendingDownloads } from './pending-downloads'
import {
  SCHEDULED_ACTIVE_RUN_KEY,
  SCHEDULED_STOP_REQUEST_KEY,
  createScheduledRunId,
  readPersistedScheduledRun,
  readPersistedStopRequest,
  stoppedScheduledStatus,
  type PersistedScheduledRun,
  type PersistedScheduledStopRequest
} from '../core/scheduled-run-state'

// The pure record shapes and parsers live in core/scheduled-run-state; they are
// re-exported so existing importers keep one module for scheduled-run resources.
export {
  SCHEDULED_ACTIVE_RUN_KEY,
  SCHEDULED_STOP_REQUEST_KEY,
  createScheduledRunId,
  readPersistedScheduledRun,
  readPersistedStopRequest,
  stoppedScheduledStatus
}
export type { PersistedScheduledStopRequest }

let scheduledRunStateWrites: Promise<void> = Promise.resolve()

/** Serialize resource-list updates from parallel provider workers. */
async function updatePersistedScheduledRun(
  runId: string,
  mutate: (run: PersistedScheduledRun) => void,
  allowStopped = false
): Promise<boolean> {
  let updated = false
  const write = scheduledRunStateWrites
    .catch(() => undefined)
    .then(async () => {
      const stored = await chrome.storage.local.get(SCHEDULED_ACTIVE_RUN_KEY)
      const run = readPersistedScheduledRun(stored[SCHEDULED_ACTIVE_RUN_KEY])
      if (!run || run.id !== runId || (!allowStopped && run.stopRequestedAt)) return
      mutate(run)
      await chrome.storage.local.set({ [SCHEDULED_ACTIVE_RUN_KEY]: run })
      updated = true
    })
  scheduledRunStateWrites = write.catch(() => undefined)
  await write
  return updated
}

async function registerScheduledRunResource(
  runId: string,
  resource: 'tabIds' | 'downloadIds',
  id: number
): Promise<boolean> {
  return updatePersistedScheduledRun(runId, run => {
    if (!run[resource].includes(id)) run[resource].push(id)
  })
}

export async function releaseScheduledRunResource(
  runId: string,
  resource: 'tabIds' | 'downloadIds',
  id: number
): Promise<void> {
  await updatePersistedScheduledRun(runId, run => {
    run[resource] = run[resource].filter(item => item !== id)
  }, true)
}

export async function registerScheduledRunTab(runId: string | undefined, tabId: number): Promise<void> {
  if (!runId) return
  try {
    if (await registerScheduledRunResource(runId, 'tabIds', tabId)) return
  } catch (error) {
    try { await chrome.tabs.remove(tabId) } catch {}
    throw error
  }
  try { await chrome.tabs.remove(tabId) } catch {}
  throw new Error(EXPORT_CANCELLED_MESSAGE)
}

export async function registerScheduledRunDownload(runId: string | undefined, downloadId: number): Promise<void> {
  if (!runId) return
  try {
    if (await registerScheduledRunResource(runId, 'downloadIds', downloadId)) return
  } catch (error) {
    try { await chrome.downloads.cancel(downloadId) } catch {}
    throw error
  }
  try { await chrome.downloads.cancel(downloadId) } catch {}
  throw new Error(EXPORT_CANCELLED_MESSAGE)
}

export async function beginPersistedScheduledRun(runId: string): Promise<void> {
  if (!await reconcilePendingDownloads(true)) {
    throw new Error('Previous scheduled downloads are still running; retry after they finish')
  }
  // If the worker was restarted mid-run, its JavaScript queue is already gone
  // but a browser tab or download can still exist. Close those leftovers
  // before replacing the record with a fresh run.
  const existing = await chrome.storage.local.get(SCHEDULED_ACTIVE_RUN_KEY)
  const staleRun = readPersistedScheduledRun(existing[SCHEDULED_ACTIVE_RUN_KEY])
  if (staleRun) await cancelPersistedScheduledRunResources(staleRun)
  await chrome.storage.local.set({
    [SCHEDULED_ACTIVE_RUN_KEY]: {
      id: runId,
      startedAt: Date.now(),
      tabIds: [],
      downloadIds: [],
    } satisfies PersistedScheduledRun,
    [SCHEDULED_STOP_REQUEST_KEY]: null,
  })
}

export async function clearPersistedScheduledRun(runId: string): Promise<void> {
  await scheduledRunStateWrites.catch(() => undefined)
  const stored = await chrome.storage.local.get([
    SCHEDULED_ACTIVE_RUN_KEY,
    SCHEDULED_STOP_REQUEST_KEY,
  ])
  const run = readPersistedScheduledRun(stored[SCHEDULED_ACTIVE_RUN_KEY])
  const stopRequest = readPersistedStopRequest(stored[SCHEDULED_STOP_REQUEST_KEY])
  const keys: string[] = []
  if (run?.id === runId) keys.push(SCHEDULED_ACTIVE_RUN_KEY)
  if (stopRequest?.runId === runId) keys.push(SCHEDULED_STOP_REQUEST_KEY)
  if (keys.length > 0) await chrome.storage.local.remove(keys)
}

export function watchPersistedScheduledStop(runId: string, controller: AbortController): () => void {
  const onChanged = chrome.storage?.onChanged
  if (!onChanged?.addListener) return () => undefined
  const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== 'local') return
    const request = readPersistedStopRequest(changes[SCHEDULED_STOP_REQUEST_KEY]?.newValue)
    if (request?.runId === runId) {
      controller.abort()
    }
  }
  onChanged.addListener(listener)
  return () => onChanged.removeListener(listener)
}

export async function cancelPersistedScheduledRunResources(run: PersistedScheduledRun): Promise<void> {
  await Promise.all([
    ...run.downloadIds.map(id => Promise.resolve(chrome.downloads.cancel(id)).catch(() => undefined)),
    ...run.tabIds.map(id => Promise.resolve(chrome.tabs.remove(id)).catch(() => undefined)),
  ])
}
