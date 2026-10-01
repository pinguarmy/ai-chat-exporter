import { markAsExported } from './export-history'
import type { ExportedConversationRecord } from './types'

export const PENDING_DOWNLOADS_KEY = 'scheduledExport-pendingDownloads'
type PendingDownloads = Record<string, ExportedConversationRecord>
let writes: Promise<unknown> = Promise.resolve()

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = writes.catch(() => undefined).then(operation)
  writes = result
  return result
}

async function read(): Promise<PendingDownloads> {
  return (await chrome.storage.local.get(PENDING_DOWNLOADS_KEY))[PENDING_DOWNLOADS_KEY] || {}
}

export function retainPendingDownload(id: number, record: ExportedConversationRecord): Promise<void> {
  return serialize(async () => {
    const pending = await read()
    pending[id] = record
    await chrome.storage.local.set({ [PENDING_DOWNLOADS_KEY]: pending })
  })
}

export function completePendingDownload(id: number): Promise<void> {
  return serialize(async () => {
    const pending = await read()
    if (!pending[id]) throw new Error('Download history registration is missing')
    await markAsExported(pending[id])
    delete pending[id]
    await chrome.storage.local.set({ [PENDING_DOWNLOADS_KEY]: pending })
  })
}

/** Keep uncertain downloads durable; release only absent/interrupted or recorded files. */
export function reconcilePendingDownloads(cancel = false): Promise<boolean> {
  return serialize(async () => {
    const pending = await read()
    for (const id of Object.keys(pending)) {
      let [download] = await chrome.downloads.search({ id: Number(id) })
      if (cancel && download?.state === 'in_progress') {
        try { await chrome.downloads.cancel(Number(id)) } catch { /* Recheck the browser state below. */ }
        ;[download] = await chrome.downloads.search({ id: Number(id) })
      }
      if (download && download.state !== 'complete' && download.state !== 'interrupted') continue
      if (download?.state === 'complete') await markAsExported(pending[id])
      delete pending[id]
      await chrome.storage.local.set({ [PENDING_DOWNLOADS_KEY]: pending })
    }
    return Object.keys(pending).length === 0
  })
}
