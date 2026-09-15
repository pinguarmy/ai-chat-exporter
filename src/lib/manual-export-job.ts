import type { Conversation, ConversationListItem, ExtensionSettings, ExportOptions, ExportedConversationRecord } from './types'
import { mergeExtensionSettings } from './types'
import { conversationToMarkdown } from './export-markdown'
import { buildArchive, diagnoseExport } from './export-archive'
import { generateFilename } from './filename'
import { buildDownloadFilename } from './download-path'
import { textToDataUrl } from './download-url'
import { downloadAndWait } from './download-completion'
import { isConversationExportable } from './conversation-integrity'
import { categorizeBulkError, type BulkFailedItem } from './bulk-retry'
import { isExportCancelledError, throwIfExportCancelled } from './export-cancel'

export const MANUAL_JOB_KEY = 'manualExportJob'
export interface ManualExportJob {
  id: string
  status: 'running' | 'done' | 'interrupted' | 'cancelled'
  items: ConversationListItem[]
  settings: ExtensionSettings
  completedIds: string[]
  failed: BulkFailedItem[]
  diagnosticCount?: number
  activeTabId?: number
  activeDownload?: { id: number; item: ConversationListItem; filename: string }
  updatedAt: number
}
interface JobDependencies {
  read: (item: ConversationListItem, signal: AbortSignal, onTab: (id?: number) => Promise<void>) => Promise<{ data?: Conversation; error?: string }>
  record: (record: ExportedConversationRecord) => Promise<void>
}
let controller: AbortController | null = null
let starting: Promise<unknown> = Promise.resolve()
let initialized: Promise<void> | undefined
let dependencies: JobDependencies
const save = async (job: ManualExportJob) => { job.updatedAt = Date.now(); await chrome.storage.local.set({ [MANUAL_JOB_KEY]: job }) }
const read = async (): Promise<ManualExportJob | undefined> => (await chrome.storage.local.get(MANUAL_JOB_KEY))[MANUAL_JOB_KEY]

/** Reconcile persisted browser resources when MV3 restarts; never pretend the old JS queue survived. */
export function initializeManualJobs(deps: JobDependencies): Promise<void> {
  dependencies = deps
  if (!initialized) initialized = read().then(reconcileInterruptedJob)
  return initialized
}

async function reconcileInterruptedJob(job: ManualExportJob | undefined): Promise<void> {
    if (!job || (!job.activeDownload && job.status !== 'running')) return
    if (job.activeTabId) { try { await chrome.tabs.remove(job.activeTabId) } catch {} }
    job.activeTabId = undefined
    if (job.activeDownload) {
      const active = job.activeDownload
      let [download] = await chrome.downloads.search({ id: active.id })
      if (download?.state === 'in_progress') {
        try { await chrome.downloads.cancel(active.id) } catch {}
        ;[download] = await chrome.downloads.search({ id: active.id })
      }
      if (download?.state === 'in_progress') {
        job.status = 'interrupted'
        await save(job)
        return
      }
      if (download?.state === 'complete') {
        await dependencies.record({ id: active.item.id, title: active.item.title, platform: active.item.platform, filename: active.filename, exportedAt: Date.now() })
        if (!job.completedIds.includes(active.item.id)) job.completedIds.push(active.item.id)
      }
    }
    job.activeDownload = undefined
    job.status = 'interrupted'
    await save(job)

}

export async function startManualJob(items: ConversationListItem[], settings: ExtensionSettings, resume = false): Promise<ManualExportJob> {
  const start = starting.catch(() => undefined).then(async () => {
    await initialized
    if (controller) throw new Error('A background export is already running')
    const previous = await read()
    await reconcileInterruptedJob(previous)
    if (previous?.activeDownload) throw new Error('Previous download is still running; retry after it finishes')
    if (!Array.isArray(items) || items.length > 500) throw new Error('Select at most 500 conversations per background run')
    const source = resume ? previous?.items : items
    if (!source?.length) throw new Error('No conversations selected')
    const job: ManualExportJob = resume && previous ? { ...previous, status: 'running', failed: [] } : {
      id: crypto.randomUUID(), diagnosticCount: 0, status: 'running', items: [...new Map(source.map(i => [i.id, i])).values()], settings: mergeExtensionSettings(settings), completedIds: [], failed: [], updatedAt: Date.now(),
    }
    controller = new AbortController()
    try { await save(job) } catch (err) { controller = null; throw err }
    void run(job, controller).catch(async () => { job.status = 'interrupted'; await save(job).catch(() => undefined) }).finally(() => { controller = null })
    return job
  })
  starting = start
  return start
}
export async function stopManualJob(): Promise<void> { await starting.catch(() => undefined); controller?.abort() }

async function run(job: ManualExportJob, abort: AbortController): Promise<void> {
  const settings = job.settings
  const options: ExportOptions = { ...settings, format: 'markdown' }
  for (const [index, item] of job.items.entries()) {
    if (job.completedIds.includes(item.id)) continue
    try {
      throwIfExportCancelled(abort.signal)
      const result = await dependencies.read(item, abort.signal, async id => { job.activeTabId = id; await save(job) })
      throwIfExportCancelled(abort.signal)
      const conversation = result.data
      if (!conversation || conversation.id !== item.id || !isConversationExportable(conversation)) throw new Error('Conversation verification failed')
      job.diagnosticCount = (job.diagnosticCount || 0) + diagnoseExport(conversation).filter(d => d.code === 'unresolved_references' || d.code === 'duplicate_message_ids').reduce((n, d) => n + d.count, 0)
      const filename = buildDownloadFilename(generateFilename(settings.filenamePattern, conversation, index + 1), conversation.platform, settings.archiveBundle ? '.zip' : '.md', settings.downloadFolder, settings.customFolderName)
      let url: string
      if (settings.archiveBundle) {
        const archive = await buildArchive(conversation, options, chrome.runtime.getManifest().version)
        let binary = ''
        for (let offset = 0; offset < archive.bytes.length; offset += 32768) binary += String.fromCharCode(...archive.bytes.subarray(offset, offset + 32768))
        url = `data:application/zip;base64,${btoa(binary)}`
      } else url = textToDataUrl(conversationToMarkdown(conversation, options), 'text/markdown')
      await downloadAndWait({ url, filename, saveAs: false }, 60_000, chrome.downloads, { signal: abort.signal, onStarted: async id => { job.activeDownload = { id, item, filename }; await save(job) } })
      await dependencies.record({ id: conversation.id, title: conversation.title, platform: conversation.platform, filename, exportedAt: Date.now() })
      job.completedIds.push(item.id)
      job.activeDownload = undefined
      await save(job)
    } catch (error) {
      if (isExportCancelledError(error)) { job.status = 'cancelled'; await save(job); return }
      // A completed download with failed history persistence must be reconciled, not downloaded twice.
      if (job.activeDownload) { job.status = 'interrupted'; await save(job); return }
      job.failed.push({ id: item.id, category: categorizeBulkError(error) })
      await save(job)
    }
  }
  job.status = 'done'
  await save(job)
}
