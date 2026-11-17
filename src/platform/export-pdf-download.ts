/** Browser download of a rendered PDF; layout and rendering live in core/export-pdf. */
import type { Conversation, ExportOptions } from '../core/types'
import { exportToPdfBlob } from '../core/export-pdf'
import { throwIfExportCancelled } from '../core/export-cancel'
import {
  downloadAndWait,
  resolveDownloadedFilename,
  type DownloadWaitControl
} from './download-completion'

/**
 * Export conversation to PDF and auto-download
 * @param conversation - The conversation
 * @param options - Export options
 * @param filename - Filename for the downloaded file
 * @returns The browser-confirmed filename (duplicates may be renamed and a
 *   Save As dialog may place the file elsewhere; see resolveDownloadedFilename)
 */
export async function exportToPdf(
  conversation: Conversation,
  options: ExportOptions,
  filename: string,
  downloadControl: DownloadWaitControl & { saveAs?: boolean } = {}
): Promise<string> {
  throwIfExportCancelled(downloadControl.signal)
  // Ensure filename has .pdf extension
  if (!filename.endsWith('.pdf')) {
    filename += '.pdf'
  }

  // Generate PDF blob
  const blob = await exportToPdfBlob(conversation, options, downloadControl.signal)
  throwIfExportCancelled(downloadControl.signal)

  // Create object URL
  const url = URL.createObjectURL(blob)

  try {
    // Auto-download using chrome.downloads API
    const downloadId = await downloadAndWait(
      {
        url,
        filename,
        saveAs: downloadControl.saveAs ?? false
      },
      60_000,
      chrome.downloads,
      downloadControl
    )
    return resolveDownloadedFilename(downloadId, filename)
  } finally {
    // Clean up object URL
    URL.revokeObjectURL(url)
  }
}
