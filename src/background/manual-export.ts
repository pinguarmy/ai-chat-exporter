import type { BackgroundRequestOf, BackgroundResponse } from '../lib/messages/background-messages'
import { initializeManualJobs, startManualJob, stopManualJob } from '../lib/manual-export-job'
import { markAsExported } from '../lib/export-history'
import { handleFetchConversationDetailInBackgroundTab, isProviderConversationUrl } from './background-fetch'

/** Restore (and reconcile) a persisted manual export job after a worker restart. */
export function initializeManualBackgroundJobs(): void {
  void initializeManualJobs({
    read: (item, signal, onTab) => handleFetchConversationDetailInBackgroundTab(item, signal, undefined, onTab),
    record: markAsExported,
  }).catch(() => console.warn('[Manual Export] Could not restore background state; the next start will retry'))
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
