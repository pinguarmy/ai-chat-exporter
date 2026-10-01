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
import { conversationToMarkdown } from './export-markdown'
import { generateFilename, sanitizeFilename } from './filename'
import { buildDownloadFilename } from './download-path'
import type { ExtensionSettings } from './types'

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

interface ConversationDownloadControl {
  signal?: AbortSignal
  /** Preserve per-item filename numbering for interactive bulk exports. */
  index?: number
  /** Preview downloads use the exact Markdown currently displayed. */
  markdown?: string
}

/** Shared interactive flow; PDF stays lazy-loaded and history follows completion. */
export async function exportConversationFile(
  conversation: Conversation,
  options: ExportOptions,
  settings?: Partial<ExtensionSettings>,
  control: ConversationDownloadControl = {}
): Promise<string> {
  throwIfExportCancelled(control.signal)
  const base = settings?.filenamePattern
    ? generateFilename(settings.filenamePattern, conversation, control.index)
    : sanitizeFilename(conversation.title || 'conversation') || 'conversation'
  const extension = options.format === 'pdf' ? '.pdf' : options.archiveBundle ? '.zip' : '.md'
  const filename = buildDownloadFilename(base, conversation.platform, extension, settings?.downloadFolder ?? 'default', settings?.customFolderName ?? 'AI Chat Exports')
  const download = { filename, saveAs: settings?.askForSaveLocation ?? false, signal: control.signal }
  if (options.format === 'pdf') {
    const { exportToPdf } = await import('./export-pdf')
    throwIfExportCancelled(control.signal)
    await exportToPdf(conversation, options, filename, download)
  } else if (options.archiveBundle) {
    await downloadArchiveFile(conversation, options, download)
  } else {
    await downloadMarkdownFile(control.markdown ?? conversationToMarkdown(conversation, options), download)
  }
  await finalizeExport(conversation, options.format, filename, control.signal)
  return filename
}
