/**
 * Worker lifecycle: install defaults, the scheduled-export and cleanup alarms,
 * startup cleanup passes, and session-storage access for content scripts.
 * Every register* function only calls addListener and is meant to run
 * synchronously while the worker's top level evaluates (MV3 requirement).
 */
import type { ScheduledExportSettings } from '../lib/types'
import { DEFAULT_SETTINGS } from '../lib/types'
import {
  ALL_PLATFORMS,
  clampScheduledCheckIntervalMinutes,
  clampScheduledIntervalMinutes,
} from '../lib/scheduled-export'
import { reconcilePendingDownloads } from '../lib/pending-downloads'
import { cleanupExpiredPreviewSnapshots, sweepUnindexedPreviewSnapshots } from '../lib/preview-snapshots'
import { cleanupPageSnapshotPreviews } from '../lib/page-snapshot-cache'
import { cleanupRecoveryDrafts } from '../lib/recovery-drafts'
import { isScheduledRunActive, startScheduledExport } from './scheduled-export'
import { getScheduledExportSettings } from './scheduled-settings'

const SCHEDULED_EXPORT_ALARM_NAME = 'scheduled-export-check'
const CLEANUP_ALARM_NAME = 'cleanup-exports'

/**
 * Chrome alarms are only the wake-up mechanism; each platform still decides
 * whether it is due from its own last-run checkpoint. The global cadence is
 * user-configurable; a shorter enabled platform interval still wins so its
 * configured due time is never postponed by the wake-up cadence.
 */
export function getScheduledExportAlarmPeriodMinutes(
  config: Pick<ScheduledExportSettings, 'platforms'> & Partial<Pick<ScheduledExportSettings, 'checkIntervalMinutes'>>,
): number {
  const configuredInterval = clampScheduledCheckIntervalMinutes(config.checkIntervalMinutes)
  const customIntervals = ALL_PLATFORMS
    .map(platform => config.platforms[platform])
    .filter(platform => platform?.enabled && platform.frequency === 'custom')
    .map(platform => clampScheduledIntervalMinutes(platform?.intervalMinutes))

  return Math.max(
    1,
    Math.min(configuredInterval, ...customIntervals),
  )
}

export async function syncScheduledExportAlarm(): Promise<void> {
  try {
    const config = await getScheduledExportSettings()
    if (!config.enabled) {
      await chrome.alarms.clear(SCHEDULED_EXPORT_ALARM_NAME)
      return
    }
    const targetPeriod = getScheduledExportAlarmPeriodMinutes(config)
    const existing = await new Promise<chrome.alarms.Alarm | undefined>((resolve) => {
      try {
        chrome.alarms.get(SCHEDULED_EXPORT_ALARM_NAME, alarm => resolve(alarm))
      } catch {
        resolve(undefined)
      }
    })
    if (existing && existing.periodInMinutes === targetPeriod) return
    await chrome.alarms.create(SCHEDULED_EXPORT_ALARM_NAME, {
      periodInMinutes: targetPeriod,
    })
  } catch {
    // Alarm setup is best-effort. The next worker start retries it.
  }
}


/** Listen for extension installation. */
export function registerInstallListener(): void {
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      // Set default settings on first install
      void chrome.storage.local.set({ settings: DEFAULT_SETTINGS }).then(() => syncScheduledExportAlarm())
      chrome.alarms.create(CLEANUP_ALARM_NAME, { periodInMinutes: 60 })
    }
  })
}

/**
 * The Gemini credential bridge lives in a content script, but
 * chrome.storage.session is a trusted-context area by default: without this
 * call every read and write from that content script is rejected. The access
 * level is per browser session and the session area is cleared on restart, so
 * this runs at worker startup rather than only from onInstalled.
 *
 * If this is unavailable the parser probes and falls back to
 * chrome.storage.local, which keeps exports working at the cost of writing
 * tokens to disk (see src/contents/gemini-parser.ts).
 */
export async function allowContentScriptSessionStorage(): Promise<boolean> {
  const session = chrome.storage?.session as
    | (chrome.storage.StorageArea & {
        setAccessLevel?: (options: { accessLevel: string }) => Promise<void>
      })
    | undefined
  if (typeof session?.setAccessLevel !== 'function') return false
  try {
    await session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
    return true
  } catch {
    // Older Chromium and some Firefox builds reject or omit this method.
    return false
  }
}

/**
 * Snapshots written by releases before the key index existed have no index
 * entry, so index-based cleanup can never reach them. Reconcile them once.
 */
export function runStartupCleanup(): void {
  void sweepUnindexedPreviewSnapshots()
  void cleanupPageSnapshotPreviews().catch(() => console.warn('[Snapshot] Temporary cache cleanup will retry'))
  void cleanupRecoveryDrafts().catch(() => console.warn('[Recovery] Draft cleanup will retry'))
}

/**
 * The options page persists settings directly so every control can autosave.
 * React to that storage event as well, otherwise a newly selected interval
 * would not change the alarm until the next worker restart.
 */
export function registerSettingsAlarmSync(): void {
  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.settings) void syncScheduledExportAlarm()
  })
}

/**
 * Conversation snapshots are only needed briefly for the preview page. Keep
 * their expiry alarm alive across extension restarts and upgrades.
 */
export function ensureCleanupAlarm(): void {
  chrome.alarms.get(CLEANUP_ALARM_NAME, (alarm) => {
    if (!alarm) {
      chrome.alarms.create(CLEANUP_ALARM_NAME, { periodInMinutes: 60 })
    }
  })
}

export function registerAlarmListener(): void {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === SCHEDULED_EXPORT_ALARM_NAME) {
      startScheduledExport(false)
    }
    if (alarm.name !== CLEANUP_ALARM_NAME) return
    try {
      // Read only the indexed preview snapshot keys. Scanning the whole storage
      // area with get(null) would deserialize every cached conversation and
      // credential on each pass just to filter by prefix.
      await cleanupExpiredPreviewSnapshots()
      await cleanupPageSnapshotPreviews()
      await cleanupRecoveryDrafts()
      if (!isScheduledRunActive()) await reconcilePendingDownloads()
    } catch (error) {
      console.warn('[Export Cleanup] Cleanup failed; retained state will be retried')
    }
  })
}
