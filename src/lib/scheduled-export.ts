/**
 * Scheduled export utility functions
 * Pure functions for scheduling logic — no Chrome API dependencies
 */

import type {
  ExportablePlatform,
  PlatformScheduleConfig,
  ScheduleFrequency,
  ScheduledExportSettings,
} from './types'
import { EXPORT_CANCELLED_MESSAGE, isExportCancelledError, throwIfExportCancelled } from './export-cancel'

export { EXPORT_CANCELLED_MESSAGE, isExportCancelledError, throwIfExportCancelled } from './export-cancel'

/** Keep provider fan-out conservative even when an old or hand-edited record is stored. */
export function clampScheduledPlatformConcurrency(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 2
  return Math.min(3, Math.max(1, Math.floor(parsed)))
}

/**
 * One is the recommended default for every provider. The upper bound is kept
 * intentionally small: these are authenticated web-app endpoints, not a
 * published bulk-export API, and the user should be able to trade speed for
 * risk without accidentally creating a request storm.
 */
export function clampScheduledConversationConcurrency(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 1
  return Math.min(3, Math.max(1, Math.floor(parsed)))
}

/** Bound a provider queue so one malformed persisted value cannot create a runaway run. */
export function clampScheduledPlatformLimit(value: unknown, fallback = 20): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(100, Math.max(1, Math.floor(parsed)))
}

function isScheduleFrequency(value: unknown): value is ScheduleFrequency {
  return value === 'hourly'
    || value === 'every6h'
    || value === 'daily'
    || value === 'weekly'
    || value === 'custom'
}

/** Bounds for user-defined rolling schedules. A one-minute floor avoids a
 * busy-loop while still allowing users to choose a cadence finer than the
 * historical hourly/6-hour presets. */
export const MIN_SCHEDULE_INTERVAL_MINUTES = 1
export const MAX_SCHEDULE_INTERVAL_MINUTES = 7 * 24 * 60
export const DEFAULT_SCHEDULE_INTERVAL_MINUTES = 60

/** Global wake-up cadence shown in the schedule rail. */
export const MIN_SCHEDULE_CHECK_INTERVAL_MINUTES = 1
export const MAX_SCHEDULE_CHECK_INTERVAL_MINUTES = 7 * 24 * 60
export const DEFAULT_SCHEDULE_CHECK_INTERVAL_MINUTES = 15

export function clampScheduledIntervalMinutes(value: unknown, fallback = DEFAULT_SCHEDULE_INTERVAL_MINUTES): number {
  const parsed = Number(value)
  const safeFallback = Number.isFinite(Number(fallback))
    ? Math.min(MAX_SCHEDULE_INTERVAL_MINUTES, Math.max(MIN_SCHEDULE_INTERVAL_MINUTES, Math.floor(Number(fallback))))
    : DEFAULT_SCHEDULE_INTERVAL_MINUTES
  if (!Number.isFinite(parsed)) return safeFallback
  return Math.min(MAX_SCHEDULE_INTERVAL_MINUTES, Math.max(MIN_SCHEDULE_INTERVAL_MINUTES, Math.floor(parsed)))
}

export function clampScheduledCheckIntervalMinutes(
  value: unknown,
  fallback = DEFAULT_SCHEDULE_CHECK_INTERVAL_MINUTES,
): number {
  const parsed = Number(value)
  const safeFallback = Number.isFinite(Number(fallback))
    ? Math.min(
      MAX_SCHEDULE_CHECK_INTERVAL_MINUTES,
      Math.max(MIN_SCHEDULE_CHECK_INTERVAL_MINUTES, Math.floor(Number(fallback)))
    )
    : DEFAULT_SCHEDULE_CHECK_INTERVAL_MINUTES
  if (!Number.isFinite(parsed)) return safeFallback
  return Math.min(
    MAX_SCHEDULE_CHECK_INTERVAL_MINUTES,
    Math.max(MIN_SCHEDULE_CHECK_INTERVAL_MINUTES, Math.floor(parsed)),
  )
}

/**
 * Apply the simple, global interval control to every enabled provider. A user
 * can still select a different cadence in an individual provider row later.
 * Keeping the alarm cadence in the same update makes the visible control a
 * real export schedule rather than a cosmetic polling preference.
 */
export function applyGlobalScheduledInterval(
  settings: ScheduledExportSettings,
  intervalMinutes: unknown,
): ScheduledExportSettings {
  const interval = clampScheduledCheckIntervalMinutes(intervalMinutes)
  const platforms = ALL_PLATFORMS.reduce((result, platform) => {
    const current = settings.platforms[platform]
    result[platform] = current.enabled
      ? { ...current, frequency: 'custom', intervalMinutes: interval }
      : current
    return result
  }, {} as Record<ExportablePlatform, PlatformScheduleConfig>)

  return {
    ...settings,
    checkIntervalMinutes: interval,
    platforms,
  }
}

/**
 * A synchronous shared attempt budget. JavaScript executes `tryClaim` without
 * yielding, so simultaneous provider workers cannot overrun the total limit.
 */
export class ScheduledRunBudget {
  private claimed = 0
  private readonly limit: number

  constructor(limit: number) {
    this.limit = Math.max(0, Math.floor(limit))
  }

  tryClaim(): boolean {
    if (this.claimed >= this.limit) return false
    this.claimed += 1
    return true
  }

  get used(): number {
    return this.claimed
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.claimed)
  }
}

/** Run independent provider workers with an explicit concurrency ceiling. */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  maxConcurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const workerCount = Math.min(items.length, clampScheduledPlatformConcurrency(maxConcurrency))

  const runWorker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await worker(items[index])
    }
  }

  await Promise.all(Array.from({ length: workerCount }, runWorker))
  return results
}

/**
 * A tiny local-work limiter. Detail workers use it only for Markdown/download
 * work, so provider requests can be paced independently of browser downloads.
 */
export class ScheduledConcurrencyGate {
  private active = 0
  private readonly waiters: Array<() => void> = []
  private readonly limit: number

  constructor(maxConcurrency: number) {
    this.limit = clampScheduledConversationConcurrency(maxConcurrency)
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await work()
    } finally {
      this.release()
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1
      return Promise.resolve()
    }
    return new Promise(resolve => {
      this.waiters.push(() => {
        this.active += 1
        resolve()
      })
    })
  }

  private release(): void {
    this.active -= 1
    this.waiters.shift()?.()
  }
}

/**
 * Serializes only the *start* of provider detail requests. With concurrency
 * above one, slow reads can overlap, while the configured delay still spaces
 * each new request and avoids an immediate burst against one provider.
 */
export class ScheduledRequestPacer {
  private nextStartAt = 0
  private turn: Promise<void> = Promise.resolve()
  private readonly intervalMs: number

  constructor(intervalMs: number) {
    this.intervalMs = Math.max(0, Math.floor(Number(intervalMs) || 0))
  }

  async waitForTurn(signal?: AbortSignal): Promise<void> {
    let release!: () => void
    const currentTurn = new Promise<void>(resolve => { release = resolve })
    const previousTurn = this.turn
    this.turn = previousTurn.then(() => currentTurn, () => currentTurn)
    await previousTurn

    try {
      throwIfExportCancelled(signal)
      const now = Date.now()
      const startAt = Math.max(now, this.nextStartAt)
      this.nextStartAt = startAt + this.intervalMs
      if (startAt > now) await delay(startAt - now, signal)
    } finally {
      release()
    }
  }
}

export interface ScheduledRunSummary {
  attempted: number
  exported: number
  failed: number
  skipped: number
  listComplete: boolean
  systemError?: boolean
}

export type ScheduledRunStatus = 'success' | 'partial' | 'failed' | 'skipped'

/** Classify a run without conflating "some files downloaded" with success. */
export function classifyScheduledRun(summary: ScheduledRunSummary): ScheduledRunStatus {
  if (summary.systemError || !summary.listComplete) return 'failed'
  if (summary.attempted === 0 && summary.skipped > 0) return 'skipped'
  if (summary.failed > 0) return summary.exported > 0 ? 'partial' : 'failed'
  // A per-run budget leftover is not a completed scan. Advancing lastRun here
  // would postpone the remaining queue until the next frequency window.
  if (summary.skipped > 0) return summary.exported > 0 ? 'partial' : 'failed'
  return 'success'
}

/** `lastRun` advances only after a complete scan and zero export failures. */
export function shouldAdvanceScheduledLastRun(summary: ScheduledRunSummary): boolean {
  return classifyScheduledRun(summary) === 'success' || classifyScheduledRun(summary) === 'skipped'
}

/**
 * Translate provider list metadata into the checkpoint safety contract.
 * Legacy API paths without metadata remain compatible, but an explicit
 * partial result or any sidebar fallback can never advance `lastRun`.
 */
export function isScheduledConversationListComplete(meta: unknown): boolean {
  if (!meta || typeof meta !== 'object') return true
  const value = meta as { source?: unknown; complete?: unknown }
  if (value.source === 'sidebar') return false
  if (typeof value.complete === 'boolean') return value.complete
  return true
}

/** Frequency-to-millisecond mapping */
const FREQUENCY_INTERVALS: Record<Exclude<ScheduleFrequency, 'custom'>, number> = {
  hourly: 60 * 60 * 1000,
  every6h: 6 * 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
}

/** Platform URL mappings for opening tabs */
export const PLATFORM_URLS: Record<ExportablePlatform, string> = {
  chatgpt: 'https://chatgpt.com/',
  claude: 'https://claude.ai/',
  gemini: 'https://gemini.google.com/',
  deepseek: 'https://chat.deepseek.com/',
  grok: 'https://grok.com/',
}

/**
 * Convert a ScheduleFrequency to milliseconds
 */
export function frequencyToMs(
  freq: ScheduleFrequency,
  intervalMinutes = DEFAULT_SCHEDULE_INTERVAL_MINUTES,
): number {
  if (freq === 'custom') return clampScheduledIntervalMinutes(intervalMinutes) * 60 * 1000
  return FREQUENCY_INTERVALS[freq]
}

/**
 * Check if a platform is due for a scheduled export run
 * @param frequency - How often the export should run
 * @param lastRun - Timestamp of the last run (Unix ms)
 * @param now - Current timestamp (Unix ms)
 * @returns true if the platform is due for a run
 */
export function isDueForRun(
  frequency: ScheduleFrequency,
  lastRun: number,
  now: number,
  intervalMinutes?: number,
): boolean {
  const interval = frequencyToMs(frequency, intervalMinutes)
  return now - lastRun >= interval
}

/** A valid browser-local wall-clock time, such as `09:30`. */
export function isValidScheduleTime(value?: string): value is string {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return false
  const [hours, minutes] = value.split(':').map(Number)
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59
}

/**
 * Decide whether a platform is due without treating a successful run as proof
 * that the whole schedule was configured correctly. Exact-time scheduling is
 * intentionally local to the browser. Chrome may wake the extension a little
 * late, so a due run means "at or after" the requested minute.
 */
export function isDueForSchedule(
  config: Pick<PlatformScheduleConfig, 'frequency' | 'timeOfDay' | 'dayOfWeek' | 'intervalMinutes'>,
  lastRun: number,
  now: number
): boolean {
  if (
    config.frequency === 'hourly'
    || config.frequency === 'every6h'
    || config.frequency === 'custom'
    || !isValidScheduleTime(config.timeOfDay)
  ) {
    return isDueForRun(config.frequency, lastRun, now, config.intervalMinutes)
  }

  const [hours, minutes] = config.timeOfDay.split(':').map(Number)
  const target = new Date(now)
  target.setHours(hours, minutes, 0, 0)

  if (config.frequency === 'weekly') {
    const requestedDay = Number.isInteger(config.dayOfWeek) && config.dayOfWeek! >= 0 && config.dayOfWeek! <= 6
      ? config.dayOfWeek!
      : 1
    const daysSinceTarget = (target.getDay() - requestedDay + 7) % 7
    target.setDate(target.getDate() - daysSinceTarget)
  }

  // The selected time has not arrived today (or this week) yet.
  if (now < target.getTime()) return false

  // Run once for the current schedule window. A prior successful run inside
  // that window is sufficient even if the service worker was restarted.
  return lastRun < target.getTime()
}

/**
 * Calculate the next time a platform should be considered due.
 *
 * The scheduler is intentionally wake-up based, so this is an expectation
 * rather than a promise that a browser alarm fires at the exact millisecond.
 * Returning `now` for an already-due or never-run schedule lets the UI say
 * "due now" without formatting the epoch as a misleading date.
 */
export function getNextScheduledRunAt(
  config: Pick<PlatformScheduleConfig, 'frequency' | 'timeOfDay' | 'dayOfWeek' | 'intervalMinutes'>,
  lastRun: number,
  now: number,
): number {
  const safeNow = Number.isFinite(now) ? now : Date.now()
  const safeLastRun = Number.isFinite(lastRun) && lastRun > 0 ? lastRun : 0

  if (
    config.frequency === 'hourly'
    || config.frequency === 'every6h'
    || config.frequency === 'custom'
    || !isValidScheduleTime(config.timeOfDay)
  ) {
    if (safeLastRun <= 0) return safeNow
    const next = safeLastRun + frequencyToMs(config.frequency, config.intervalMinutes)
    return next <= safeNow ? safeNow : next
  }

  const [hours, minutes] = config.timeOfDay.split(':').map(Number)
  const target = new Date(safeNow)
  target.setHours(hours, minutes, 0, 0)

  if (config.frequency === 'weekly') {
    const requestedDay = Number.isInteger(config.dayOfWeek) && config.dayOfWeek! >= 0 && config.dayOfWeek! <= 6
      ? config.dayOfWeek!
      : 1
    const daysSinceTarget = (target.getDay() - requestedDay + 7) % 7
    target.setDate(target.getDate() - daysSinceTarget)
  }

  const targetAt = target.getTime()
  if (safeNow < targetAt) return targetAt
  if (safeLastRun < targetAt) return safeNow

  target.setDate(target.getDate() + (config.frequency === 'weekly' ? 7 : 1))
  return target.getTime()
}

/**
 * Detect only clear login/expired-session signals. The raw provider error is
 * never persisted; callers use this predicate to choose a safe UI state.
 */
export function isAuthenticationRequiredError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : ''
  return /\b401\b|unauthori[sz]ed|authentication(?:\s+required|\s+failed)?|not\s+authenticated|session\s+(?:expired|invalid)|(?:sign|log)[ -]?in\s+required|login\s+required|no\s+access\s+token|no\s+auth(?:entication)?\s+token/i.test(message)
}

/**
 * Provider login redirects are stable enough to identify without inspecting
 * page text. This deliberately errs on the side of "unknown" for ordinary
 * app URLs, leaving the platform state as a generic error when uncertain.
 */
export function isLikelyProviderLoginUrl(platform: ExportablePlatform, value?: string): boolean {
  if (typeof value !== 'string' || !value) return false
  try {
    const url = new URL(value)
    const path = `${url.pathname}${url.search}${url.hash}`
    if (platform === 'gemini' && url.hostname === 'accounts.google.com') return true
    return /(?:^|\/)(?:login|signin|sign-in|auth)(?:\/|$|[?#])/i.test(path)
  } catch {
    return false
  }
}

/**
 * Get the default scheduled export settings
 */
export function getDefaultScheduledExportSettings(): ScheduledExportSettings {
  return {
    enabled: false,
    checkIntervalMinutes: DEFAULT_SCHEDULE_CHECK_INTERVAL_MINUTES,
    platforms: {
      chatgpt:  { enabled: true, frequency: 'daily', maxPerRun: 20, maxConcurrentConversations: 1 },
      claude:   { enabled: false, frequency: 'daily', maxPerRun: 20, maxConcurrentConversations: 1 },
      gemini:   { enabled: false, frequency: 'daily', maxPerRun: 20, maxConcurrentConversations: 1 },
      deepseek: { enabled: false, frequency: 'daily', maxPerRun: 20, maxConcurrentConversations: 1 },
      grok:     { enabled: false, frequency: 'daily', maxPerRun: 20, maxConcurrentConversations: 1 },
    },
    defaultFormat: 'markdown',
    closeTabAfterExport: true,
    requestDelayMs: 3000,
    maxTotalPerRun: 50,
    // A small fan-out cuts wall-clock time when several providers are enabled
    // without multiplying requests to any one provider.
    maxConcurrentPlatforms: 2,
  }
}

/**
 * Resolve stored schedule settings against current defaults. This matters for
 * existing installations: new safety controls must not be `undefined` just
 * because the record pre-dates them.
 */
export function mergeScheduledExportSettings(
  stored?: Partial<ScheduledExportSettings>
): ScheduledExportSettings {
  const defaults = getDefaultScheduledExportSettings()
  const storedPlatforms = stored?.platforms && typeof stored.platforms === 'object'
    ? stored.platforms as Partial<Record<ExportablePlatform, Partial<PlatformScheduleConfig> | null>>
    : {}
  const platforms = ALL_PLATFORMS.reduce((result, platform) => {
    const platformDefaults = defaults.platforms[platform]
    const storedPlatform = storedPlatforms[platform] ?? {}
    result[platform] = {
      ...platformDefaults,
      ...storedPlatform,
      enabled: typeof storedPlatform.enabled === 'boolean'
        ? storedPlatform.enabled
        : platformDefaults.enabled,
      frequency: isScheduleFrequency(storedPlatform.frequency)
        ? storedPlatform.frequency
        : platformDefaults.frequency,
      maxPerRun: clampScheduledPlatformLimit(storedPlatform.maxPerRun, platformDefaults.maxPerRun),
      maxConcurrentConversations: clampScheduledConversationConcurrency(
        storedPlatform.maxConcurrentConversations ?? platformDefaults.maxConcurrentConversations
      ),
      // The background worker cannot render PDF. Ignore stale per-platform
      // PDF overrides rather than letting them fail an entire queue forever.
      format: storedPlatform.format === 'markdown' ? 'markdown' : undefined,
      timeOfDay: isValidScheduleTime(storedPlatform.timeOfDay)
        ? storedPlatform.timeOfDay
        : undefined,
      dayOfWeek: Number.isInteger(storedPlatform.dayOfWeek)
        && storedPlatform.dayOfWeek! >= 0
        && storedPlatform.dayOfWeek! <= 6
        ? storedPlatform.dayOfWeek
        : undefined,
      intervalMinutes: storedPlatform.frequency === 'custom'
        ? clampScheduledIntervalMinutes(storedPlatform.intervalMinutes)
        : undefined,
    }
    return result
  }, {} as Record<ExportablePlatform, PlatformScheduleConfig>)

  const storedDelay = Number(stored?.requestDelayMs)
  const requestDelayMs = Number.isFinite(storedDelay)
    ? Math.min(10_000, Math.max(1_000, Math.floor(storedDelay)))
    : defaults.requestDelayMs
  const storedTotal = Number(stored?.maxTotalPerRun)
  const maxTotalPerRun = Number.isFinite(storedTotal)
    ? Math.min(200, Math.max(1, Math.floor(storedTotal)))
    : defaults.maxTotalPerRun

  return {
    ...defaults,
    ...stored,
    enabled: typeof stored?.enabled === 'boolean' ? stored.enabled : defaults.enabled,
    checkIntervalMinutes: clampScheduledCheckIntervalMinutes(stored?.checkIntervalMinutes),
    platforms,
    // Scheduled exports are intentionally Markdown-only; user-selected PDF
    // remains available in foreground Current Chat and Bulk Export flows.
    defaultFormat: 'markdown',
    closeTabAfterExport: typeof stored?.closeTabAfterExport === 'boolean'
      ? stored.closeTabAfterExport
      : defaults.closeTabAfterExport,
    requestDelayMs,
    maxTotalPerRun,
    maxConcurrentPlatforms: clampScheduledPlatformConcurrency(
      stored?.maxConcurrentPlatforms ?? defaults.maxConcurrentPlatforms
    ),
  }
}

/**
 * Create a delay promise that can be stopped promptly with an AbortSignal.
 */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(EXPORT_CANCELLED_MESSAGE))
      return
    }

    const timer = setTimeout(() => finish(), ms)
    const onAbort = () => finish(new Error(EXPORT_CANCELLED_MESSAGE))

    const finish = (error?: Error) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve()
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** All exportable platform names */
export const ALL_PLATFORMS: ExportablePlatform[] = [
  'chatgpt', 'claude', 'gemini', 'deepseek', 'grok',
]
