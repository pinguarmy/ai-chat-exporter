import type { ExportFormat, ExtensionSettings, PageSnapshot } from './types'
import { buildSnapshotExportOptions, isPageSnapshot, prepareSnapshotForOutput } from './page-snapshot'
import { conversationToMarkdown } from './export-markdown'
import { downloadMarkdownFile } from './export-download'
import { buildDownloadFilename } from './download-path'
import { sanitizeFilename } from './filename'
import { throwIfExportCancelled } from './export-cancel'

/** Saves a bounded, capture-identified file without registering a complete archive. */
export async function downloadPageSnapshot(snapshot: PageSnapshot, format: ExportFormat, settings?: Partial<ExtensionSettings>, control: { signal?: AbortSignal } = {}): Promise<string> {
  if (!isPageSnapshot(snapshot)) throw new Error('Invalid page snapshot')
  throwIfExportCancelled(control.signal)
  const conversation = prepareSnapshotForOutput(snapshot, settings).conversation
  const options = buildSnapshotExportOptions(format, settings, snapshot.capturedAt)
  const stamp = new Date(snapshot.capturedAt).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const shortId = sanitizeFilename(snapshot.captureId).slice(0, 12) || 'capture'
  const prefix = sanitizeFilename(conversation.title || 'conversation').slice(0, 80) || 'conversation'
  const base = sanitizeFilename(`${prefix}-snapshot-${stamp}-${shortId}`)
  const filename = buildDownloadFilename(base, conversation.platform, format === 'pdf' ? '.pdf' : '.md', settings?.downloadFolder ?? 'default', settings?.customFolderName ?? 'AI Chat Exports')
  const download = { filename, saveAs: settings?.askForSaveLocation ?? false, signal: control.signal }
  if (format === 'pdf') {
    const { exportToPdf } = await import('./export-pdf')
    throwIfExportCancelled(control.signal)
    await exportToPdf(conversation, options, filename, download)
  } else {
    await downloadMarkdownFile(conversationToMarkdown(conversation, options), download)
  }
  return filename
}
