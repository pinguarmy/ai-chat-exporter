/**
 * Scheduled Export Tests
 */

import { describe, it, expect, vi } from 'vitest'
import {
  isDueForRun,
  isDueForSchedule,
  frequencyToMs,
  getDefaultScheduledExportSettings,
  ALL_PLATFORMS,
  classifyScheduledRun,
  shouldAdvanceScheduledLastRun,
  isScheduledConversationListComplete,
  ScheduledRunBudget,
  clampScheduledPlatformLimit,
  clampScheduledPlatformConcurrency,
  clampScheduledConversationConcurrency,
  mergeScheduledExportSettings,
  runWithConcurrency,
  ScheduledConcurrencyGate,
  ScheduledRequestPacer,
  applyGlobalScheduledInterval,
  clampScheduledCheckIntervalMinutes,
  clampScheduledIntervalMinutes,
  getNextScheduledRunAt,
  isAuthenticationRequiredError,
  isLikelyProviderLoginUrl,
} from '../src/lib/scheduled-export'
import type { ScheduleFrequency } from '../src/lib/types'

describe('Scheduled Export', () => {
  describe('frequencyToMs', () => {
    it('should convert hourly to milliseconds', () => {
      expect(frequencyToMs('hourly')).toBe(60 * 60 * 1000)
    })

    it('should convert every6h to milliseconds', () => {
      expect(frequencyToMs('every6h')).toBe(6 * 60 * 60 * 1000)
    })

    it('should convert daily to milliseconds', () => {
      expect(frequencyToMs('daily')).toBe(24 * 60 * 60 * 1000)
    })

    it('should convert weekly to milliseconds', () => {
      expect(frequencyToMs('weekly')).toBe(7 * 24 * 60 * 60 * 1000)
    })

    it('should convert a custom interval in minutes to milliseconds', () => {
      expect(frequencyToMs('custom', 7)).toBe(7 * 60 * 1000)
    })
  })

  describe('isDueForRun', () => {
    const DAY_MS = 24 * 60 * 60 * 1000
    const HOUR_MS = 60 * 60 * 1000

    it('should return true when enough time has passed for daily frequency', () => {
      const now = Date.now()
      const lastRun = now - DAY_MS // 24 hours ago
      expect(isDueForRun('daily', lastRun, now)).toBe(true)
    })

    it('should return false when not enough time has passed for daily frequency', () => {
      const now = Date.now()
      const lastRun = now - DAY_MS + 1000 // just under 24 hours ago
      expect(isDueForRun('daily', lastRun, now)).toBe(false)
    })

    it('should return true for hourly when enough time has passed', () => {
      const now = Date.now()
      const lastRun = now - HOUR_MS
      expect(isDueForRun('hourly', lastRun, now)).toBe(true)
    })

    it('should return true for every6h when enough time has passed', () => {
      const now = Date.now()
      const lastRun = now - 6 * HOUR_MS
      expect(isDueForRun('every6h', lastRun, now)).toBe(true)
    })

    it('should respect a custom interval when enough time has passed', () => {
      const now = Date.now()
      const lastRun = now - 5 * 60 * 1000
      expect(isDueForRun('custom', lastRun, now, 5)).toBe(true)
      expect(isDueForRun('custom', lastRun + 1, now, 5)).toBe(false)
    })

    it('should return true for weekly when enough time has passed', () => {
      const now = Date.now()
      const lastRun = now - 7 * DAY_MS
      expect(isDueForRun('weekly', lastRun, now)).toBe(true)
    })

    it('should return true for weekly when no previous run (lastRun = 0)', () => {
      const now = Date.now()
      expect(isDueForRun('weekly', 0, now)).toBe(true)
    })

    it('should return false when lastRun is exactly the interval', () => {
      const now = Date.now()
      const lastRun = now - DAY_MS // exactly 24 hours ago
      // At exactly the interval boundary, it should be due
      expect(isDueForRun('daily', lastRun, now)).toBe(true)
    })
  })

  describe('isDueForSchedule', () => {
    it('waits for the selected local time on a daily schedule', () => {
      const beforeNine = new Date(2026, 7, 6, 8, 59).getTime()
      const afterNine = new Date(2026, 7, 6, 9, 2).getTime()
      const config = { frequency: 'daily' as const, timeOfDay: '09:00' }

      expect(isDueForSchedule(config, 0, beforeNine)).toBe(false)
      expect(isDueForSchedule(config, 0, afterNine)).toBe(true)
      expect(isDueForSchedule(config, afterNine, afterNine)).toBe(false)
    })

    it('runs once after the requested weekday and time, then waits for next week', () => {
      const mondayAfterNine = new Date(2026, 7, 3, 9, 2).getTime()
      const tuesday = new Date(2026, 7, 4, 10, 0).getTime()
      const config = { frequency: 'weekly' as const, timeOfDay: '09:00', dayOfWeek: 1 }

      expect(isDueForSchedule(config, 0, mondayAfterNine)).toBe(true)
      expect(isDueForSchedule(config, mondayAfterNine, tuesday)).toBe(false)
    })

    it('preserves relative scheduling for existing records with no time', () => {
      const now = Date.now()
      expect(isDueForSchedule({ frequency: 'daily' }, now - 24 * 60 * 60 * 1000, now)).toBe(true)
    })

    it('uses the custom interval as a rolling schedule', () => {
      const now = Date.now()
      expect(isDueForSchedule({ frequency: 'custom', intervalMinutes: 12 }, now - 12 * 60 * 1000, now)).toBe(true)
      expect(isDueForSchedule({ frequency: 'custom', intervalMinutes: 12 }, now - 11 * 60 * 1000, now)).toBe(false)
    })
  })

  describe('getNextScheduledRunAt', () => {
    it('returns now for a never-run rolling schedule and the rolling checkpoint afterward', () => {
      const now = new Date(2026, 7, 10, 12, 0).getTime()
      expect(getNextScheduledRunAt({ frequency: 'custom', intervalMinutes: 15 }, 0, now)).toBe(now)
      expect(getNextScheduledRunAt({ frequency: 'custom', intervalMinutes: 15 }, now, now))
        .toBe(now + 15 * 60 * 1000)
    })

    it('shows the next local daily time and marks an overdue window as due now', () => {
      const beforeNine = new Date(2026, 7, 10, 8, 30).getTime()
      const afterNine = new Date(2026, 7, 10, 9, 30).getTime()
      const nextDay = new Date(2026, 7, 11, 9, 0).getTime()
      const config = { frequency: 'daily' as const, timeOfDay: '09:00' }

      expect(getNextScheduledRunAt(config, 0, beforeNine)).toBe(new Date(2026, 7, 10, 9, 0).getTime())
      expect(getNextScheduledRunAt(config, 0, afterNine)).toBe(afterNine)
      expect(getNextScheduledRunAt(config, new Date(2026, 7, 10, 9, 5).getTime(), afterNine)).toBe(nextDay)
    })

    it('advances weekly local schedules to the following requested weekday', () => {
      const mondayBeforeNine = new Date(2026, 7, 3, 8, 0).getTime()
      const mondayAfterNine = new Date(2026, 7, 3, 9, 5).getTime()
      const nextMonday = new Date(2026, 7, 10, 9, 0).getTime()
      const config = { frequency: 'weekly' as const, timeOfDay: '09:00', dayOfWeek: 1 }

      expect(getNextScheduledRunAt(config, 0, mondayBeforeNine)).toBe(new Date(2026, 7, 3, 9, 0).getTime())
      expect(getNextScheduledRunAt(config, mondayAfterNine, mondayAfterNine)).toBe(nextMonday)
    })
  })

  describe('provider authentication signals', () => {
    it('recognizes explicit session errors without matching ordinary provider failures', () => {
      expect(isAuthenticationRequiredError('401 Unauthorized')).toBe(true)
      expect(isAuthenticationRequiredError('No access token in response')).toBe(true)
      expect(isAuthenticationRequiredError('Failed to fetch all conversations')).toBe(false)
    })

    it('recognizes provider login redirects without treating normal app URLs as login pages', () => {
      expect(isLikelyProviderLoginUrl('chatgpt', 'https://chatgpt.com/auth/login')).toBe(true)
      expect(isLikelyProviderLoginUrl('gemini', 'https://accounts.google.com/ServiceLogin')).toBe(true)
      expect(isLikelyProviderLoginUrl('claude', 'https://claude.ai/')).toBe(false)
      expect(isLikelyProviderLoginUrl('grok', 'https://grok.com/c/example')).toBe(false)
    })
  })

  describe('getDefaultScheduledExportSettings', () => {
    it('should return default settings with correct structure', () => {
      const settings = getDefaultScheduledExportSettings()

      expect(settings.enabled).toBe(false)
      expect(settings.defaultFormat).toBe('markdown')
      expect(settings.closeTabAfterExport).toBe(true)
      expect(settings.requestDelayMs).toBe(3000)
      expect(settings.maxTotalPerRun).toBe(50)
      expect(settings.maxConcurrentPlatforms).toBe(2)
      expect(settings.checkIntervalMinutes).toBe(15)
    })

    it('should include all platforms with defaults', () => {
      const settings = getDefaultScheduledExportSettings()
      
      expect(settings.platforms).toBeDefined()

      for (const platform of ALL_PLATFORMS) {
        expect(settings.platforms[platform]).toBeDefined()
        expect(settings.platforms[platform].frequency).toBe('daily')
        expect(settings.platforms[platform].maxPerRun).toBe(20)
        expect(settings.platforms[platform].maxConcurrentConversations).toBe(1)
      }
    })

    it('should have chatgpt enabled by default', () => {
      const settings = getDefaultScheduledExportSettings()
      expect(settings.platforms.chatgpt.enabled).toBe(true)
    })

    it('should have other platforms disabled by default', () => {
      const settings = getDefaultScheduledExportSettings()
      expect(settings.platforms.claude.enabled).toBe(false)
      expect(settings.platforms.gemini.enabled).toBe(false)
      expect(settings.platforms.deepseek.enabled).toBe(false)
      expect(settings.platforms.grok.enabled).toBe(false)
    })
  })

  describe('bounded provider concurrency', () => {
    it('clamps persisted provider concurrency to a conservative range', () => {
      expect(clampScheduledPlatformConcurrency(undefined)).toBe(2)
      expect(clampScheduledPlatformConcurrency(0)).toBe(1)
      expect(clampScheduledPlatformConcurrency(99)).toBe(3)
      expect(mergeScheduledExportSettings({ maxConcurrentPlatforms: 99 }).maxConcurrentPlatforms).toBe(3)
    })

    it('bounds every provider queue even when stored settings are malformed', () => {
      expect(clampScheduledPlatformLimit(0)).toBe(1)
      expect(clampScheduledPlatformLimit(999)).toBe(100)
      expect(clampScheduledPlatformLimit(Number.NaN)).toBe(20)
      expect(mergeScheduledExportSettings({
        platforms: {
          chatgpt: { enabled: true, frequency: 'daily', maxPerRun: 999 },
        } as never,
      }).platforms.chatgpt.maxPerRun).toBe(100)
    })

    it('keeps per-provider conversation overlap user-configurable but bounded', () => {
      expect(clampScheduledConversationConcurrency(undefined)).toBe(1)
      expect(clampScheduledConversationConcurrency(0)).toBe(1)
      expect(clampScheduledConversationConcurrency(99)).toBe(3)
      expect(mergeScheduledExportSettings({
        platforms: {
          chatgpt: {
            enabled: true,
            frequency: 'daily',
            maxPerRun: 20,
            maxConcurrentConversations: 99,
          },
        } as never,
      }).platforms.chatgpt.maxConcurrentConversations).toBe(3)
    })

    it('repairs malformed persisted run limits instead of storing NaN', () => {
      const settings = mergeScheduledExportSettings({
        requestDelayMs: Number.NaN,
        maxTotalPerRun: Number.NaN,
      })

      expect(settings.requestDelayMs).toBe(3000)
      expect(settings.maxTotalPerRun).toBe(50)
    })

    it('clamps custom intervals and repairs missing values', () => {
      expect(clampScheduledIntervalMinutes(0)).toBe(1)
      expect(clampScheduledIntervalMinutes(999999)).toBe(7 * 24 * 60)
      expect(clampScheduledIntervalMinutes(Number.NaN)).toBe(60)
      expect(mergeScheduledExportSettings({
        platforms: {
          chatgpt: { enabled: true, frequency: 'custom', maxPerRun: 20, intervalMinutes: 0 },
        } as never,
      }).platforms.chatgpt.intervalMinutes).toBe(1)
      expect(mergeScheduledExportSettings({
        platforms: {
          chatgpt: { enabled: true, frequency: 'custom', maxPerRun: 20 },
        } as never,
      }).platforms.chatgpt.intervalMinutes).toBe(60)
    })

    it('clamps and persists the global scheduled interval', () => {
      expect(clampScheduledCheckIntervalMinutes(0)).toBe(1)
      expect(clampScheduledCheckIntervalMinutes(999999)).toBe(7 * 24 * 60)
      expect(clampScheduledCheckIntervalMinutes(Number.NaN)).toBe(15)
      expect(mergeScheduledExportSettings({ checkIntervalMinutes: 37 }).checkIntervalMinutes).toBe(37)
      expect(mergeScheduledExportSettings({ checkIntervalMinutes: 0 }).checkIntervalMinutes).toBe(1)
    })

    it('applies the global interval as the export cadence for enabled platforms', () => {
      const settings = getDefaultScheduledExportSettings()
      const updated = applyGlobalScheduledInterval(settings, 12)

      expect(updated.checkIntervalMinutes).toBe(12)
      expect(updated.platforms.chatgpt).toMatchObject({
        enabled: true,
        frequency: 'custom',
        intervalMinutes: 12,
      })
      expect(updated.platforms.claude).toMatchObject({
        enabled: false,
        frequency: 'daily',
      })
    })

    it('repairs stale schedule records that request unsupported PDF output', () => {
      const settings = mergeScheduledExportSettings({
        defaultFormat: 'pdf',
        platforms: {
          chatgpt: { enabled: true, frequency: 'not-a-frequency', maxPerRun: 10, format: 'pdf' },
        } as never,
      })

      expect(settings.defaultFormat).toBe('markdown')
      expect(settings.platforms.chatgpt.format).toBeUndefined()
      expect(settings.platforms.chatgpt.frequency).toBe('daily')
    })

    it('shares the total attempt cap without over-claiming between workers', () => {
      const budget = new ScheduledRunBudget(2)
      expect([budget.tryClaim(), budget.tryClaim(), budget.tryClaim()]).toEqual([true, true, false])
      expect(budget.used).toBe(2)
      expect(budget.remaining).toBe(0)
    })

    it('runs at most the configured number of provider workers while preserving result order', async () => {
      let active = 0
      let peak = 0
      const result = await runWithConcurrency(['a', 'b', 'c'], 2, async (item) => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise(resolve => setTimeout(resolve, 2))
        active -= 1
        return item.toUpperCase()
      })

      expect(peak).toBe(2)
      expect(result).toEqual(['A', 'B', 'C'])
    })

    it('limits local output work separately from paced provider requests', async () => {
      const gate = new ScheduledConcurrencyGate(2)
      let active = 0
      let peak = 0
      await Promise.all(Array.from({ length: 5 }, () => gate.run(async () => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise(resolve => setTimeout(resolve, 2))
        active -= 1
      })))
      expect(peak).toBe(2)
    })

    it('spaces request starts even when later reads are allowed to overlap', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(0))
      try {
        const pacer = new ScheduledRequestPacer(100)
        await pacer.waitForTurn()
        const second = pacer.waitForTurn()
        await vi.advanceTimersByTimeAsync(99)
        let settled = false
        void second.then(() => { settled = true })
        await Promise.resolve()
        expect(settled).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        await second
        expect(Date.now()).toBe(100)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('run result classification', () => {
    it('does not treat a partial API list or sidebar fallback as a complete scan', () => {
      expect(isScheduledConversationListComplete({ source: 'api', complete: false })).toBe(false)
      expect(isScheduledConversationListComplete({ source: 'sidebar', complete: true })).toBe(false)
      expect(isScheduledConversationListComplete({ source: 'api', complete: true })).toBe(true)
      expect(isScheduledConversationListComplete(undefined)).toBe(true)
    })

    it('advances lastRun only when every attempted export succeeds', () => {
      expect(classifyScheduledRun({ attempted: 2, exported: 2, failed: 0, skipped: 0, listComplete: true })).toBe('success')
      expect(shouldAdvanceScheduledLastRun({ attempted: 2, exported: 2, failed: 0, skipped: 0, listComplete: true })).toBe(true)
      expect(classifyScheduledRun({ attempted: 2, exported: 1, failed: 1, skipped: 0, listComplete: true })).toBe('partial')
      expect(shouldAdvanceScheduledLastRun({ attempted: 2, exported: 1, failed: 1, skipped: 0, listComplete: true })).toBe(false)
    })

    it('does not advance lastRun when a per-run budget leaves conversations unexported', () => {
      expect(classifyScheduledRun({ attempted: 20, exported: 20, failed: 0, skipped: 30, listComplete: true })).toBe('partial')
      expect(shouldAdvanceScheduledLastRun({ attempted: 20, exported: 20, failed: 0, skipped: 30, listComplete: true })).toBe(false)
    })

    it('does not advance after a list or system failure', () => {
      expect(classifyScheduledRun({ attempted: 0, exported: 0, failed: 0, skipped: 0, listComplete: false, systemError: true })).toBe('failed')
      expect(shouldAdvanceScheduledLastRun({ attempted: 0, exported: 0, failed: 0, skipped: 0, listComplete: false })).toBe(false)
    })
  })
})
