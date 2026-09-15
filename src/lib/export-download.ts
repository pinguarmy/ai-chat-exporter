import { buildArchive } from './export-archive'
import type { ExportOptions } from './types'
/**
 * Shared helpers for the interactive export download flow: turn rendered
 * Markdown into a completed browser download, then record the finished
 * export with the background worker.
 */

import type { Conversation, ExportFormat } from './types'
import { downloadAndWait } from './download-completion'
import { throwIfExportCancelled } from './export-cancel'

export interface MarkdownDownloadOptions {
  /** Full download path (including any subfolder prefix) passed to the browser. */
  filename: string
  saveAs: boolean
  /** Cancels the in-flight download when the caller stops the export queue. */
  signal?: AbortSignal
}

/**
 * Download Markdown content as a file and wait until the browser reports
 * completion. The temporary object URL is always revoked.
 */
export async function downloadMarkdownFile(
  markdown: string,
  { filename, saveAs, signal }: MarkdownDownloadOptions
): Promise<void> {
  const blob = new Blob([markdown], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  try {
    await downloadAndWait({
      url,
      filename,
      saveAs
    }, 60_000, chrome.downloads, { signal })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Record a completed export with the background worker (export history and
 * the duplicate-protection index). Throws when the queue was cancelled or
 * the worker reports a failure.
 */
export async function finalizeExport(
  conversation: Conversation,
  format: ExportFormat,
  filename: string,
  signal?: AbortSignal
): Promise<void> {
  throwIfExportCancelled(signal)
  const finalized = await chrome.runtime.sendMessage({
    type: 'EXPORT_REQUEST',
    data: { conversation, format, filename }
  })
  throwIfExportCancelled(signal)
  if (finalized?.error) throw new Error(finalized.error)
}

/** Interactive archive download with the same completion/cancellation contract. */
export async function downloadArchiveFile(conversation: Conversation, options: ExportOptions, download: MarkdownDownloadOptions): Promise<void> {
  const archive = await buildArchive(conversation, options, chrome.runtime.getManifest().version)
  throwIfExportCancelled(download.signal)
  const url = URL.createObjectURL(new Blob([archive.bytes as BlobPart], { type: 'application/zip' }))
  try {
    await downloadAndWait({ url, filename: download.filename, saveAs: download.saveAs }, 60_000, chrome.downloads, { signal: download.signal })
  } finally { URL.revokeObjectURL(url) }
}
