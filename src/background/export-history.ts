/**
 * Export history: completed-export registration, the opaque ID list used by
 * the bulk UI, and clearing history (with scheduled-run diagnostics).
 */
import type { Conversation, ExportablePlatform } from '../lib/types'
import { isConversationComplete } from '../lib/conversation-integrity'
import { clearPlatformHistory, getExportedIds, markAsExported } from '../lib/export-history'
import { ALL_PLATFORMS } from '../lib/scheduled-export'
import { SCHEDULED_ACTIVE_RUN_KEY, SCHEDULED_STOP_REQUEST_KEY } from '../lib/scheduled-run-resources'

/**
 * Handle export request from popup
 */
export async function handleExportRequest(
  data: { conversation: Conversation; format: string; filename?: string }
): Promise<{ data?: string; error?: string }> {
  try {
    if (!data?.conversation || data.conversation.snapshot || data.conversation.selection || !isConversationComplete(data.conversation)) {
      return { error: 'No conversation data provided' }
    }
    
    const conversationId = data.conversation.id

    // Track this completed export so scheduled scans can deduplicate it.
    await markAsExported({
      id: conversationId,
      platform: data.conversation.platform,
      title: data.conversation.title,
      exportedAt: Date.now(),
      filename: data.filename || '',
    })
    
    return { data: conversationId }
  } catch (error) {
    return { error: 'Failed to process export request' }
  }
}

/**
 * Handle clearing export history
 */
export async function handleClearExportHistory(): Promise<{ data?: boolean; error?: string }> {
  try {
    await clearExportedHistory()
    return { data: true }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

/** Expose only opaque IDs so the bulk UI can avoid re-downloading its archive. */
export async function handleGetExportedConversationIds(
  platform: ExportablePlatform
): Promise<{ data?: string[]; error?: string }> {
  if (!ALL_PLATFORMS.includes(platform)) return { error: 'Unsupported platform' }
  try {
    return { data: [...await getExportedIds(platform)] }
  } catch {
    return { error: 'Could not read export history' }
  }
}

/** Clear all exported history for a platform (or all platforms) */
export async function clearExportedHistory(platform?: ExportablePlatform): Promise<void> {
  const platforms = platform
    ? [platform]
    : ALL_PLATFORMS
  await clearPlatformHistory(platforms)

  // The options-page action is global. Clear its visible last-run diagnostics
  // as well, otherwise a successful clear still looks like the previous failed
  // run and the next automatic check remains artificially delayed.
  if (!platform) {
    await chrome.storage.local.remove([
      'scheduledExportStatus',
      SCHEDULED_ACTIVE_RUN_KEY,
      SCHEDULED_STOP_REQUEST_KEY,
      ...ALL_PLATFORMS.map(p => `scheduledExport-lastRun-${p}`),
    ])
  }
}
