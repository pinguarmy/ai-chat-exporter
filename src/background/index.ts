/**
 * Background service worker entry.
 *
 * This file only wires things together. MV3 requires every event listener to
 * be registered synchronously while the worker's top level runs, so keep all
 * of the calls below synchronous and in this order (it matches the order the
 * single-file worker used to execute them in).
 *
 * Domain logic lives in the sibling modules; message types and shapes are
 * defined in src/platform/background-messages.ts.
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

// Public surface kept for tests and other modules.
export {
  SCHEDULED_ACTIVE_RUN_KEY,
  SCHEDULED_STOP_REQUEST_KEY
} from '../platform/scheduled-run-resources'
export { isProviderConversationUrl } from './background-fetch'
export { clearExportedHistory } from './export-history'
export { allowContentScriptSessionStorage, getScheduledExportAlarmPeriodMinutes } from './lifecycle'
export { handleScheduledExportStop } from './scheduled-export'
export {
  buildScheduledExportOptions,
  classifyScheduledDownloadFailure,
  fetchScheduledConversationList,
  recordScheduledFailure,
  recordScheduledRateLimit,
  resolveScheduledConversation,
  type ScheduledConversationResolution
} from './scheduled-policy'
