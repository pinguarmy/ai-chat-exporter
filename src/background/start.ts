/**
 * Background service worker wiring.
 *
 * This file only wires things together. MV3 requires every event listener to
 * be registered synchronously while the worker's top level runs, so keep all
 * of the calls below synchronous and in this order (it matches the order the
 * single-file worker used to execute them in).
 *
 * Domain logic lives in the sibling modules; message types and shapes are
 * defined in src/platform/background-messages.ts.
 *
 * `startBackground()` is invoked by the WXT entry (src/entrypoints/background.ts)
 * during the worker's synchronous top-level run, and by `./index` for tests.
 */
import { registerUninstallFeedback } from '../platform/support'
import { registerDownloadListeners } from './downloads'
import {
  allowContentScriptSessionStorage,
  ensureCleanupAlarm,
  registerAlarmListener,
  registerInstallListener,
  registerSettingsAlarmSync,
  runStartupCleanup,
  syncScheduledExportAlarm
} from './lifecycle'
import { initializeManualBackgroundJobs } from './manual-export'
import { registerRecoveryListeners, startRecoveryInitialization } from './recovery'
import { onRuntimeMessage } from './router'

export function startBackground(): void {
  void registerUninstallFeedback()
  registerInstallListener()
  void allowContentScriptSessionStorage()
  initializeManualBackgroundJobs()
  registerDownloadListeners()
  runStartupCleanup()
  registerRecoveryListeners()
  void syncScheduledExportAlarm()
  registerSettingsAlarmSync()
  ensureCleanupAlarm()
  chrome.runtime.onMessage.addListener(onRuntimeMessage)
  startRecoveryInitialization()
  registerAlarmListener()
}
