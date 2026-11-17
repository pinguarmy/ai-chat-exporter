/**
 * Scheduled export orchestration: single-flight run state, the due-platform
 * queue, and the run/stop message handlers. Per-provider work lives in
 * scheduled-platform-run.ts.
 */
import type { ExportablePlatform, ScheduledExportStatus } from '../core/types'
import {
  SCHEDULED_ACTIVE_RUN_KEY, SCHEDULED_STOP_REQUEST_KEY,
  type PersistedScheduledStopRequest,
  createScheduledRunId, readPersistedScheduledRun, readPersistedStopRequest,
  beginPersistedScheduledRun, clearPersistedScheduledRun, watchPersistedScheduledStop,
  stoppedScheduledStatus, cancelPersistedScheduledRunResources,
} from '../platform/scheduled-run-resources'
import { reconcilePendingDownloads } from '../platform/pending-downloads'
import {
  ALL_PLATFORMS,
  ScheduledRunBudget,
  isDueForSchedule,
  isExportCancelledError,
  runWithConcurrency,
  throwIfExportCancelled,
} from '../core/scheduled-export'
import { runScheduledExportForPlatform } from './scheduled-platform-run'
import { getScheduledExportSettings } from './scheduled-settings'
import { createScheduledStatusReporter } from './scheduled-status'

// A module-level single-flight guard closes the async gap between checking
// storage and setting the per-platform status. The storage status remains the
// restart-visible diagnostic; this guard prevents duplicate runs in one
// service-worker lifetime.
let scheduledRunPromise: Promise<void> | null = null
let scheduledRunController: AbortController | null = null

/** True while a scheduled run owns this service-worker lifetime's single-flight guard. */
export function isScheduledRunActive(): boolean {
  return Boolean(scheduledRunPromise)
}

/**
 * Handle manual scheduled export run request
 */
export async function handleScheduledExportRun(): Promise<{ data?: boolean; error?: string }> {
  try {
    // A user-triggered run must not be held back by the next scheduled due
    // time (or by the global schedule toggle).
    if (!startScheduledExport(true)) return { error: 'Scheduled export already running' }
    return { data: true }
  } catch (err) {
    return { error: (err as Error).message }
  }
}


/**
 * Stop the active scheduled queue. The active run and its resource IDs are
 * persisted because a Manifest V3 worker may be recreated between starting a
 * queue and a user pressing Stop.
 */
export async function handleScheduledExportStop(): Promise<{ data?: boolean; error?: string }> {
  const now = Date.now()
  try {
    const stored = await chrome.storage.local.get([
      'scheduledExportStatus',
      SCHEDULED_ACTIVE_RUN_KEY,
    ])
    const status = stored.scheduledExportStatus as ScheduledExportStatus | undefined
    const persistedRun = readPersistedScheduledRun(stored[SCHEDULED_ACTIVE_RUN_KEY])
    const activeRunId = persistedRun?.id ?? status?.runId
    const hasInMemoryRun = Boolean(scheduledRunController && scheduledRunPromise)

    if (activeRunId) {
      const stopUpdate: Record<string, unknown> = {
        [SCHEDULED_STOP_REQUEST_KEY]: { runId: activeRunId, requestedAt: now } satisfies PersistedScheduledStopRequest,
      }
      if (persistedRun) {
        stopUpdate[SCHEDULED_ACTIVE_RUN_KEY] = { ...persistedRun, stopRequestedAt: now }
      }
      await chrome.storage.local.set(stopUpdate)
      if (persistedRun) await cancelPersistedScheduledRunResources(persistedRun)
    }

    scheduledRunController?.abort()

    if (status?.isRunning) {
      await chrome.storage.local.set({
        scheduledExportStatus: hasInMemoryRun
          ? { ...status, lastRunCancelled: true, stopRequested: true }
          : stoppedScheduledStatus(status, now),
      })
    }

    // A controller can be temporarily absent after a worker restart. In that
    // case we still canceled the persisted browser resources and cleared the
    // stale running state above, so the user receives a successful stop.
    return { data: Boolean(activeRunId || hasInMemoryRun || status?.isRunning) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not stop scheduled export' }
  }
}

/**
 * Main entry: check all platforms and run scheduled exports as needed
 */
async function checkAndRunScheduledExports(
  force = false,
  signal?: AbortSignal,
  runId?: string
): Promise<void> {
  throwIfExportCancelled(signal)
  const config = await getScheduledExportSettings()
  if (!config.enabled && !force) return
  throwIfExportCancelled(signal)

  // Prevent concurrent runs
  const statusResult = await chrome.storage.local.get('scheduledExportStatus')
  const currentStatus = statusResult.scheduledExportStatus as ScheduledExportStatus | undefined
  // startScheduledExport's single-flight guard means this function only runs
  // with a freshly minted runId, so a persisted "running" status with any
  // other runId — including one this dead worker's previous lifetime wrote —
  // belongs to a run whose JS queue no longer exists. Close that stale status
  // before starting a new queue so it cannot make the UI look permanently
  // "running" or block automatic retries for up to two hours.
  if (currentStatus?.isRunning && currentStatus.runId !== runId) {
    await chrome.storage.local.set({
      scheduledExportStatus: stoppedScheduledStatus(currentStatus),
    })
  }

  const now = Date.now()
  const duePlatforms: ExportablePlatform[] = []
  for (const platform of ALL_PLATFORMS) {
    const platformConfig = config.platforms[platform]
    if (!platformConfig?.enabled) continue

    const lastRunKey = `scheduledExport-lastRun-${platform}`
    const result = await chrome.storage.local.get(lastRunKey)
    const lastRun = (result[lastRunKey] as number) || 0

    if (force || isDueForSchedule(platformConfig, lastRun, now)) {
      duePlatforms.push(platform)
    }
  }

  if (duePlatforms.length === 0) return
  throwIfExportCancelled(signal)

  const reporter = createScheduledStatusReporter({
    runId,
    lastRunAt: now,
    isRunning: true,
    lastRunExported: 0,
    lastRunFailed: 0,
    lastRunFailureBreakdown: {},
    lastRunFallbackRecovered: 0,
    lastRunRateLimitedPlatforms: [],
    platformStatuses: currentStatus?.platformStatuses,
    activePlatforms: [],
    lastRunCancelled: false,
    stopRequested: false,
  })
  await reporter.persist()

  const budget = new ScheduledRunBudget(config.maxTotalPerRun)
  try {
    await runWithConcurrency(duePlatforms, config.maxConcurrentPlatforms, async (platform) => {
      if (signal?.aborted) {
        reporter.status.lastRunCancelled = true
        return
      }

      reporter.markProviderActive(platform)
      try {
        const runResult = await runScheduledExportForPlatform(platform, config, budget, reporter, signal, runId)
        // Repeat mode honors cadence after an actual attempt, even on failure,
        // so retries cannot download the same successful prefix every wake-up.
        // Archive-once retains its existing retry policy; diagnostics stay separate.
        const repeatAttempted = !config.platforms[platform].skipAlreadyExported && runResult.attempted > 0
        if ((runResult.succeeded || repeatAttempted) && !runResult.cancelled && !signal?.aborted) {
          try {
            await chrome.storage.local.set({ [`scheduledExport-lastRun-${platform}`]: now })
          } catch {
            // A checkpoint failure must not leave the visible task stuck in
            // “running”. The dedup index still prevents duplicate files, and
            // the next scan can retry the checkpoint safely.
            reporter.status.lastRunError = 'The scheduled checkpoint could not be saved.'
            void reporter.persist()
          }
        }
      } finally {
        reporter.markProviderInactive(platform)
      }
    })
  } catch (error) {
    if (isExportCancelledError(error) || signal?.aborted) {
      reporter.status.lastRunCancelled = true
    } else {
      // This is a queue-level failure, not a provider response. Keep the
      // diagnostic generic so status never stores conversation data.
      reporter.status.lastRunError = 'The scheduled export queue stopped unexpectedly.'
    }
  } finally {
    reporter.status.lastRunFinishedAt = Date.now()
    reporter.status.isRunning = false
    reporter.status.lastRunCancelled ||= Boolean(signal?.aborted)
    reporter.status.stopRequested = false
    await reporter.persist()
    await reporter.flush()
  }
}

export function startScheduledExport(force: boolean): boolean {
  if (scheduledRunPromise) return false
  const controller = new AbortController()
  const runId = createScheduledRunId()
  scheduledRunController = controller
  const removeStopWatcher = watchPersistedScheduledStop(runId, controller)
  scheduledRunPromise = (async () => {
    await beginPersistedScheduledRun(runId)
    const stored = await chrome.storage.local.get(SCHEDULED_STOP_REQUEST_KEY)
    if (readPersistedStopRequest(stored[SCHEDULED_STOP_REQUEST_KEY])?.runId === runId) {
      controller.abort()
    }
    await checkAndRunScheduledExports(force, controller.signal, runId)
  })()
    .catch(async () => {
      // Keep the service worker promise handled while retaining a diagnostic
      // that does not include conversation text or credentials.
      console.error('[Scheduled Export] Run could not start or finish; retained state will be retried')
      try {
        const stored = await chrome.storage.local.get('scheduledExportStatus')
        await chrome.storage.local.set({ scheduledExportStatus: {
          lastRunExported: 0, lastRunFailed: 0,
          ...stored.scheduledExportStatus,
          isRunning: false,
          lastRunError: 'Scheduled export state could not be reconciled. Please retry after pending downloads finish.',
        } })
      } catch {
        console.warn('[Scheduled Export] Could not save reconciliation status')
      }
    })
    .finally(async () => {
      removeStopWatcher()
      try {
        if (!await reconcilePendingDownloads(true)) {
          console.warn('[Scheduled Export] Downloads still running; retained for reconciliation')
        }
        await clearPersistedScheduledRun(runId)
      } catch {
        console.warn('[Scheduled Export] Resource reconciliation failed; records retained')
      }
      if (scheduledRunController === controller) scheduledRunController = null
      scheduledRunPromise = null
    })
  return true
}
