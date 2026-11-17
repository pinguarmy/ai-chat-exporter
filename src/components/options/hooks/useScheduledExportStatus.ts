/**
 * Background scheduled-export status: polls storage for the last-run summary
 * and per-platform checkpoints, derives each platform's next run locally, and
 * exposes the manual trigger / stop / clear-history actions.
 */

import { useEffect, useState } from 'react'
import type { ExportablePlatform, ScheduledExportSettings, ScheduledExportStatus } from '../../../core/types'
import { ALL_PLATFORMS, getNextScheduledRunAt } from '../../../core/scheduled-export'
import { sendBackgroundMessage } from '../../../platform/background-messages'

export function useScheduledExportStatus(scheduleSettings: ScheduledExportSettings) {
  const [scheduleStatus, setScheduleStatus] = useState<ScheduledExportStatus | null>(null)
  const [nextRunAt, setNextRunAt] = useState<Partial<Record<ExportablePlatform, number>>>({})
  const [stoppingScheduledExport, setStoppingScheduledExport] = useState(false)
  const platformKeys = ALL_PLATFORMS

  // The background task owns the final state. Keep the destructive action
  // disabled while its cancellation is unwinding, then re-enable it as soon
  // as storage confirms the run has finished.
  useEffect(() => {
    if (scheduleStatus && !scheduleStatus.isRunning) {
      setStoppingScheduledExport(false)
    }
  }, [scheduleStatus])

  // Poll status and the per-platform checkpoints periodically. The next run
  // is derived locally from the same schedule rules as the worker, so it does
  // not need another persisted field that could drift from the checkpoint.
  useEffect(() => {
    const loadStatus = async () => {
      try {
        const checkpointKeys = platformKeys.map(platform => `scheduledExport-lastRun-${platform}`)
        const result = await chrome.storage.local.get(['scheduledExportStatus', ...checkpointKeys])
        const status = (result.scheduledExportStatus as ScheduledExportStatus | undefined) || null
        setScheduleStatus(status)

        if (!scheduleSettings.enabled) {
          setNextRunAt({})
          return
        }

        const now = Date.now()
        const nextRuns: Partial<Record<ExportablePlatform, number>> = {}
        for (const platform of platformKeys) {
          const config = scheduleSettings.platforms[platform]
          if (!config?.enabled) continue
          const lastRunValue = result[`scheduledExport-lastRun-${platform}`]
          const lastRun = typeof lastRunValue === 'number' && Number.isFinite(lastRunValue)
            ? lastRunValue
            : 0
          nextRuns[platform] = getNextScheduledRunAt(config, lastRun, now)
        }
        setNextRunAt(nextRuns)
      } catch {}
    }
    loadStatus()
    const interval = setInterval(loadStatus, 5000)
    return () => clearInterval(interval)
  }, [scheduleSettings])

  /**
   * Trigger manual scheduled export run
   */
  const triggerScheduledExport = async () => {
    try {
      await sendBackgroundMessage({ type: 'SCHEDULED_EXPORT_RUN' })
    } catch (err) {
      console.error('Failed to trigger scheduled export:', err)
    }
  }

  const stopScheduledExport = async () => {
    setStoppingScheduledExport(true)
    try {
      const result = await sendBackgroundMessage({ type: 'SCHEDULED_EXPORT_STOP' })
      if (result?.error) throw new Error(result.error)
      if (!result?.data) {
        setStoppingScheduledExport(false)
        return
      }
      setScheduleStatus(previous => previous
        ? { ...previous, lastRunCancelled: true, stopRequested: true }
        : previous
      )
    } catch (err) {
      setStoppingScheduledExport(false)
      console.error('Failed to stop scheduled export:', err)
    }
  }

  /**
   * Clear all exported history
   */
  const clearExportHistory = async () => {
    try {
      const result = await sendBackgroundMessage({ type: 'SCHEDULED_EXPORT_CLEAR_HISTORY' })
      if (result?.error) throw new Error(result.error)
      // The worker removes the persisted status; reflect that immediately
      // instead of leaving an old failure panel visible until the next poll.
      setScheduleStatus(null)
    } catch (err) {
      console.error('Failed to clear export history:', err)
    }
  }

  return {
    scheduleStatus,
    nextRunAt,
    stoppingScheduledExport,
    triggerScheduledExport,
    stopScheduledExport,
    clearExportHistory,
  }
}
