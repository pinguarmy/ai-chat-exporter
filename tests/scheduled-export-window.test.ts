import { describe, expect, it, vi } from 'vitest'
import { canStartScheduledWork, getNextWindowedScheduledRunAt, getScheduleWindowError, isDueForWindowedSchedule } from '../src/lib/scheduled-export-window'
import { getDefaultScheduledExportSettings, getNextScheduledRunAt, mergeScheduledExportSettings } from '../src/lib/scheduled-export'

const local = (day: number, hours = 0, minutes = 0, seconds = 0) => new Date(2026, 9, day, hours, minutes, seconds).getTime()
const weekdays = { allowedDays: [1, 2, 3, 4, 5], dailyWindow: { start: '09:00', end: '17:00' } }
const hourly = { ...getDefaultScheduledExportSettings().platforms.chatgpt, frequency: 'hourly' as const }

describe('optional automatic export days and hours', () => {
  it('leaves legacy/default scheduling unrestricted', () => {
    for (const settings of [getDefaultScheduledExportSettings(), mergeScheduledExportSettings({ enabled: true })]) {
      expect(canStartScheduledWork(settings, local(24, 23))).toBe(true)
      expect(getNextWindowedScheduledRunAt(hourly, local(24, 23), local(24, 23), settings))
        .toBe(getNextScheduledRunAt(hourly, local(24, 23), local(24, 23)))
    }
  })

  it('includes both endpoint minutes and skips weekends', () => {
    expect(canStartScheduledWork(weekdays, local(23, 8, 59, 59))).toBe(false)
    expect(canStartScheduledWork(weekdays, local(23, 9))).toBe(true)
    expect(canStartScheduledWork(weekdays, local(23, 16, 59, 59))).toBe(true)
    expect(canStartScheduledWork(weekdays, local(23, 17, 0, 59))).toBe(true)
    expect(canStartScheduledWork(weekdays, local(23, 17, 1))).toBe(false)
    expect(canStartScheduledWork(weekdays, local(24, 12))).toBe(false)
    expect(canStartScheduledWork(weekdays, local(25, 12))).toBe(false)
    expect(canStartScheduledWork(weekdays, local(26, 12))).toBe(true)
  })

  it('supports each restriction independently and null explicitly disables it', () => {
    expect(canStartScheduledWork({ allowedDays: [1] }, local(26, 23))).toBe(true)
    expect(canStartScheduledWork({ dailyWindow: weekdays.dailyWindow }, local(24, 12))).toBe(true)
    expect(canStartScheduledWork({ allowedDays: null, dailyWindow: null }, local(24, 23))).toBe(true)
  })

  it('ties overnight hours to the starting weekday, including the week boundary', () => {
    const night = { allowedDays: [5], dailyWindow: { start: '22:00', end: '06:00' } }
    expect(canStartScheduledWork(night, local(23, 1))).toBe(false)
    expect(canStartScheduledWork(night, local(23, 22))).toBe(true)
    expect(canStartScheduledWork(night, local(24, 5, 59, 59))).toBe(true)
    expect(canStartScheduledWork(night, local(24, 6, 0, 59))).toBe(true)
    expect(canStartScheduledWork(night, local(24, 6, 1))).toBe(false)
    expect(canStartScheduledWork(night, local(24, 22))).toBe(false)
    expect(canStartScheduledWork({ ...night, allowedDays: [0] }, local(26, 1))).toBe(true)
  })

  it('pauses on empty weekdays, invalid times and equal times; manual runs deliberately bypass these', () => {
    for (const settings of [
      { allowedDays: [] },
      { dailyWindow: { start: '', end: '17:00' } },
      { dailyWindow: { start: '25:00', end: '17:00' } },
      { dailyWindow: { start: '09:00', end: '09:00' } },
    ]) {
      expect(getScheduleWindowError(settings)).not.toBeNull()
      expect(canStartScheduledWork(settings, local(26, 12))).toBe(false)
      expect(getNextWindowedScheduledRunAt(hourly, 0, local(26, 12), settings)).toBeNull()
      expect(canStartScheduledWork(settings, local(26, 12), true)).toBe(true)
    }
    expect(canStartScheduledWork(weekdays, local(24, 23), true)).toBe(true)
  })

  it('sanitizes malformed stored restrictions without silently removing them', () => {
    const settings = mergeScheduledExportSettings({ allowedDays: [1, 1, 5, -1, 7, '2'], dailyWindow: { start: 'bad' } } as never)
    expect(settings.allowedDays).toEqual([1, 5])
    expect(settings.dailyWindow).toEqual({ start: '', end: '' })
    expect(canStartScheduledWork(settings, local(26, 12))).toBe(false)
    expect(mergeScheduledExportSettings({ allowedDays: 'Monday' } as never).allowedDays).toEqual([])
  })

  it('projects overdue and future anchored runs into the next allowed window, without catch-up copies', () => {
    expect(getNextWindowedScheduledRunAt(hourly, 0, local(23, 17, 1), weekdays)).toBe(local(26, 9))
    expect(getNextWindowedScheduledRunAt(hourly, local(23, 16, 30), local(23, 16, 45), weekdays)).toBe(local(23, 17))
    expect(getNextWindowedScheduledRunAt(hourly, local(26, 9), local(26, 9, 30), weekdays)).toBe(local(26, 10))
    expect(getNextWindowedScheduledRunAt(hourly, 0, local(24, 2), { allowedDays: [1] })).toBe(local(26))
    expect(getNextWindowedScheduledRunAt(hourly, 0, local(23, 20), { ...weekdays, dailyWindow: { start: '22:00', end: '06:00' } })).toBe(local(23, 22))
  })

  it('preserves daily lateness semantics and reports incompatible platform times rather than a false next run', () => {
    const daily = { ...hourly, frequency: 'daily' as const, timeOfDay: '08:00' }
    expect(getNextWindowedScheduledRunAt(daily, local(23, 9), local(24, 12), weekdays)).toBe(local(26, 9))
    expect(getNextWindowedScheduledRunAt({ ...daily, timeOfDay: '18:00' }, 0, local(23, 12), weekdays)).toBeNull()
    expect(getNextWindowedScheduledRunAt({ ...daily, timeOfDay: '17:00' }, 0, local(23, 12), weekdays)).toBe(local(23, 17))
  })

  it('preserves weekly late execution within the current weekly period', () => {
    const weekly = { ...hourly, frequency: 'weekly' as const, timeOfDay: '10:00', dayOfWeek: 0 }
    expect(getNextWindowedScheduledRunAt(weekly, 0, local(25, 12), weekdays)).toBe(local(26, 9))
    expect(getNextWindowedScheduledRunAt(weekly, local(26, 9), local(26, 10), weekdays)).toBe(new Date(2026, 10, 2, 9).getTime())
  })

  it('uses the device timezone, with calendar-day windows across DST rather than fixed UTC hours', () => {
    const before = new Date(2026, 9, 30, 17, 1).getTime()
    const after = new Date(2026, 10, 2, 9).getTime()
    expect(getNextWindowedScheduledRunAt(hourly, 0, before, weekdays)).toBe(after)
    expect(canStartScheduledWork(weekdays, after)).toBe(true)
    if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'America/New_York') {
      expect(new Date(after).getUTCHours()).toBe(14)
      expect(after - before).toBe((65 * 60 - 1) * 60 * 1000)
    }
    if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'Asia/Tokyo') {
      expect(new Date(after).getUTCHours()).toBe(0)
      expect(after - before).toBe((64 * 60 - 1) * 60 * 1000)
    }
  })
})

it('finds openings at a DST gap and in the second occurrence of a repeated hour', () => {
  if (Intl.DateTimeFormat().resolvedOptions().timeZone !== 'America/New_York') return
  expect(getNextWindowedScheduledRunAt(hourly, 0, Date.parse('2026-03-08T00:00:00-05:00'), {
    dailyWindow: { start: '02:30', end: '03:30' },
  })).toBe(Date.parse('2026-03-08T03:30:00-04:00'))
  expect(getNextWindowedScheduledRunAt(hourly, 0, Date.parse('2026-11-01T01:40:00-04:00'), {
    dailyWindow: { start: '01:10', end: '01:30' },
  })).toBe(Date.parse('2026-11-01T01:10:00-05:00'))
})

it('persists disabling restrictions through a JSON settings patch without losing unrelated settings', async () => {
  const { persistSettingsPatch, settingsDifference } = await import('../src/lib/settings-store')
  const before = { ...getDefaultScheduledExportSettings(), ...weekdays, enabled: true }
  let stored: Record<string, any> = { settings: { locale: 'ja', scheduledExport: before } }
  vi.stubGlobal('chrome', { storage: { local: {
    get: async () => structuredClone(stored),
    set: async (values: Record<string, unknown>) => { stored = { ...stored, ...structuredClone(values) } },
  } } })
  try {
    const patch = JSON.parse(JSON.stringify(settingsDifference(before, { ...before, allowedDays: null, dailyWindow: null })))
    await persistSettingsPatch({ scheduledExport: patch })
    const reloaded = mergeScheduledExportSettings(stored.settings.scheduledExport)
    expect(stored.settings.locale).toBe('ja')
    expect(reloaded.enabled).toBe(true)
    expect(reloaded.allowedDays).toBeNull()
    expect(reloaded.dailyWindow).toBeNull()
    expect(canStartScheduledWork(reloaded, local(24, 23))).toBe(true)
  } finally {
    vi.unstubAllGlobals()
  }
})

const twoHourly = { ...hourly, frequency: 'custom' as const, intervalMinutes: 120 }

describe('window-start interval slots', () => {
  it('keeps 09/11/13 slots after late wakes and saves, rather than shifting from lastRun', () => {
    const checkpoint = local(26, 9, 7)
    expect(isDueForWindowedSchedule(twoHourly, checkpoint, local(26, 10, 59), weekdays)).toBe(false)
    expect(getNextWindowedScheduledRunAt(twoHourly, checkpoint, local(26, 10, 35), structuredClone(weekdays))).toBe(local(26, 11))
    expect(isDueForWindowedSchedule(twoHourly, checkpoint, local(26, 11), weekdays)).toBe(true)
    expect(getNextWindowedScheduledRunAt(twoHourly, local(26, 11, 20), local(26, 11, 35), weekdays)).toBe(local(26, 13))
  })

  it('consumes only the latest missed slot and allows the next slot immediately after a very late run', () => {
    expect(isDueForWindowedSchedule(hourly, 0, local(26, 10, 35), weekdays)).toBe(true)
    expect(isDueForWindowedSchedule(hourly, local(26, 10, 35), local(26, 10, 59), weekdays)).toBe(false)
    expect(getNextWindowedScheduledRunAt(hourly, local(26, 10, 35), local(26, 10, 59), weekdays)).toBe(local(26, 11))
    expect(isDueForWindowedSchedule(hourly, local(26, 9, 59), local(26, 10), weekdays)).toBe(true)
  })

  it('includes an aligned final slot for its full minute, without requiring an unaligned end to be a slot', () => {
    expect(isDueForWindowedSchedule(twoHourly, local(26, 15, 20), local(26, 17, 0, 20), weekdays)).toBe(true)
    expect(isDueForWindowedSchedule(twoHourly, local(26, 15, 20), local(26, 17, 1), weekdays)).toBe(false)
    const until18 = { ...weekdays, dailyWindow: { start: '09:00', end: '18:00' } }
    expect(getNextWindowedScheduledRunAt(twoHourly, local(26, 15, 20), local(26, 16), until18)).toBe(local(26, 17))
    expect(isDueForWindowedSchedule(twoHourly, local(26, 17, 20), local(26, 18), until18)).toBe(false)
    expect(getNextWindowedScheduledRunAt(twoHourly, local(26, 17, 20), local(26, 18), until18)).toBe(local(27, 9))
  })

  it('keeps overnight slots and the final minute owned by the starting weekday', () => {
    const night = { allowedDays: [5], dailyWindow: { start: '22:00', end: '06:00' } }
    expect(getNextWindowedScheduledRunAt(twoHourly, local(23, 22, 20), local(23, 23), night)).toBe(local(24, 0))
    expect(isDueForWindowedSchedule(twoHourly, local(24, 4, 20), local(24, 6, 0, 59), night)).toBe(true)
    expect(isDueForWindowedSchedule(twoHourly, local(24, 4, 20), local(24, 6, 1), night)).toBe(false)
    expect(getNextWindowedScheduledRunAt(twoHourly, local(24, 6, 0, 20), local(24, 6, 1), night)).toBe(local(30, 22))
  })

  it('preserves explicit daily/weekly times and unrestricted interval behavior', () => {
    const daily = { ...hourly, frequency: 'daily' as const, timeOfDay: '10:30' }
    expect(isDueForWindowedSchedule(daily, 0, local(26, 9), weekdays)).toBe(false)
    expect(getNextWindowedScheduledRunAt(daily, 0, local(26, 9), weekdays)).toBe(local(26, 10, 30))
    expect(getNextWindowedScheduledRunAt(twoHourly, local(26, 9, 7), local(26, 10), {})).toBe(local(26, 11, 7))
    expect(getNextWindowedScheduledRunAt(twoHourly, local(26, 9, 7), local(26, 10), { allowedDays: [1] })).toBe(local(26, 11, 7))
  })

  it('reuses old/manual checkpoints: before-start runs do not consume the upcoming short-interval slot', () => {
    expect(isDueForWindowedSchedule(twoHourly, local(26, 8, 30), local(26, 9), weekdays)).toBe(true)
    expect(isDueForWindowedSchedule(twoHourly, local(26, 9, 30), local(26, 10), weekdays)).toBe(false)
    expect(getNextWindowedScheduledRunAt(twoHourly, local(26, 9, 30), local(26, 10), weekdays)).toBe(local(26, 11))
  })

  it.each([1440, 1500, 2160, 2880, 10080])('preserves a %s-minute minimum for long intervals at eligible daily starts', intervalMinutes => {
    const config = { ...twoHourly, intervalMinutes }
    const allDays = { dailyWindow: { start: '09:00', end: '17:00' } }
    const expectedDay = 26 + Math.ceil(intervalMinutes / 1440)
    expect(getNextWindowedScheduledRunAt(config, local(26, 9, 20), local(26, 10), allDays)).toBe(local(expectedDay, 9))
  })

  it('does not turn weekly into daily and keeps overnight long-interval ownership across weekday skips', () => {
    const weekly = { ...hourly, frequency: 'weekly' as const }
    expect(isDueForWindowedSchedule(weekly, local(19, 9, 20), local(23, 9), weekdays)).toBe(false)
    expect(getNextWindowedScheduledRunAt(weekly, local(19, 9, 20), local(23, 9), weekdays)).toBe(local(26, 9))
    const daily = { ...hourly, frequency: 'daily' as const }
    const night = { allowedDays: [1, 2, 3, 4, 5], dailyWindow: { start: '22:00', end: '06:00' } }
    expect(getNextWindowedScheduledRunAt(daily, local(24, 1), local(24, 3), night)).toBe(local(26, 22))
  })

  it('skips nonexistent DST slots, runs a repeated wall-clock slot once, and preserves daily cadence across DST', () => {
    if (Intl.DateTimeFormat().resolvedOptions().timeZone !== 'America/New_York') return
    const spring = { dailyWindow: { start: '00:30', end: '05:30' } }
    const checkpoint = Date.parse('2026-03-08T01:30:20-05:00')
    expect(isDueForWindowedSchedule(hourly, checkpoint, Date.parse('2026-03-08T03:00:00-04:00'), spring)).toBe(false)
    expect(getNextWindowedScheduledRunAt(hourly, checkpoint, Date.parse('2026-03-08T03:00:00-04:00'), spring)).toBe(Date.parse('2026-03-08T03:30:00-04:00'))
    const fall = { dailyWindow: { start: '00:00', end: '03:00' } }
    const first = Date.parse('2026-11-01T01:00:20-04:00')
    expect(isDueForWindowedSchedule(hourly, first, Date.parse('2026-11-01T01:00:30-05:00'), fall)).toBe(false)
    expect(getNextWindowedScheduledRunAt(hourly, first, Date.parse('2026-11-01T01:00:30-05:00'), fall)).toBe(Date.parse('2026-11-01T02:00:00-05:00'))
    const daily = { ...hourly, frequency: 'daily' as const }
    expect(isDueForWindowedSchedule(daily, Date.parse('2026-03-07T09:00:20-05:00'), Date.parse('2026-03-08T09:00:00-04:00'), { dailyWindow: weekdays.dailyWindow })).toBe(true)
  })
})
