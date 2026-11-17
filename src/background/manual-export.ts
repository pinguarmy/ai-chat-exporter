import type { BackgroundRequestOf, BackgroundResponse } from '../platform/background-messages'
import { initializeManualJobs, startManualJob, stopManualJob } from '../platform/manual-export-job'
import { markAsExported } from '../platform/export-history'
import { handleFetchConversationDetailInBackgroundTab, isProviderConversationUrl } from './background-fetch'
import { createLogger } from '../core/logger'

const log = createLogger('Manual Export')

/** Restore (and reconcile) a persisted manual export job after a worker restart. */
export function initializeManualBackgroundJobs(): void {
  void initializeManualJobs({
    read: (item, signal, onTab) => handleFetchConversationDetailInBackgroundTab(item, signal, undefined, onTab),
    record: markAsExported,
  }).catch(() => log.warn('Could not restore background state; the next start will retry'))
}

export async function handleStartManualExport(
  { data }: BackgroundRequestOf<'START_MANUAL_EXPORT'>,
): Promise<BackgroundResponse> {
  if (!data?.resume && (!Array.isArray(data?.items) || data.items.some(item => !isProviderConversationUrl(item.url)))) return { error: 'Invalid conversation list' }
  return { data: await startManualJob(data.items || [], data.settings!, data.resume) }
}

export async function handleStopManualExport(): Promise<BackgroundResponse> {
  await stopManualJob()
  return { data: true }
}
