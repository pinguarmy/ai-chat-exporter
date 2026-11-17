import type { ScheduledExportStatus } from './types'

// Manifest V3 can suspend and recreate this service worker at any time. Keep
// the resources that belong to a scheduled run in extension storage so Stop
// still has something concrete to cancel after a restart, rather than relying
// only on an in-memory AbortController.
export const SCHEDULED_ACTIVE_RUN_KEY = 'scheduledExport-activeRun'
export const SCHEDULED_STOP_REQUEST_KEY = 'scheduledExport-stopRequest'

export interface PersistedScheduledRun {
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
