/**
 * Options hooks (mocked chrome, no UI): useScheduledExportStatus polling /
 * stop semantics and useOptionsSettings load + patch-based saving.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { getDefaultScheduledExportSettings, getNextScheduledRunAt } from '../src/core/scheduled-export'
import type { ScheduledExportSettings, ScheduledExportStatus } from '../src/core/types'
import { useScheduledExportStatus } from '../src/components/options/hooks/useScheduledExportStatus'
import { useOptionsSettings } from '../src/components/options/hooks/useOptionsSettings'

const NOW = 1_800_000_000_000

let storageGet: ReturnType<typeof vi.fn>
let sendMessage: ReturnType<typeof vi.fn>
let stored: Record<string, unknown>

beforeEach(() => {
  stored = {}
  storageGet = vi.fn(async () => stored)
  sendMessage = vi.fn(async () => ({ data: true }))
  vi.stubGlobal('chrome', {
    storage: { local: { get: storageGet } },
    runtime: { sendMessage },
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function enabledSchedule(): ScheduledExportSettings {
  const schedule = getDefaultScheduledExportSettings()
  schedule.enabled = true
  schedule.platforms.chatgpt = { ...schedule.platforms.chatgpt, enabled: true, frequency: 'hourly' }
  return schedule
}

describe('useScheduledExportStatus', () => {
  it('reads status and checkpoints, deriving next runs only for enabled platforms', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW })
    const status = { isRunning: false, lastRunAt: NOW - 1000 } as ScheduledExportStatus
    stored = { scheduledExportStatus: status, 'scheduledExport-lastRun-chatgpt': NOW - 60_000 }
    const schedule = enabledSchedule()

    const { result } = renderHook(() => useScheduledExportStatus(schedule))

    await waitFor(() => expect(result.current.scheduleStatus).toEqual(status))
    expect(storageGet).toHaveBeenCalledWith(expect.arrayContaining([
      'scheduledExportStatus', 'scheduledExport-lastRun-chatgpt', 'scheduledExport-lastRun-grok',
    ]))
    expect(Object.keys(result.current.nextRunAt)).toEqual(['chatgpt'])
    expect(result.current.nextRunAt.chatgpt).toBe(getNextScheduledRunAt(schedule.platforms.chatgpt, NOW - 60_000, NOW))
  })

  it('reports no next runs while the schedule is disabled and polls every 5s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW })
    const schedule = { ...enabledSchedule(), enabled: false }

    const { result } = renderHook(() => useScheduledExportStatus(schedule))
    await waitFor(() => expect(storageGet).toHaveBeenCalledTimes(1))
    expect(result.current.nextRunAt).toEqual({})

    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(storageGet).toHaveBeenCalledTimes(2)
  })

  it('restarts the poll when the schedule changes and stops polling on unmount', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW })
    let schedule = { ...enabledSchedule(), enabled: false }
    const { rerender, unmount } = renderHook(() => useScheduledExportStatus(schedule))
    await waitFor(() => expect(storageGet).toHaveBeenCalledTimes(1))

    schedule = enabledSchedule()
    rerender()
    await waitFor(() => expect(storageGet).toHaveBeenCalledTimes(2))

    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(storageGet).toHaveBeenCalledTimes(2)
  })

  it('keeps Stop disabled until storage confirms the run finished', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW })
    const schedule = enabledSchedule()
    stored = { scheduledExportStatus: { isRunning: true, activePlatforms: ['chatgpt'] } }
    const { result } = renderHook(() => useScheduledExportStatus(schedule))
    await waitFor(() => expect(result.current.scheduleStatus?.isRunning).toBe(true))

    await act(async () => { await result.current.stopScheduledExport() })
    expect(sendMessage).toHaveBeenCalledWith({ type: 'SCHEDULED_EXPORT_STOP' })
    expect(result.current.stoppingScheduledExport).toBe(true)
    expect(result.current.scheduleStatus).toMatchObject({ isRunning: true, stopRequested: true, lastRunCancelled: true })

    stored = { scheduledExportStatus: { isRunning: false, lastRunAt: NOW } }
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    await waitFor(() => expect(result.current.scheduleStatus?.isRunning).toBe(false))
    expect(result.current.stoppingScheduledExport).toBe(false)
  })

  it('re-enables Stop when the worker reports nothing to stop or the request fails', async () => {
    const schedule = enabledSchedule()
    const { result } = renderHook(() => useScheduledExportStatus(schedule))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    sendMessage.mockResolvedValueOnce({ data: false })
    await act(async () => { await result.current.stopScheduledExport() })
    expect(result.current.stoppingScheduledExport).toBe(false)

    sendMessage.mockResolvedValueOnce({ error: 'worker gone' })
    await act(async () => { await result.current.stopScheduledExport() })
    expect(result.current.stoppingScheduledExport).toBe(false)
  })

  it('clears history through the worker and drops the stale status immediately', async () => {
    const schedule = enabledSchedule()
    stored = { scheduledExportStatus: { isRunning: false, lastRunAt: NOW, lastRunError: 'old failure' } }
    const { result } = renderHook(() => useScheduledExportStatus(schedule))
    await waitFor(() => expect(result.current.scheduleStatus?.lastRunError).toBe('old failure'))

    stored = {}
    await act(async () => { await result.current.clearExportHistory() })

    expect(sendMessage).toHaveBeenCalledWith({ type: 'SCHEDULED_EXPORT_CLEAR_HISTORY' })
    expect(result.current.scheduleStatus).toBeNull()
  })
})

describe('useOptionsSettings', () => {
  it('loads stored settings and re-opens an enabled schedule', async () => {
    stored = {
      settings: {
        locale: 'de',
        scheduledExport: { enabled: true, platforms: { claude: { enabled: true } } },
      },
    }
    const { result } = renderHook(() => useOptionsSettings())

    await waitFor(() => expect(result.current.settings.locale).toBe('de'))
    await waitFor(() => expect(result.current.scheduleSettings.enabled).toBe(true))
    expect(result.current.scheduleSettings.platforms.claude.enabled).toBe(true)
    expect(result.current.scheduleExpanded).toBe(true)
  })

  it('keeps the schedule collapsed when none is stored or it is disabled', async () => {
    stored = { settings: { locale: 'en', scheduledExport: { enabled: false } } }
    const { result } = renderHook(() => useOptionsSettings())

    await waitFor(() => expect(storageGet).toHaveBeenCalled())
    await act(async () => { await Promise.resolve() })
    expect(result.current.scheduleExpanded).toBe(false)
  })

  it('saves only the changed key and flashes the saved flag', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    stored = { settings: { locale: 'en' } }
    sendMessage.mockResolvedValue({ data: { locale: 'en' } })
    const { result } = renderHook(() => useOptionsSettings())
    await waitFor(() => expect(storageGet).toHaveBeenCalled())

    await act(async () => { result.current.updateSetting('includeImages', false) })

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'PATCH_SETTINGS',
      data: { includeImages: false },
    })
    expect(result.current.saved).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(result.current.saved).toBe(false)
  })

  it('saves a schedule change as a nested diff and mirrors it into settings', async () => {
    sendMessage.mockResolvedValue({ data: {} })
    const { result } = renderHook(() => useOptionsSettings())
    const next = { ...result.current.scheduleSettings, closeTabAfterExport: !result.current.scheduleSettings.closeTabAfterExport }

    await act(async () => { await result.current.saveScheduleSettings(next) })

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'PATCH_SETTINGS',
      data: { scheduledExport: { closeTabAfterExport: next.closeTabAfterExport } },
    })
    expect(result.current.scheduleSettings.closeTabAfterExport).toBe(next.closeTabAfterExport)
    expect(result.current.settings.scheduledExport?.closeTabAfterExport).toBe(next.closeTabAfterExport)
  })

  it('alerts instead of flashing saved when the background rejects the patch', async () => {
    const alertMock = vi.fn()
    vi.stubGlobal('alert', alertMock)
    sendMessage.mockResolvedValue({ error: 'nope' })
    const { result } = renderHook(() => useOptionsSettings())

    await act(async () => { result.current.updateSetting('includeImages', false) })

    expect(alertMock).toHaveBeenCalledWith('Settings could not be saved. Please retry.')
    expect(result.current.saved).toBe(false)
  })
})
