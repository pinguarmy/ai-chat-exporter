import type { Conversation, ConversationListItem, ExtensionSettings, ExportOptions } from './types'
import { conversationToMarkdown } from './export-markdown'
import { buildArchive } from './export-archive'
import { generateFilename } from './filename'
import { prepareShareCopy } from './share-copy'
import { buildDownloadFilename } from './download-path'
import { bytesToDataUrl, textToDataUrl } from './download-url'
import type { BulkFailedItem } from './bulk-retry'

/** Persisted shape of a Markdown/archive bulk export queue (storage lives in platform/manual-export-job). */
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

/**
 * Build the download filename and data URL for one queue item. The extension
 * version is injected so this stays free of browser-extension APIs.
 */
export async function buildManualExportPayload(
  conversation: Conversation,
  options: ExportOptions,
  settings: ExtensionSettings,
  index: number,
  extensionVersion: () => string
): Promise<{ filename: string; url: string }> {
  const filenameConversation = settings.safeShare ? prepareShareCopy(conversation) : conversation
  const filename = buildDownloadFilename(
    generateFilename(settings.filenamePattern, filenameConversation, index + 1),
    conversation.platform,
    settings.archiveBundle ? '.zip' : '.md',
    settings.downloadFolder,
    settings.customFolderName
  )
  let url: string
  if (settings.archiveBundle) {
    const archive = await buildArchive(conversation, options, extensionVersion())
    url = bytesToDataUrl(archive.bytes, 'application/zip')
  } else url = textToDataUrl(conversationToMarkdown(conversation, options), 'text/markdown')
  return { filename, url }
}
