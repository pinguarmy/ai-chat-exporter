/**
 * Live filename/folder preview shown in the General card and the schedule
 * rail. Uses fixed sample values so it never touches real conversations.
 */

import { generateFilename, sanitizeFilename } from '../../lib/filename'
import { sanitizeDownloadFolderName } from '../../lib/download-path'
import type { ExtensionSettings } from '../../lib/types'

export function buildFilenamePreview(settings: ExtensionSettings): { previewFolder: string; previewPath: string } {
  const now = new Date()
  const previewExportDate = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
  const previewConversationDate = '2026-06-08'
  const previewConversationDateTime = '2026-06-08T093000'
  const previewLastMessageDateTime = generateFilename('{last_message_datetime}', {
    id: 'preview', title: '', url: '', platform: 'chatgpt',
    messages: [{ id: 'preview', role: 'assistant', content: '', timestamp: new Date(2026, 5, 11, 9, 30).getTime() }],
  })
  const previewFilename = sanitizeFilename(
    settings.filenamePattern
      .replace(/\{date\}/g, previewConversationDate)
      .replace(/\{title\}/g, 'my-chat')
      .replace(/\{id\}/g, 'a1b2c3d4')
      .replace(/\{full_id\}/g, 'a1b2c3d4-1234-4567-89ab-123456789abc')
      .replace(/\{platform\}/g, 'chatgpt')
      .replace(/\{index\}/g, '001')
      .replace(/\{msgcount\}/g, '24')
      .replace(/\{datetime\}/g, previewConversationDateTime)
      .replace(/\{conv_date\}/g, previewConversationDate)
      .replace(/\{conv_datetime\}/g, previewConversationDateTime)
      .replace(/\{end_date\}/g, previewExportDate)
      .replace(/\{last_message_date\}/g, '2026-06-11')
      .replace(/\{last_message_datetime\}/g, previewLastMessageDateTime)
  ) || 'my-chat'

  /** Destination folder prefix shown in the live filename preview */
  const previewFolder =
    settings.downloadFolder === 'by-platform'
      ? 'ChatGPT/'
      : settings.downloadFolder === 'custom'
        ? `${sanitizeDownloadFolderName(settings.customFolderName || 'AI Chat Exports')}/`
        : ''
  const previewPath = `Downloads/${previewFolder}${previewFilename}.${settings.defaultFormat === 'pdf' ? 'pdf' : 'md'}`
  return { previewFolder, previewPath }
}
