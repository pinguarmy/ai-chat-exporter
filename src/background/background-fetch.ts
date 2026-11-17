/**
 * Conversation detail fetches in inactive provider tabs, plus the tab
 * readiness helpers shared with the scheduled-export runner.
 */
import type { BackgroundConversationDetailRequest } from '../platform/background-messages'
import type { Conversation, ConversationListItem, ExportablePlatform } from '../core/types'
import { hasUsableConversation } from '../core/bulk-conversation'
import { delay, isExportCancelledError, throwIfExportCancelled } from '../core/scheduled-export'
import {
  registerScheduledRunTab,
  releaseScheduledRunResource
} from '../platform/scheduled-run-resources'

/**
 * Conversation detail fetches may need an inactive tab on the provider site.
 * Only ever navigate to an HTTPS URL on a known provider host: the item URL
 * comes from a page context and must not become an arbitrary-navigation
 * primitive if the message surface ever widens.
 */
const PROVIDER_HOSTS = new Set([
  'chatgpt.com',
  'chat.openai.com',
  'claude.ai',
  'deepseek.com',
  'chat.deepseek.com',
  'gemini.google.com',
  'grok.com',
  'www.grok.com'
])

export function isProviderConversationUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || !raw) return false
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && PROVIDER_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

// Foreground bulk export can fall back to an inactive tab when the current
// provider page does not expose the selected conversation. Keep those fetches
// independently abortable so the popup's Stop action also closes the fallback
// tab instead of merely hiding its progress UI.
const foregroundDetailFetchControllers = new Map<string, AbortController>()

/**
 * Parses a selected conversation in its own inactive tab. This is the fallback
 * for providers such as Grok whose content script can only read the currently
 * loaded conversation DOM.
 */
export async function handleFetchConversationDetailInBackgroundTab(
  item: ConversationListItem,
  signal?: AbortSignal,
  scheduledRunId?: string,
  onManualTab?: (id?: number) => Promise<void>
): Promise<{ data?: Conversation; error?: string }> {
  if (!item?.url || !item?.id) {
    return { error: 'Conversation URL is unavailable' }
  }
  if (!isProviderConversationUrl(item.url)) {
    return { error: 'Conversation URL is not a supported provider page' }
  }

  let tabId: number | null = null
  try {
    throwIfExportCancelled(signal)
    const tab = await chrome.tabs.create({ url: item.url, active: false })
    tabId = tab.id ?? null
    if (!tabId) return { error: 'Failed to open the selected conversation' }
    await registerScheduledRunTab(scheduledRunId, tabId)
    await onManualTab?.(tabId)

    await waitForTabComplete(tabId, 30000, signal)
    await waitForContentScript(tabId, item.platform, 10000, signal)

    const deadline = Date.now() + 20000
    while (Date.now() < deadline) {
      throwIfExportCancelled(signal)
      try {
        const response = await chrome.tabs.sendMessage(tabId, { type: 'PARSE_CONVERSATION' })
        const conversation = response?.data as Conversation | null | undefined
        if (hasUsableConversation(conversation, item.id)) {
          return { data: conversation }
        }
      } catch {
        // The page may still be hydrating its messages.
      }
      await delay(750, signal)
    }

    return { error: `No content became available for ${item.title || item.id}` }
  } catch (error) {
    if (isExportCancelledError(error)) throw error
    return {
      error: error instanceof Error ? error.message : 'Failed to load the selected conversation'
    }
  } finally {
    if (tabId) {
      try {
        await chrome.tabs.remove(tabId)
      } catch {
        // The tab may already have been closed.
      }
      await onManualTab?.(undefined)
      if (scheduledRunId) {
        try {
          await releaseScheduledRunResource(scheduledRunId, 'tabIds', tabId)
        } catch {
          // The enclosing scheduled run clears any remaining resource record.
        }
      }
    }
  }
}

/**
 * Bridge a popup cancellation token into a background-tab fallback. Scheduled
 * jobs call the underlying function directly with their own AbortSignal.
 */
export async function handleForegroundConversationDetailRequest(
  request: ConversationListItem | BackgroundConversationDetailRequest
): Promise<{ data?: Conversation; error?: string }> {
  const wrapped = request as BackgroundConversationDetailRequest
  const item = wrapped.item ?? (request as ConversationListItem)
  const requestId = typeof wrapped.requestId === 'string' ? wrapped.requestId : undefined
  if (!requestId) return handleFetchConversationDetailInBackgroundTab(item)

  // A duplicate id should never occur from the popup, but abort the older
  // request defensively rather than leaving a hidden tab behind.
  foregroundDetailFetchControllers.get(requestId)?.abort()
  const controller = new AbortController()
  foregroundDetailFetchControllers.set(requestId, controller)
  try {
    return await handleFetchConversationDetailInBackgroundTab(item, controller.signal)
  } finally {
    if (foregroundDetailFetchControllers.get(requestId) === controller) {
      foregroundDetailFetchControllers.delete(requestId)
    }
  }
}

export async function handleCancelForegroundConversationDetailRequest(
  requestId?: string
): Promise<{ data: boolean }> {
  if (!requestId) return { data: false }
  const controller = foregroundDetailFetchControllers.get(requestId)
  if (!controller) return { data: false }
  controller.abort()
  return { data: true }
}

/** Wait for a tab to finish loading */
export function waitForTabComplete(
  tabId: number,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => finish(new Error('Tab load timeout')), timeoutMs)

    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      chrome.tabs.onUpdated.removeListener(listener)
    }

    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      // No fixed settle delay here: waitForContentScript right after this
      // already polls until the page's content script answers, which is the
      // actual readiness signal the callers need.
      else resolve()
    }

    const onAbort = () => finish(new Error('Export cancelled'))

    function listener(updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        finish()
      }
    }

    chrome.tabs.onUpdated.addListener(listener)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }

    // Check if already loaded
    chrome.tabs
      .get(tabId)
      .then(tab => {
        if (tab.status === 'complete') {
          finish()
        }
      })
      .catch(() => {
        // Tab might not exist yet — that's fine, the listener will catch it
      })
  })
}

/** Wait for content script to be injectable and responsive */
export async function waitForContentScript(
  tabId: number,
  platform: ExportablePlatform,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<void> {
  const startTime = Date.now()
  while (Date.now() - startTime < timeoutMs) {
    throwIfExportCancelled(signal)
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'DETECT_PLATFORM' })
      if (response?.data?.platform === platform) return
    } catch {
      // Content script not ready yet
    }
    await delay(1000, signal)
  }
  throw new Error(`Content script not ready on ${platform} after ${timeoutMs}ms`)
}
