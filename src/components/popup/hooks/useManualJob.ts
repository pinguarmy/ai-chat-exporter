/**
 * Background (manual) export job mirrored from extension storage, plus the
 * resume/retry actions that restart it through the background worker.
 */

import { useEffect, useState } from 'react'
import { MANUAL_JOB_KEY, type ManualExportJob } from '../../../platform/manual-export-job'
import type { Translate } from '../popup-utils'
import { sendBackgroundMessage } from '../../../platform/background-messages'

interface Options {
  T: Translate
  platform: string | null
  setExportedConversationIds: (update: (previous: string[]) => string[]) => void
  setError: (error: string | null) => void
}

export function useManualJob({ T, platform, setExportedConversationIds, setError }: Options) {
  const [manualJob, setManualJob] = useState<ManualExportJob | null>(null)

  useEffect(() => {
    const readJob = async () => {
      const stored = await chrome.storage.local.get(MANUAL_JOB_KEY)
      setManualJob(stored[MANUAL_JOB_KEY] || null)
    }
    void readJob().catch(() => undefined)
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[MANUAL_JOB_KEY]) setManualJob(changes[MANUAL_JOB_KEY].newValue || null)
    }
    chrome.storage.onChanged.addListener(changed)
    return () => chrome.storage.onChanged.removeListener(changed)
  }, [])
  useEffect(() => {
    if (!manualJob || !platform) return
    const matching = new Set(manualJob.items.filter(item => item.platform === platform).map(item => item.id))
    const completed = manualJob.completedIds.filter(id => matching.has(id))
    setExportedConversationIds(previous => [...new Set([...previous, ...completed])])
  }, [manualJob, platform])

  const resumeManualJob = async () => {
    try {
      const result = await sendBackgroundMessage({ type: 'START_MANUAL_EXPORT', data: { resume: true } })
      if (result?.error) throw new Error(result.error)
      setManualJob(result!.data)
    } catch (err) { setError(err instanceof Error ? err.message : T('Export failed')) }
  }
  /**
   * Retry only the background job's failed conversations as a fresh job.
   * Deliberately separate from "Resume remaining", which continues with every
   * unfinished item; retrying must not re-download pending-but-untried ones.
   */
  const retryManualJobFailed = async () => {
    if (!manualJob || manualJob.failed.length === 0) return
    const failedIds = new Set(manualJob.failed.map(item => item.id))
    const items = manualJob.items.filter(item => failedIds.has(item.id))
    if (items.length === 0) {
      setError(T('No conversations selected'))
      return
    }
    try {
      const result = await sendBackgroundMessage({ type: 'START_MANUAL_EXPORT', data: { items, settings: manualJob.settings } })
      if (result?.error) throw new Error(result.error)
      setManualJob(result!.data)
    } catch (err) { setError(err instanceof Error ? err.message : T('Export failed')) }
  }

  return { manualJob, setManualJob, resumeManualJob, retryManualJobFailed }
}
