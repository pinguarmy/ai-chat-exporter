import type { ExportablePlatform, ScheduledExportPlatformState, ScheduledExportStatus } from '../lib/types'

export interface ScheduledStatusReporter {
  status: ScheduledExportStatus
  markProviderActive: (platform: ExportablePlatform) => void
  markProviderInactive: (platform: ExportablePlatform) => void
  markPlatformStatus: (platform: ExportablePlatform, state: ScheduledExportPlatformState) => void
  persist: () => Promise<void>
  flush: () => Promise<void>
}

/**
 * Multiple providers may finish at nearly the same time. Persist status writes
 * in order so one worker cannot overwrite another worker's counts or active
 * platform list.
 */
export function createScheduledStatusReporter(status: ScheduledExportStatus): ScheduledStatusReporter {
  let writes = Promise.resolve()

  const snapshot = (): ScheduledExportStatus => ({
    ...status,
    activePlatforms: [...(status.activePlatforms ?? [])],
    lastRunRateLimitedPlatforms: [...(status.lastRunRateLimitedPlatforms ?? [])],
    platformStatuses: status.platformStatuses
      ? Object.fromEntries(
        Object.entries(status.platformStatuses).map(([platform, value]) => [platform, value ? { ...value } : value])
      ) as ScheduledExportStatus['platformStatuses']
      : undefined,
  })

  const persist = () => {
    const next = snapshot()
    writes = writes
      .catch(() => undefined)
      .then(() => chrome.storage.local.set({ scheduledExportStatus: next }))
      .catch(() => undefined)
    return writes
  }

  const syncCurrentPlatform = () => {
    status.currentPlatform = status.activePlatforms?.[0]
  }

  return {
    status,
    markProviderActive(platform) {
      const active = status.activePlatforms ?? (status.activePlatforms = [])
      if (!active.includes(platform)) active.push(platform)
      syncCurrentPlatform()
      void persist()
    },
    markProviderInactive(platform) {
      status.activePlatforms = (status.activePlatforms ?? []).filter(item => item !== platform)
      syncCurrentPlatform()
      void persist()
    },
    markPlatformStatus(platform, state) {
      const statuses = status.platformStatuses ?? (status.platformStatuses = {})
      statuses[platform] = { state, checkedAt: Date.now() }
      void persist()
    },
    persist,
    async flush() {
      await writes
    },
  }
}
