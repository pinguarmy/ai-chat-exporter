import type { PlatformScheduleConfig, ScheduledExportSettings } from './types'
import { frequencyToMs, getNextScheduledRunAt, isDueForSchedule, isValidScheduleTime } from './scheduled-export'

type ActiveWindow = Pick<ScheduledExportSettings, 'allowedDays' | 'dailyWindow'>

export function getScheduleWindowError(settings: ActiveWindow): 'days' | 'time' | null {
  if (settings.allowedDays != null && !settings.allowedDays.some(day => Number.isInteger(day) && day >= 0 && day <= 6)) return 'days'
  const window = settings.dailyWindow
  if (window && (!isValidScheduleTime(window.start) || !isValidScheduleTime(window.end) || window.start === window.end)) return 'time'
  return null
}

/** Local wall-clock restrictions. Overnight hours belong to the start weekday. */
export function canStartScheduledWork(settings: ActiveWindow, now: number, force = false): boolean {
  if (force) return true // The explicitly labelled Run now action bypasses all timing restrictions.
  if (!Number.isFinite(now) || getScheduleWindowError(settings)) return false
  const date = new Date(now)
  let day = date.getDay()
  const window = settings.dailyWindow
  if (window) {
    const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    if (window.start < window.end) {
      if (time < window.start || time > window.end) return false
    } else if (time <= window.end) {
      day = (day + 6) % 7
    } else if (time < window.start) {
      return false
    }
  }
  return settings.allowedDays == null || settings.allowedDays.includes(day)
}

function usesWindowInterval(config: PlatformScheduleConfig, settings: ActiveWindow): boolean {
  return settings.dailyWindow != null
    && !((config.frequency === 'daily' || config.frequency === 'weekly') && isValidScheduleTime(config.timeOfDay))
}

function localMinute(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes()) / 60_000
}

/** Latest existing wall-clock slot, not the time settings were saved or the browser woke. */
function latestWindowSlot(config: PlatformScheduleConfig, now: number, settings: ActiveWindow): { at: number; minute: number } | null {
  if (!settings.dailyWindow || !canStartScheduledWork({ dailyWindow: settings.dailyWindow }, now)) return null
  const window = settings.dailyWindow
  const date = new Date(now)
  const [hours, minutes] = window.start.split(':').map(Number)
  const startMinute = hours * 60 + minutes
  const clockMinute = date.getHours() * 60 + date.getMinutes()
  const overnightTail = window.start > window.end && clockMinute < startMinute
  const elapsed = clockMinute - startMinute + (overnightTail ? 1440 : 0)
  const interval = frequencyToMs(config.frequency, config.intervalMinutes) / 60_000
  const anchor = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate() - (overnightTail ? 1 : 0), hours, minutes) / 60_000
  // Date normalizes missing DST times. Skip those slots instead of moving them;
  // repeated local times deliberately identify the same (first) occurrence.
  for (let offset = Math.floor(elapsed / interval) * interval; offset >= 0; offset -= interval) {
    const wall = new Date((anchor + offset) * 60_000)
    const slot = new Date(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(), wall.getUTCHours(), wall.getUTCMinutes())
    if (localMinute(slot) === anchor + offset && slot.getTime() <= now) return { at: slot.getTime(), minute: anchor + offset }
  }
  return null
}

/** At most one recent slot is eligible; an existing checkpoint suppresses repeat wakes in that slot. */
export function isDueForWindowedSchedule(config: PlatformScheduleConfig, lastRun: number, now: number, settings: ActiveWindow): boolean {
  if (!canStartScheduledWork(settings, now)) return false
  if (!usesWindowInterval(config, settings)) return isDueForSchedule(config, lastRun, now)
  const slot = latestWindowSlot(config, now, settings)
  if (!slot || lastRun >= slot.at) return false
  const interval = frequencyToMs(config.frequency, config.intervalMinutes) / 60_000
  // A daily window must not turn a weekly (or multi-day custom) interval into daily runs.
  if (interval >= 1440 && lastRun > 0) {
    const previousMinute = latestWindowSlot(config, lastRun, settings)?.minute ?? localMinute(new Date(lastRun))
    if (slot.minute - previousMinute < interval) return false
  }
  return true
}

/** Minute-precision windows: walk real minutes so DST gaps and repeated hours are not skipped. */
function nextAllowedAt(settings: ActiveWindow, now: number): number | null {
  if (getScheduleWindowError(settings)) return null
  if (canStartScheduledWork(settings, now)) return now
  const limit = new Date(now)
  limit.setDate(limit.getDate() + 8) // A full local week, including a DST transition.
  for (let candidate = Math.ceil(now / 60_000) * 60_000; candidate <= limit.getTime(); candidate += 60_000) {
    if (canStartScheduledWork(settings, candidate)) return candidate
  }
  return null
}

/** Intersect the existing frequency rules with allowed days/hours; do not invent catch-up runs. */
export function getNextWindowedScheduledRunAt(
  config: PlatformScheduleConfig,
  lastRun: number,
  now: number,
  settings: ActiveWindow,
): number | null {
  if (getScheduleWindowError(settings)) return null
  if (usesWindowInterval(config, settings)) {
    // Scan real minutes, including repeated DST hours, using the worker's exact predicate.
    const horizon = new Date(now)
    horizon.setDate(horizon.getDate() + 15)
    if (isDueForWindowedSchedule(config, lastRun, now, settings)) return now
    for (let candidate = Math.ceil(now / 60_000) * 60_000; candidate <= horizon.getTime(); candidate += 60_000) {
      if (isDueForWindowedSchedule(config, lastRun, candidate, settings)) return candidate
    }
    return null
  }
  let due = getNextScheduledRunAt(config, lastRun, now)
  if (settings.allowedDays == null && settings.dailyWindow == null) return due
  // Two weekly cycles cover recurring combinations plus a local DST transition.
  const horizon = new Date(due)
  horizon.setDate(horizon.getDate() + 15)
  while (due <= horizon.getTime()) {
    const allowed = nextAllowedAt(settings, due)
    if (allowed === null) return null
    if (isDueForSchedule(config, lastRun, allowed)) return allowed
    const next = getNextScheduledRunAt(config, lastRun, allowed)
    if (next <= due) return null
    due = next
  }
  return null // For example, a daily 18:00 target with a 09:00–17:00 window.
}
