/**
 * Shared "an export is running" state for current-chat and bulk exports:
 * loading flag, abort controller, in-flight background fetch ids, and the
 * Stop action (which also stops a background manual job).
 */

import { useRef, useState } from 'react'
import type { ManualExportJob } from '../../../platform/manual-export-job'
import type { Translate } from '../popup-utils'
import { sendBackgroundMessage } from '../../../platform/background-messages'

interface Options {
  T: Translate
  manualJob: ManualExportJob | null
  setError: (error: string | null) => void
}

export function useExportRun({ T, manualJob, setError }: Options) {
  const [localLoading, setLoading] = useState(false)
  const loading = localLoading || manualJob?.status === 'running'
  const [stoppingExport, setStoppingExport] = useState(false)
  const activeExportControllerRef = useRef<AbortController | null>(null)
  const activeBackgroundFetchIdsRef = useRef(new Set<string>())
  const backgroundFetchSequenceRef = useRef(0)

  const stopActiveExport = () => {
    if (manualJob?.status === 'running') {
      void sendBackgroundMessage({ type: 'STOP_MANUAL_EXPORT' }).catch(() =>
        setError(T('Export failed'))
      )
      return
    }
    if (!activeExportControllerRef.current) return
    setStoppingExport(true)
    activeExportControllerRef.current.abort()
    const requestIds = [...activeBackgroundFetchIdsRef.current]
    activeBackgroundFetchIdsRef.current.clear()
    for (const requestId of requestIds) {
      void sendBackgroundMessage({
        type: 'CANCEL_BACKGROUND_CONVERSATION_FETCH',
        data: { requestId }
      }).catch(() => undefined)
    }
  }

  return {
    loading,
    setLoading,
    stoppingExport,
    setStoppingExport,
    activeExportControllerRef,
    activeBackgroundFetchIdsRef,
    backgroundFetchSequenceRef,
    stopActiveExport
  }
}

export type ExportRun = ReturnType<typeof useExportRun>
