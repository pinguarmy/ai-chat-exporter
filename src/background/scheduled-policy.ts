/**
 * Pure scheduled-export policy: export options, conversation resolution with
 * page fallback, failure diagnostics and conversation-list retry. Nothing here
 * owns run state, which keeps the policy unit-testable.
 */
import type {
  Conversation,
  ConversationListItem,
  ExportablePlatform,
  ExportOptions,
  ExtensionSettings,
  ScheduledExportFailureReason,
  ScheduledExportStatus,
} from '../core/types'
import { mergeExtensionSettings } from '../core/types'
import { hasUsableConversation } from '../core/bulk-conversation'
import {
  delay,
  isAuthenticationRequiredError,
  isExportCancelledError,
  throwIfExportCancelled,
} from '../core/scheduled-export'
import { isProviderRateLimitError } from '../core/provider-rate-limit'

/**
 * Build the same Markdown export policy used by interactive exports.
 */
export function buildScheduledExportOptions(
  format: ExportOptions['format'],
  settings?: Partial<ExtensionSettings>
): ExportOptions {
  const resolved = mergeExtensionSettings(settings)
  return {
    format,
    includeMetadata: resolved.includeMetadata,
    includeCodeBlocks: resolved.includeCodeBlocks,
    includeImages: resolved.includeImages,
    exportArtifacts: resolved.exportArtifacts,
    includeUploadedFiles: resolved.includeUploadedFiles,
    referenceExportMode: resolved.referenceExportMode,
    filenamePattern: resolved.filenamePattern,
    assistantDisplayName: resolved.assistantDisplayName,
    showMessageTimestamps: resolved.showMessageTimestamps,
    locale: resolved.locale,
  }
}

export type ScheduledConversationFetchResult = {
  data?: Conversation | null
  error?: string
}

export interface ScheduledConversationResolution {
  conversation: Conversation | null
  /** The initial API-detail problem, retained only as a safe aggregate category. */
  directFailureReason?: 'rate_limited' | 'detail_unavailable' | 'detail_incomplete' | 'auth_required'
  fallbackRecovered: boolean
  /** Final failure category when neither direct detail nor page fallback is usable. */
  failureReason?: ScheduledExportFailureReason
}

/**
 * Scheduled runs begin with the fast provider API path, but must not discard a
 * conversation merely because that response is incomplete. Interactive bulk
 * export already has a page-level fallback; this keeps scheduled export on the
 * same completeness contract without retaining chat text in diagnostics.
 */
export async function resolveScheduledConversation(
  item: ConversationListItem,
  fetchDetail: () => Promise<ScheduledConversationFetchResult>,
  fetchFallback: (item: ConversationListItem) => Promise<ScheduledConversationFetchResult>,
  signal?: AbortSignal
): Promise<ScheduledConversationResolution> {
  let directResult: ScheduledConversationFetchResult
  try {
    throwIfExportCancelled(signal)
    directResult = await fetchDetail()
    throwIfExportCancelled(signal)
  } catch (error) {
    if (isExportCancelledError(error)) throw error
    directResult = { error: 'detail request failed' }
  }

  const directConversation = directResult.data ?? null
  if (hasUsableConversation(directConversation, item.id)) {
    return { conversation: directConversation, fallbackRecovered: false }
  }

  const directFailureReason = directConversation
    ? 'detail_incomplete'
    : isAuthenticationRequiredError(directResult.error)
      ? 'auth_required'
      : isProviderRateLimitError(directResult.error)
        ? 'rate_limited'
        : 'detail_unavailable'

  if (directFailureReason === 'auth_required') {
    return {
      conversation: null,
      directFailureReason,
      fallbackRecovered: false,
      failureReason: 'authentication_required',
    }
  }

  let fallbackResult: ScheduledConversationFetchResult
  try {
    throwIfExportCancelled(signal)
    fallbackResult = await fetchFallback(item)
    throwIfExportCancelled(signal)
  } catch (error) {
    if (isExportCancelledError(error)) throw error
    fallbackResult = { error: 'page fallback failed' }
  }

  const fallbackConversation = fallbackResult.data ?? null
  if (hasUsableConversation(fallbackConversation, item.id)) {
    return {
      conversation: fallbackConversation,
      directFailureReason,
      fallbackRecovered: true,
    }
  }

  return {
    conversation: null,
    directFailureReason,
    fallbackRecovered: false,
    failureReason: directFailureReason === 'rate_limited'
      ? 'rate_limited'
      : fallbackConversation ? 'fallback_incomplete' : 'fallback_unavailable',
  }
}

/** Keep last-run diagnostics useful without persisting titles, IDs, or chat text. */
export function recordScheduledFailure(
  status: ScheduledExportStatus,
  reason: ScheduledExportFailureReason
): void {
  status.lastRunFailureBreakdown = {
    ...status.lastRunFailureBreakdown,
    [reason]: (status.lastRunFailureBreakdown?.[reason] ?? 0) + 1,
  }
}

/**
 * Keep a provider-level rate-limit signal separate from failed-file counts.
 * A page fallback may still recover the current conversation, but the user
 * should know why this platform intentionally stopped starting new API reads.
 */
export function recordScheduledRateLimit(
  status: ScheduledExportStatus,
  platform: ExportablePlatform
): void {
  const platforms = status.lastRunRateLimitedPlatforms ?? (status.lastRunRateLimitedPlatforms = [])
  if (!platforms.includes(platform)) platforms.push(platform)
}

/**
 * Keep browser download failures distinguishable from errors that happen while
 * preparing the export. Browser error messages are intentionally not persisted:
 * they can include URL or filename details that are not useful in the UI.
 */
export function classifyScheduledDownloadFailure(error: unknown): ScheduledExportFailureReason {
  const message = error instanceof Error ? error.message : ''
  if (message === 'Download completion timed out') return 'download_timed_out'
  if (/^Download interrupted/.test(message)) return 'download_interrupted'
  return 'download_request_failed'
}

/**
 * Ask the content script for the conversation list, retrying a few times.
 *
 * waitForContentScript() only proves the script answers DETECT_PLATFORM; a
 * provider page can still be hydrating its history when the first list request
 * arrives, and providers whose list comes from the sidebar DOM then return an
 * empty result. A single attempt used to be masked by a fixed post-load delay;
 * retrying is both faster in the common case and more reliable in the slow one.
 *
 * Only empty/absent results are retried. A rate limit, an auth prompt, or an
 * explicit provider error is a real answer and returns immediately.
 */
/** Reply to FETCH_ALL_CONVERSATIONS as relayed by the content-script runtime. */
export interface ScheduledListResponse {
  data?: ConversationListItem[]
  error?: string
  meta?: { authRequired?: boolean; [key: string]: unknown }
}

export async function fetchScheduledConversationList(
  tabId: number,
  signal?: AbortSignal,
  attempts = 3,
  retryDelayMs = 1000,
  sendMessage: (tabId: number, message: unknown) => Promise<ScheduledListResponse | undefined> =
    (id, message) => chrome.tabs.sendMessage(id, message)
): Promise<ScheduledListResponse | undefined> {
  let lastResponse: ScheduledListResponse | undefined
  for (let attempt = 0; attempt < attempts; attempt++) {
    throwIfExportCancelled(signal)
    try {
      lastResponse = await sendMessage(tabId, { type: 'FETCH_ALL_CONVERSATIONS' })
    } catch (error) {
      if (isExportCancelledError(error)) throw error
      lastResponse = undefined
    }

    const settled = lastResponse?.error
      || lastResponse?.meta?.authRequired
      || (Array.isArray(lastResponse?.data) && lastResponse.data.length > 0)
    if (settled) return lastResponse

    if (attempt < attempts - 1) await delay(retryDelayMs, signal)
  }
  return lastResponse
}
