import type { ScheduledExportStatus } from './types'
import { EXPORT_CANCELLED_MESSAGE } from './export-cancel'
import { reconcilePendingDownloads } from './pending-downloads'

// Manifest V3 can suspend and recreate this service worker at any time. Keep
// the resources that belong to a scheduled run in extension storage so Stop
// still has something concrete to cancel after a restart, rather than relying
// only on the AbortController above.
export const SCHEDULED_ACTIVE_RUN_KEY = 'scheduledExport-activeRun'
export const SCHEDULED_STOP_REQUEST_KEY = 'scheduledExport-stopRequest'

interface PersistedScheduledRun {
  id: string
  startedAt: number
  tabIds: number[]
  downloadIds: number[]
  stopRequestedAt?: number
}

export interface PersistedScheduledStopRequest {
  runId: string
  requestedAt: number
}

let scheduledRunStateWrites: Promise<void> = Promise.resolve()

export function createScheduledRunId(): string {
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
  return `scheduled-${Date.now()}-${randomId}`
}

function readResourceIds(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is number => Number.isSafeInteger(item) && item >= 0))]
}

export function readPersistedScheduledRun(value: unknown): PersistedScheduledRun | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<PersistedScheduledRun>
  if (typeof candidate.id !== 'string' || !candidate.id || !Number.isFinite(candidate.startedAt)) return null
  return {
    id: candidate.id,
    startedAt: candidate.startedAt,
    tabIds: readResourceIds(candidate.tabIds),
    downloadIds: readResourceIds(candidate.downloadIds),
    stopRequestedAt: Number.isFinite(candidate.stopRequestedAt) ? candidate.stopRequestedAt : undefined,
  }
}

export function readPersistedStopRequest(value: unknown): PersistedScheduledStopRequest | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<PersistedScheduledStopRequest>
  if (typeof candidate.runId !== 'string' || !candidate.runId || !Number.isFinite(candidate.requestedAt)) {
    return null
  }
  return { runId: candidate.runId, requestedAt: candidate.requestedAt }
}

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

export function stoppedScheduledStatus(status: ScheduledExportStatus, finishedAt = Date.now()): ScheduledExportStatus {
  return {
    ...status,
    isRunning: false,
    currentPlatform: undefined,
    activePlatforms: [],
    lastRunCancelled: true,
    stopRequested: false,
    lastRunFinishedAt: finishedAt,
  }
}

export async function cancelPersistedScheduledRunResources(run: PersistedScheduledRun): Promise<void> {
  await Promise.all([
    ...run.downloadIds.map(id => Promise.resolve(chrome.downloads.cancel(id)).catch(() => undefined)),
    ...run.tabIds.map(id => Promise.resolve(chrome.tabs.remove(id)).catch(() => undefined)),
  ])
}
