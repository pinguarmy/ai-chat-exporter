/**
 * Background Service Worker
 * Handles messages between popup and content scripts
 * Also handles scheduled auto-export
 */
import type {
  MessagePayload,
  Conversation,
  ExtensionSettings,
  BulkExportProgress,
  ScheduledExportSettings,
  ScheduledExportStatus,
  ExportablePlatform,
  ExportedConversationRecord,
  ConversationListItem,
  ExportOptions,
} from './lib/types'
import { DEFAULT_SETTINGS } from './lib/types'
import { conversationToMarkdown } from './lib/export-markdown'
import { generateFilename } from './lib/filename'
import { buildDownloadFilename } from './lib/download-path'
import { textToDataUrl } from './lib/download-url'
import { hasUsableConversation } from './lib/bulk-conversation'
import {
  getDefaultScheduledExportSettings,
  isDueForRun,
  delay,
  PLATFORM_URLS,
  ALL_PLATFORMS,
} from './lib/scheduled-export'

// Default settings
const _DEFAULT_SETTINGS: ExtensionSettings = DEFAULT_SETTINGS

// Listen for extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Set default settings on first install
    chrome.storage.local.set({ settings: DEFAULT_SETTINGS })
    // Create the scheduled export checker alarm (every 15 minutes)
    chrome.alarms.create('scheduled-export-check', { periodInMinutes: 15 })
    chrome.alarms.create('cleanup-exports', { periodInMinutes: 60 })
  }
})

// Ensure alarm exists on startup (in case it was cleared)
chrome.alarms.get('scheduled-export-check', (alarm) => {
  if (!alarm) {
    chrome.alarms.create('scheduled-export-check', { periodInMinutes: 15 })
  }
})

// Conversation snapshots are only needed briefly for the preview page. Keep
// their expiry alarm alive across extension restarts and upgrades.
chrome.alarms.get('cleanup-exports', (alarm) => {
  if (!alarm) {
    chrome.alarms.create('cleanup-exports', { periodInMinutes: 60 })
  }
})

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener(
  (message: MessagePayload, sender, sendResponse) => {
    handleMessage(message, sender)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ error: error.message }))
    
    return true // Keep message channel open for async response
  }
)

/**
 * Handle incoming messages
 */
async function handleMessage(
  message: MessagePayload,
  sender: chrome.runtime.MessageSender
): Promise<{ data?: unknown; error?: string }> {
  switch (message.type) {
    case 'GET_SETTINGS':
      return handleGetSettings()
    
    case 'SETTINGS_UPDATED':
      return handleSettingsUpdated(message.data as ExtensionSettings)
    
    case 'EXPORT_REQUEST':
      return handleExportRequest(message.data as { conversation: Conversation; format: string }, sender)
    
    case 'DETECT_PLATFORM':
      return handleDetectPlatform(sender)
    
    case 'FETCH_CONVERSATION_LIST':
      return handleFetchConversationList(sender)

    case 'FETCH_ALL_CONVERSATIONS':
      return handleFetchAllConversations(sender)

    case 'FETCH_CONVERSATION_DETAIL_IN_BACKGROUND_TAB':
      return handleFetchConversationDetailInBackgroundTab(message.data as ConversationListItem)

    case 'SCHEDULED_EXPORT_RUN':
      return handleScheduledExportRun()
    
    case 'SCHEDULED_EXPORT_STATUS':
      return handleScheduledExportStatus()
    
    case 'SCHEDULED_EXPORT_CONFIG':
      return handleScheduledExportConfig(message.data as Partial<ScheduledExportSettings> | undefined)
    
    case 'SCHEDULED_EXPORT_CLEAR_HISTORY':
      return handleClearExportHistory()

    default:
      return { error: `Unknown message type: ${message.type}` }
  }
}

/**
 * Get extension settings
 */
async function handleGetSettings(): Promise<{ data: ExtensionSettings }> {
  try {
    const result = await chrome.storage.local.get('settings')
    // Merge with defaults for any new fields
    return { data: { ...DEFAULT_SETTINGS, ...(result.settings || {}) } }
  } catch (error) {
    return { data: DEFAULT_SETTINGS }
  }
}

/**
 * Handle settings update
 */
async function handleSettingsUpdated(
  settings: ExtensionSettings
): Promise<{ data: boolean }> {
  try {
    await chrome.storage.local.set({ settings })
    return { data: true }
  } catch (error) {
    return { data: false }
  }
}

/**
 * Handle export request from popup
 */
async function handleExportRequest(
  data: { conversation: Conversation; format: string },
  sender: chrome.runtime.MessageSender
): Promise<{ data?: string; error?: string }> {
  try {
    if (!data.conversation) {
      return { error: 'No conversation data provided' }
    }
    
    const conversationId = data.conversation.id
    await chrome.storage.local.set({
      [`export-${conversationId}`]: { ...data.conversation, timestamp: Date.now() }
    })

    // Track this export so bulk export won't re-download it
    await markAsExported({
      id: conversationId,
      platform: data.conversation.platform,
      title: data.conversation.title,
      exportedAt: Date.now(),
      filename: '',
    })
    
    return { data: conversationId }
  } catch (error) {
    return { error: 'Failed to process export request' }
  }
}

/**
 * Detect platform from sender tab
 */
async function handleDetectPlatform(
  sender: chrome.runtime.MessageSender
): Promise<{ data?: { platform: string; url: string }; error?: string }> {
  try {
    if (!sender.tab?.url) {
      return { error: 'No tab URL available' }
    }
    
    const url = new URL(sender.tab.url)
    let platform = 'unknown'
    
    if (url.hostname === 'chatgpt.com' || url.hostname === 'chat.openai.com') {
      platform = 'chatgpt'
    } else if (url.hostname === 'gemini.google.com') {
      platform = 'gemini'
    } else if (url.hostname === 'claude.ai') {
      platform = 'claude'
    } else if (url.hostname === 'deepseek.com' || url.hostname === 'chat.deepseek.com') {
      platform = 'deepseek'
    } else if (url.hostname === 'grok.com' || url.hostname === 'www.grok.com') {
      platform = 'grok'
    }
    
    return {
      data: {
        platform,
        url: sender.tab.url
      }
    }
  } catch (error) {
    return { error: 'Failed to detect platform' }
  }
}

/**
 * Handle fetching conversation list from content script (DOM-based)
 */
async function handleFetchConversationList(
  sender: chrome.runtime.MessageSender
): Promise<{ data?: unknown[]; error?: string }> {
  try {
    if (!sender.tab?.id) {
      return { error: 'No tab ID available' }
    }
    
    const response = await chrome.tabs.sendMessage(sender.tab.id, {
      type: 'FETCH_CONVERSATION_LIST'
    })
    
    return response
  } catch (error) {
    return { error: 'Failed to fetch conversation list' }
  }
}

/**
 * Handle fetching ALL conversations via API (forwarded to content script)
 */
async function handleFetchAllConversations(
  sender: chrome.runtime.MessageSender
): Promise<{ data?: unknown[]; error?: string }> {
  try {
    if (!sender.tab?.id) {
      return { error: 'No tab ID available' }
    }
    
    const response = await chrome.tabs.sendMessage(sender.tab.id, {
      type: 'FETCH_ALL_CONVERSATIONS'
    })
    
    return response
  } catch (error) {
    return { error: 'Failed to fetch all conversations' }
  }
}

/**
 * Parses a selected conversation in its own inactive tab. This is the fallback
 * for providers such as Grok whose content script can only read the currently
 * loaded conversation DOM.
 */
async function handleFetchConversationDetailInBackgroundTab(
  item: ConversationListItem
): Promise<{ data?: Conversation; error?: string }> {
  if (!item?.url || !item?.id) {
    return { error: 'Conversation URL is unavailable' }
  }

  let tabId: number | null = null
  try {
    const tab = await chrome.tabs.create({ url: item.url, active: false })
    tabId = tab.id ?? null
    if (!tabId) return { error: 'Failed to open the selected conversation' }

    await waitForTabComplete(tabId, 30000)
    await waitForContentScript(tabId, item.platform, 10000)

    const deadline = Date.now() + 20000
    while (Date.now() < deadline) {
      try {
        const response = await chrome.tabs.sendMessage(tabId, { type: 'PARSE_CONVERSATION' })
        const conversation = response?.data as Conversation | null | undefined
        if (hasUsableConversation(conversation, item.id)) {
          return { data: conversation }
        }
      } catch {
        // The page may still be hydrating its messages.
      }
      await delay(750)
    }

    return { error: `No content became available for ${item.title || item.id}` }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to load the selected conversation' }
  } finally {
    if (tabId) {
      try {
        await chrome.tabs.remove(tabId)
      } catch {
        // The tab may already have been closed.
      }
    }
  }
}

// ──────────────────────────────────────────────────────────────────
// Scheduled Export: Configuration & Status Management
// ──────────────────────────────────────────────────────────────────

/**
 * Get scheduled export settings with defaults
 */
async function getScheduledExportSettings(): Promise<ScheduledExportSettings> {
  try {
    const result = await chrome.storage.local.get('settings')
    const settings = result.settings || DEFAULT_SETTINGS
    return (settings as ExtensionSettings).scheduledExport || getDefaultScheduledExportSettings()
  } catch {
    return getDefaultScheduledExportSettings()
  }
}

/**
 * Handle manual scheduled export run request
 */
async function handleScheduledExportRun(): Promise<{ data?: boolean; error?: string }> {
  try {
    // Prevent running if already running
    const statusResult = await chrome.storage.local.get('scheduledExportStatus')
    const currentStatus = statusResult.scheduledExportStatus as ScheduledExportStatus | undefined
    if (currentStatus?.isRunning) {
      return { error: 'Scheduled export already running' }
    }

    // A user-triggered run must not be held back by the next scheduled due
    // time (or by the global schedule toggle).
    void checkAndRunScheduledExports(true)
    return { data: true }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

/**
 * Handle status query
 */
async function handleScheduledExportStatus(): Promise<{ data?: ScheduledExportStatus; error?: string }> {
  try {
    const result = await chrome.storage.local.get('scheduledExportStatus')
    return { data: result.scheduledExportStatus || null }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

/**
 * Handle config update
 */
async function handleScheduledExportConfig(
  partial?: Partial<ScheduledExportSettings>
): Promise<{ data?: ScheduledExportSettings; error?: string }> {
  try {
    const current = await getScheduledExportSettings()
    const updated = { ...current, ...partial } as ScheduledExportSettings

    // Also update the parent settings object
    const settingsResult = await chrome.storage.local.get('settings')
    const parentSettings = { ...DEFAULT_SETTINGS, ...(settingsResult.settings || {}) } as ExtensionSettings
    parentSettings.scheduledExport = updated
    await chrome.storage.local.set({ settings: parentSettings })

    // Update alarms if enabled/disabled
    if (updated.enabled) {
      chrome.alarms.create('scheduled-export-check', { periodInMinutes: 15 })
    }

    return { data: updated }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

/**
 * Handle clearing export history
 */
async function handleClearExportHistory(): Promise<{ data?: boolean; error?: string }> {
  try {
    await clearExportedHistory()
    return { data: true }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

// ──────────────────────────────────────────────────────────────────
// Scheduled Export: Alarm Handler & Core Logic
// ──────────────────────────────────────────────────────────────────

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'scheduled-export-check') {
    await checkAndRunScheduledExports()
  }
  if (alarm.name !== 'cleanup-exports') return
  try {
    const items = await chrome.storage.local.get(null) as unknown as Record<string, unknown>
    const now = Date.now()
    
    for (const [key, value] of Object.entries(items)) {
      if ((key.startsWith('export-') || key.startsWith('conversation-')) && typeof value === 'object' && value !== null) {
        const data = value as { timestamp?: number }
        if (data.timestamp && now - data.timestamp > 3600000) {
          await chrome.storage.local.remove(key)
        }
      }
    }
  } catch (error) {
    // Silently handle cleanup errors
  }
})

/**
 * Main entry: check all platforms and run scheduled exports as needed
 */
async function checkAndRunScheduledExports(force = false): Promise<void> {
  const config = await getScheduledExportSettings()
  if (!config.enabled && !force) return

  // Prevent concurrent runs
  const statusResult = await chrome.storage.local.get('scheduledExportStatus')
  const currentStatus = statusResult.scheduledExportStatus as ScheduledExportStatus | undefined
  if (currentStatus?.isRunning) return

  const now = Date.now()
  let remainingBudget = config.maxTotalPerRun

  for (const platform of ALL_PLATFORMS) {
    if (remainingBudget <= 0) break
    const platformConfig = config.platforms[platform]
    if (!platformConfig?.enabled) continue

    const lastRunKey = `scheduledExport-lastRun-${platform}`
    const result = await chrome.storage.local.get(lastRunKey)
    const lastRun = (result[lastRunKey] as number) || 0

    if (force || isDueForRun(platformConfig.frequency, lastRun, now)) {
      const runResult = await runScheduledExportForPlatform(platform, config, remainingBudget)
      remainingBudget -= runResult.processed
      // Do not postpone the next automatic retry after a platform-level
      // failure such as an expired login or a network outage.
      if (runResult.succeeded) {
        await chrome.storage.local.set({ [lastRunKey]: now })
      }
    }
  }
}

// ──────────────────────────────────────────────────────────────────
// Scheduled Export: Tab Management
// ──────────────────────────────────────────────────────────────────

/** Wait for a tab to finish loading */
function waitForTabComplete(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      reject(new Error('Tab load timeout'))
    }, timeoutMs)

    function listener(updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer)
        chrome.tabs.onUpdated.removeListener(listener)
        // Extra delay for SPA hydration
        setTimeout(resolve, 3000)
      }
    }

    chrome.tabs.onUpdated.addListener(listener)

    // Check if already loaded
    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === 'complete') {
        clearTimeout(timer)
        chrome.tabs.onUpdated.removeListener(listener)
        setTimeout(resolve, 3000)
      }
    }).catch(() => {
      // Tab might not exist yet — that's fine, the listener will catch it
    })
  })
}

/** Wait for content script to be injectable and responsive */
async function waitForContentScript(
  tabId: number,
  platform: ExportablePlatform,
  timeoutMs: number
): Promise<void> {
  const startTime = Date.now()
  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'DETECT_PLATFORM' })
      if (response?.data?.platform === platform) return
    } catch {
      // Content script not ready yet
    }
    await delay(1000)
  }
  throw new Error(`Content script not ready on ${platform} after ${timeoutMs}ms`)
}

// ──────────────────────────────────────────────────────────────────
// Scheduled Export: Export Dedup Tracking
// ──────────────────────────────────────────────────────────────────

/** Get set of already-exported conversation IDs for a platform */
async function getExportedIds(platform: ExportablePlatform): Promise<Set<string>> {
  const key = `exportedIds-${platform}`
  const result = await chrome.storage.local.get(key)
  const ids: string[] = result[key] || []
  return new Set(ids)
}

/** Mark a conversation as exported */
async function markAsExported(record: ExportedConversationRecord): Promise<void> {
  const key = `exportedIds-${record.platform}`
  const statusKey = `exportedRecord-${record.platform}-${record.id}`

  // Add ID to the exported IDs list
  const result = await chrome.storage.local.get(key)
  const ids: string[] = result[key] || []
  if (!ids.includes(record.id)) {
    ids.push(record.id)
    // Keep only last 500 IDs per platform to prevent unbounded growth
    const evictedIds = ids.length > 500 ? ids.splice(0, ids.length - 500) : []
    await chrome.storage.local.set({ [key]: ids })
    if (evictedIds.length > 0) {
      await chrome.storage.local.remove(
        evictedIds.map(id => `exportedRecord-${record.platform}-${id}`)
      )
    }
  }

  // Store the full record for status/history display
  await chrome.storage.local.set({ [statusKey]: record })
}

/** Clear all exported history for a platform (or all platforms) */
async function clearExportedHistory(platform?: ExportablePlatform): Promise<void> {
  const platforms = platform
    ? [platform]
    : ALL_PLATFORMS
  const stored = await chrome.storage.local.get(null) as unknown as Record<string, unknown>
  for (const p of platforms) {
    const recordPrefix = `exportedRecord-${p}-`
    const recordKeys = Object.keys(stored).filter(key => key.startsWith(recordPrefix))
    await chrome.storage.local.remove([`exportedIds-${p}`, ...recordKeys])
  }
}

// ──────────────────────────────────────────────────────────────────
// Scheduled Export: Platform Export Runner
// ──────────────────────────────────────────────────────────────────

/**
 * Run scheduled export for a single platform
 */
interface ScheduledExportRunResult {
  processed: number
  succeeded: boolean
}

async function runScheduledExportForPlatform(
  platform: ExportablePlatform,
  config: ScheduledExportSettings,
  remainingBudget: number
): Promise<ScheduledExportRunResult> {
  // Update status: starting
  const status: ScheduledExportStatus = {
    lastRunAt: Date.now(),
    isRunning: true,
    currentPlatform: platform,
    lastRunExported: 0,
    lastRunFailed: 0,
  }
  await chrome.storage.local.set({ scheduledExportStatus: status })

  let tabId: number | null = null
  let exported = 0
  let failed = 0

  try {
    // 1. Open a tab to the platform
    const tab = await chrome.tabs.create({
      url: PLATFORM_URLS[platform],
      active: false, // background tab
    })
    tabId = tab.id ?? null

    if (!tabId) throw new Error('Failed to create tab')

    // 2. Wait for the tab to finish loading
    await waitForTabComplete(tabId, 30000) // 30s timeout

    // 3. Wait for content script to be ready
    await waitForContentScript(tabId, platform, 10000)

    // 4. Fetch conversation list
    const listResponse = await chrome.tabs.sendMessage(tabId, {
      type: 'FETCH_ALL_CONVERSATIONS',
    })

    if (!listResponse?.data) {
      throw new Error(`Failed to fetch conversations from ${platform}`)
    }

    const allConversations: ConversationListItem[] = listResponse.data

    // 5. Filter out already-exported conversations
    const exportedIds = await getExportedIds(platform)
    const newConversations = allConversations.filter(c => !exportedIds.has(c.id))

    // 6. Limit to max per run
    const platformConfig = config.platforms[platform]
    const toExport = newConversations.slice(0, Math.min(platformConfig.maxPerRun, remainingBudget))

    // 7. Export each conversation
    for (const convItem of toExport) {
      try {
        // Check total limit
        if (exported + failed >= remainingBudget) break

        // Fetch full conversation detail
        const detailResponse = await chrome.tabs.sendMessage(tabId, {
          type: 'FETCH_CONVERSATION_DETAIL',
          data: { id: convItem.id, title: convItem.title },
        })

        const conversation: Conversation | null = detailResponse?.data || null
        if (!conversation || conversation.messages.length === 0) {
          failed++
          continue
        }

        // Rate limiting delay between requests
        await delay(config.requestDelayMs)

        // Export as markdown
        const exportOptions: ExportOptions = {
          format: 'markdown',
          includeMetadata: true,
          includeCodeBlocks: true,
          includeImages: true,
        }

        const markdown = conversationToMarkdown(conversation, exportOptions)
        const baseFilename = generateFilename(
          '{date}-{platform}-{title}',
          conversation
        )
        const filename = buildDownloadFilename(
          baseFilename,
          platform,
          '.md',
          'by-platform', // organized by platform folder
          ''
        )

        // Download
        const url = textToDataUrl(markdown, 'text/markdown')

        await chrome.downloads.download({ url, filename, saveAs: false })

        // Track exported conversation
        await markAsExported({
          id: convItem.id,
          platform,
          title: convItem.title,
          exportedAt: Date.now(),
          filename,
        })

        exported++
      } catch (err) {
        console.error(`[Scheduled Export] Failed to export ${convItem.id}:`, err)
        failed++
      }
    }

    // 8. Update status
    status.lastRunFinishedAt = Date.now()
    status.isRunning = false
    status.lastRunExported = exported
    status.lastRunFailed = failed
    await chrome.storage.local.set({ scheduledExportStatus: status })
    return { processed: exported + failed, succeeded: true }

  } catch (err) {
    console.error(`[Scheduled Export] Platform ${platform} failed:`, err)
    status.lastRunFinishedAt = Date.now()
    status.isRunning = false
    status.lastRunError = (err as Error).message
    await chrome.storage.local.set({ scheduledExportStatus: status })
    return { processed: exported + failed, succeeded: false }
  } finally {
    // 9. Close the tab
    if (tabId && config.closeTabAfterExport) {
      try {
        await chrome.tabs.remove(tabId)
      } catch {
        // Tab might already be closed
      }
    }
  }
}
