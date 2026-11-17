import type { MessageKey } from '../../core/i18n'
/**
 * Static labels and copy for the options page. Translation keys here are
 * passed to T/t through variables (e.g. T(COPY.railSchedule)).
 */

import type {
  ExportablePlatform,
  ScheduleFrequency,
  ScheduledExportFailureReason,
  ScheduledExportPlatformState,
} from '../../core/types'

/** App version pulled from the extension manifest (single source of truth) */
export const APP_VERSION = chrome.runtime.getManifest()?.version ?? '1.2.0'

/** Platform display names */
export const PLATFORM_LABELS: Record<ExportablePlatform, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  grok: 'Grok',
}

/** Frequency translation keys */
export const FREQUENCY_LABEL_KEYS: Record<ScheduleFrequency, MessageKey> = {
  hourly: 'Hourly',
  every6h: 'Every 6 Hours',
  daily: 'Daily',
  weekly: 'Weekly',
  custom: 'Custom interval',
}

/** Safe aggregate labels: diagnostic state deliberately never includes chat titles or content. */
export const SCHEDULED_FAILURE_LABEL_KEYS: Record<ScheduledExportFailureReason, MessageKey> = {
  rate_limited: 'Provider rate limit reached',
  authentication_required: 'Sign-in required',
  detail_unavailable: 'Conversation details unavailable',
  detail_incomplete: 'Conversation details incomplete',
  fallback_unavailable: 'Page fallback unavailable',
  fallback_incomplete: 'Page fallback incomplete',
  serialization_failed: 'Export content could not be prepared',
  download_request_failed: 'Download request rejected',
  download_interrupted: 'Download interrupted',
  download_timed_out: 'Download did not complete in time',
  history_write_failed: 'Export history could not be saved',
}

export const PLATFORM_STATUS_LABEL_KEYS: Record<ScheduledExportPlatformState, MessageKey> = {
  ready: 'Ready — signed in',
  auth_required: 'Sign-in required',
  rate_limited: 'Rate limited — retry later',
  error: 'Check failed',
}

/**
 * Archive Desk copy introduced with the schedule rail. Keys are passed to
 * T/t via variables (the same pattern as FREQUENCY_LABEL_KEYS).
 */
export const COPY = {
  railSchedule: 'Schedule',
  railOn: 'On',
  railOff: 'Off',
  railChecks: 'Export interval',
  railCadence: 'Runs every {0} minutes for enabled platforms. You can override an individual platform below.',
  checkInterval: 'Scheduled export interval (minutes)',
  minutesSuffix: 'min',
  railOutput: 'Output',
  railSavedTo: 'Saved to',
  markdownOnly:
    'Scheduled exports are Markdown only — the background worker cannot render PDF. PDF remains available from manual Current Chat and Bulk Export.',
  timing:
    'Runs while Chrome and the extension are alive. Changing the interval above applies that rolling schedule to every enabled platform; individual platform settings can override it. A set time means at or shortly after it — never to the exact second.',
  timeLocal: 'Time (local)',
  day: 'Day',
  runAt: 'Runs at or shortly after {0}, local time.',
  rolling: 'No time set — runs on a rolling interval from the last run.',
  customInterval: 'Interval (minutes)',
  customIntervalHint: 'Runs on a rolling interval from the last completed run. Very short intervals can trigger provider rate limits.',
  everyMinutes: 'Runs every {0} minutes, at or shortly after the interval is due.',
  runNowHint: 'Runs immediately, bypassing the next-due check',
  localTimeFor: 'Local time for {0}',
  weekdayFor: 'Weekday for {0}',
  conversationConcurrency: 'Conversation concurrency',
  conversationConcurrencyHint:
    'Up to {0} detail reads may overlap for {1}. 1 is recommended; higher can finish sooner when requests are slow, but may trigger this provider’s rate limit.',
  concurrentChoice: '{0} concurrent read{1}',
  recommendedChoice: '1 — Recommended',
  parallelProviderOne: '1 — One platform at a time',
  parallelProviderBalanced: '2 — Balanced (recommended)',
  parallelProviderFast: '3 — Fastest (up to 3 platforms)',
  parallelProviders:
    'How many different providers may run together (1–3). This is separate from each provider’s conversation concurrency.',
  requestDelay:
    'Minimum interval between starting detail reads for each provider ({0}s)',
  rateLimitStatus:
    'Rate limited: {0}. New reads for these providers stopped; queued conversations remain eligible next run. Reduce conversation concurrency or increase the request delay before retrying.',
  nextRun: 'Next run: {0}',
  dueNow: 'Due on the next background check',
  nextRunPending: 'Calculating next run…',
  statusChecked: 'Checked {0}',
  platformStatusNotChecked: 'Not checked yet',
  platformStatusHint: 'Status reflects the last background check; it does not keep your provider credentials.',
} as const satisfies Record<string, MessageKey>
