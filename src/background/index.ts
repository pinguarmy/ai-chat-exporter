/**
 * Importable background module: runs the worker wiring (see ./start) as an
 * import side effect and re-exports the public surface that tests and other
 * modules use. The extension itself starts the worker from
 * src/entrypoints/background.ts, which calls `startBackground()` directly.
 */
import { startBackground } from './start'

startBackground()

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
