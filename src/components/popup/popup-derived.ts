/**
 * Pure derivations of display state from settings/conversation, shared by the
 * current-chat panel, the bulk panel and the bulk footer.
 */

import { generateFilename, sanitizeFilename } from '../../lib/filename'
import { buildDownloadFilename } from '../../lib/download-path'
import { prepareShareCopy } from '../../lib/share-copy'
import { t, type Locale } from '../../lib/i18n'
import type { Conversation, ExportFormat, ExtensionSettings } from '../../lib/types'
import type { ConversationListLoadMeta, Translate } from './popup-utils'

export interface HistoryState {
  message: string
  warning: boolean
}

/** History completeness state for providers whose full list can be partial. */
export function getHistoryState(options: {
  bulkLoading: boolean
  conversationListNotice: string | null
  conversationListMeta: ConversationListLoadMeta | null
  platform: string | null
  platformLabel: string | null
  locale: Locale
  T: Translate
}): HistoryState | null {
  const { bulkLoading, conversationListNotice, conversationListMeta, platform, platformLabel, locale, T } = options
  return bulkLoading
    ? null
    : conversationListNotice
      ? { message: T(conversationListNotice), warning: true }
      : platform === 'gemini'
        ? conversationListMeta?.source === 'api'
          ? conversationListMeta.complete
            ? { message: T('Gemini account history loaded. You do not need to scroll the sidebar.'), warning: false }
            : { message: T('Gemini returned a partial history. Refresh to retry; sidebar scrolling cannot complete it.'), warning: true }
          : conversationListMeta?.source === 'sidebar'
            ? { message: T('Gemini full history could not be loaded. Showing only current sidebar items; refresh to retry.'), warning: true }
            : null
        : conversationListMeta && platformLabel
          ? conversationListMeta.source === 'api'
            ? conversationListMeta.complete
              ? {
                  message: conversationListMeta.pagesFetched
                    ? t('{0} account history loaded ({1} pages).', locale, platformLabel, conversationListMeta.pagesFetched)
                    : t('{0} account history loaded.', locale, platformLabel),
                  warning: false
                }
              : {
                  message: conversationListMeta.pagesFetched
                    ? t('{0} returned a partial history after {1} pages. The count shown is not complete; refresh to retry.', locale, platformLabel, conversationListMeta.pagesFetched)
                    : t('{0} returned a partial history. The count shown is not complete; refresh to retry.', locale, platformLabel),
                  warning: true
                }
            : {
                message: t('{0} full history could not be loaded. Showing only currently visible sidebar items; refresh to retry.', locale, platformLabel),
                warning: true
              }
          : null
}

/** Filename the quick export will download, shown before the user clicks. */
export function getQuickExportFilename(
  conversation: Conversation | null,
  format: ExportFormat,
  settings: ExtensionSettings | null,
): string {
  const quickExportExt = format === 'markdown' ? (settings?.archiveBundle ? '.zip' : '.md') : '.pdf'
  const filenameConversation = conversation && settings?.safeShare ? prepareShareCopy(conversation) : conversation
  const quickExportBaseFilename = filenameConversation
    ? (settings?.filenamePattern
        ? generateFilename(settings.filenamePattern, filenameConversation)
        : sanitizeFilename(filenameConversation.title || 'conversation') || 'conversation')
    : 'conversation'
  const quickExportDownloadFolder = settings?.downloadFolder ?? 'default'
  const quickExportCustomFolderName = settings?.customFolderName ?? 'AI Chat Exports'
  const quickExportFilename = conversation
    ? buildDownloadFilename(quickExportBaseFilename, conversation.platform, quickExportExt, quickExportDownloadFolder, quickExportCustomFolderName)
    : `…${quickExportExt}`
  return quickExportFilename
}

export function getQuickExportFormatDesc(format: ExportFormat, settings: ExtensionSettings | null, T: Translate): string {
  return format === 'pdf'
    ? T('PDF document')
    : settings?.archiveBundle
      ? T('Markdown + references + tool records bundle')
      : T('Pure Markdown document')
}

export function getBulkFolderLabel(settings: ExtensionSettings | null, T: Translate): string {
  return settings?.downloadFolder === 'custom'
    ? (settings?.customFolderName ?? 'AI Chat Exports')
    : settings?.downloadFolder === 'by-platform'
      ? T('Per-platform subfolders')
      : T('Browser default download folder')
}

/** Selected conversations that duplicate protection will skip, and the rest. */
export function getBulkCounts(settings: ExtensionSettings | null, selectedIds: string[], exportedConversationIds: string[]) {
  const skippedCount = (settings?.skipAlreadyExported ?? true) ? selectedIds.filter(id => exportedConversationIds.includes(id)).length : 0
  // The primary bulk action runs on eligible (not-yet-archived) conversations,
  // so the button and summary count those, not raw selections.
  return { skippedCount, bulkEligibleCount: selectedIds.length - skippedCount }
}
