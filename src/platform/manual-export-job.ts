import type {
  Conversation,
  ConversationListItem,
  ExtensionSettings,
  ExportOptions,
  ExportedConversationRecord
} from '../core/types'
import { mergeExtensionSettings } from '../core/types'
import { diagnoseExport } from '../core/export-archive'
import { downloadAndWait, resolveDownloadedFilename } from './download-completion'
import { isConversationExportable } from '../core/conversation-integrity'
import { categorizeBulkError } from '../core/bulk-retry'
import { isExportCancelledError, throwIfExportCancelled } from '../core/export-cancel'
import {
  MANUAL_JOB_KEY,
  buildManualExportPayload,
  type ManualExportJob
} from '../core/manual-export-job'

export { MANUAL_JOB_KEY }
export type { ManualExportJob }
interface JobDependencies {
  read: (
    item: ConversationListItem,
    signal: AbortSignal,
    onTab: (id?: number) => Promise<void>
  ) => Promise<{ data?: Conversation; error?: string }>
  record: (record: ExportedConversationRecord) => Promise<void>
}
let controller: AbortController | null = null
let starting: Promise<unknown> = Promise.resolve()
let initialized: Promise<void> | undefined
let dependencies: JobDependencies
const save = async (job: ManualExportJob) => {
  job.updatedAt = Date.now()
  await chrome.storage.local.set({ [MANUAL_JOB_KEY]: job })
}
const read = async (): Promise<ManualExportJob | undefined> =>
  (await chrome.storage.local.get(MANUAL_JOB_KEY))[MANUAL_JOB_KEY]

/** Reconcile persisted browser resources when MV3 restarts; never pretend the old JS queue survived. */
export function initializeManualJobs(deps: JobDependencies): Promise<void> {
  dependencies = deps
  return ensureInitialized()
}

function ensureInitialized(): Promise<void> {
  if (!initialized) {
    initialized = read()
      .then(reconcileInterruptedJob)
      .catch(() => {
        initialized = undefined
        throw new Error('Could not restore background export state. Please retry.')
      })
  }
  return initialized
}

async function reconcileInterruptedJob(job: ManualExportJob | undefined): Promise<void> {
  if (!job || (!job.activeDownload && job.status !== 'running')) return
  if (job.activeTabId) {
    try {
      await chrome.tabs.remove(job.activeTabId)
    } catch {
      /* best-effort cleanup; the tab may already be closed */
    }
  }
  job.activeTabId = undefined
  if (job.activeDownload) {
    const active = job.activeDownload
    let [download] = await chrome.downloads.search({ id: active.id })
    if (download?.state === 'in_progress') {
      try {
        await chrome.downloads.cancel(active.id)
      } catch {
        /* best-effort cleanup; the download may already have finished */
      }
      ;[download] = await chrome.downloads.search({ id: active.id })
    }
    if (download?.state === 'in_progress') {
      job.status = 'interrupted'
      await save(job)
      return
    }
    if (download?.state === 'complete') {
      // The persisted name was requested before completion; the browser may
      // have renamed a duplicate, so confirm the actual name from the item.
      const actualFilename = await resolveDownloadedFilename(active.id, active.filename)
      await dependencies.record({
        id: active.item.id,
        title: active.item.title,
        platform: active.item.platform,
        filename: actualFilename,
        exportedAt: Date.now()
      })
      if (!job.completedIds.includes(active.item.id)) job.completedIds.push(active.item.id)
    }
  }
  job.activeDownload = undefined
  job.status = 'interrupted'
  await save(job)
}

export async function startManualJob(
  items: ConversationListItem[],
  settings: ExtensionSettings,
  resume = false
): Promise<ManualExportJob> {
  const start = starting
    .catch(() => undefined)
    .then(async () => {
      await ensureInitialized()
      if (controller) throw new Error('A background export is already running')
      const previous = await read()
      await reconcileInterruptedJob(previous)
      if (previous?.activeDownload)
        throw new Error('Previous download is still running; retry after it finishes')
      if (!Array.isArray(items) || items.length > 500)
        throw new Error('Select at most 500 conversations per background run')
      const source = resume ? previous?.items : items
      if (!source?.length) throw new Error('No conversations selected')
      const job: ManualExportJob =
        resume && previous
          ? { ...previous, status: 'running', failed: [] }
          : {
              id: crypto.randomUUID(),
              diagnosticCount: 0,
              status: 'running',
              items: [...new Map(source.map(i => [i.id, i])).values()],
              settings: mergeExtensionSettings(settings),
              completedIds: [],
              failed: [],
              updatedAt: Date.now()
            }
      controller = new AbortController()
      try {
        await save(job)
      } catch (err) {
        controller = null
        throw err
      }
      void run(job, controller)
        .catch(async () => {
          job.status = 'interrupted'
          await save(job).catch(() => undefined)
        })
        .finally(() => {
          controller = null
        })
      return job
    })
  starting = start
  return start
}
export async function stopManualJob(): Promise<void> {
  await starting.catch(() => undefined)
  controller?.abort()
}

async function run(job: ManualExportJob, abort: AbortController): Promise<void> {
  const settings = job.settings
  const options: ExportOptions = { ...settings, format: 'markdown' }
  for (const [index, item] of job.items.entries()) {
    if (job.completedIds.includes(item.id)) continue
    try {
      throwIfExportCancelled(abort.signal)
      const result = await dependencies.read(item, abort.signal, async id => {
        job.activeTabId = id
        await save(job)
      })
      throwIfExportCancelled(abort.signal)
      const conversation = result.data
      if (!conversation || conversation.id !== item.id || !isConversationExportable(conversation))
        throw new Error('Conversation verification failed')
      job.diagnosticCount =
        (job.diagnosticCount || 0) +
        diagnoseExport(conversation)
          .filter(d => d.code === 'unresolved_references' || d.code === 'duplicate_message_ids')
          .reduce((n, d) => n + d.count, 0)
      const { filename, url } = await buildManualExportPayload(
        conversation,
        options,
        settings,
        index,
        () => chrome.runtime.getManifest().version
      )
      const downloadId = await downloadAndWait(
        { url, filename, saveAs: false },
        60_000,
        chrome.downloads,
        {
          signal: abort.signal,
          onStarted: async id => {
            job.activeDownload = { id, item, filename }
            await save(job)
          }
        }
      )
      // History must match what the browser actually saved (duplicate renames
      // included), otherwise the duplicate-protection index drifts from disk.
      const actualFilename = await resolveDownloadedFilename(downloadId, filename)
      if (job.activeDownload)
        job.activeDownload = { ...job.activeDownload, filename: actualFilename }
      await dependencies.record({
        id: conversation.id,
        title: conversation.title,
        platform: conversation.platform,
        filename: actualFilename,
        exportedAt: Date.now()
      })
      job.completedIds.push(item.id)
      job.activeDownload = undefined
      await save(job)
    } catch (error) {
      if (isExportCancelledError(error)) {
        job.status = 'cancelled'
        await save(job)
        return
      }
      // A completed download with failed history persistence must be reconciled, not downloaded twice.
      if (job.activeDownload) {
        job.status = 'interrupted'
        await save(job)
        return
      }
      job.failed.push({ id: item.id, category: categorizeBulkError(error) })
      await save(job)
    }
  }
  job.status = 'done'
  await save(job)
}
