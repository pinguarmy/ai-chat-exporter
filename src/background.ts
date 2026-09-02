/**
 * Background Service Worker
 * Handles messages between popup and content scripts
 * Also handles scheduled auto-export
 */
import type {
  MessagePayload,
  Conversation,
  ExtensionSettings,
  ScheduledExportSettings,
  ScheduledExportStatus,
  ScheduledExportPlatformState,
  ExportablePlatform,
  ExportedConversationRecord,
  ConversationListItem,
  ExportOptions,
  ScheduledExportFailureReason,
} from './lib/types'
import { DEFAULT_SETTINGS, mergeExtensionSettings } from './lib/types'
import { conversationToMarkdown } from './lib/export-markdown'
import { generateFilename } from './lib/filename'
import { buildDownloadFilename } from './lib/download-path'
import { textToDataUrl } from './lib/download-url'
import { hasUsableConversation } from './lib/bulk-conversation'
import { downloadAndWait } from './lib/download-completion'
import { isConversationComplete } from './lib/conversation-integrity'
import {
  getDefaultScheduledExportSettings,
  clampScheduledCheckIntervalMinutes,
  clampScheduledIntervalMinutes,
  isDueForSchedule,
  delay,
  PLATFORM_URLS,
  ALL_PLATFORMS,
  shouldAdvanceScheduledLastRun,
  isScheduledConversationListComplete,
  ScheduledRunBudget,
  mergeScheduledExportSettings,
  runWithConcurrency,
  ScheduledConcurrencyGate,
  ScheduledRequestPacer,
  throwIfExportCancelled,
  isExportCancelledError,
  EXPORT_CANCELLED_MESSAGE,
  isAuthenticationRequiredError,
  isLikelyProviderLoginUrl,
} from './lib/scheduled-export'
import { isProviderRateLimitError } from './lib/provider-rate-limit'
import { cleanupExpiredPreviewSnapshots } from './lib/preview-snapshots'

// A module-level single-flight guard closes the async gap between checking
// storage and setting the per-platform status. The storage status remains the
// restart-visible diagnostic; this guard prevents duplicate runs in one
// service-worker lifetime.
let scheduledRunPromise: Promise<void> | null = null
let scheduledRunController: AbortController | null = null

// Manifest V3 can suspend and recreate this service worker at any time. Keep
// the resources that belong to a scheduled run in extension storage so Stop
// still has something concrete to cancel after a restart, rather than relying
// only on the AbortController above.
export const SCHEDULED_ACTIVE_RUN_KEY = 'scheduledExport-activeRun'
export const SCHEDULED_STOP_REQUEST_KEY = 'scheduledExport-stopRequest'

interface PersistedScheduledRun {
  id: string
  startedAt: number
  tabIds: number[]
  downloadIds: number[]
  stopRequestedAt?: number
}

interface PersistedScheduledStopRequest {
  runId: string
  requestedAt: number
}

let scheduledRunStateWrites: Promise<void> = Promise.resolve()
let scheduledRunStopRequestedId: string | null = null

function createScheduledRunId(): string {
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
  return `scheduled-${Date.now()}-${randomId}`
}

function readResourceIds(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is number => Number.isSafeInteger(item) && item >= 0))]
}

function readPersistedScheduledRun(value: unknown): PersistedScheduledRun | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<PersistedScheduledRun>
  if (typeof candidate.id !== 'string' || !candidate.id || !Number.isFinite(candidate.startedAt)) return null
  return {
    id: candidate.id,
    startedAt: candidate.startedAt,
    tabIds: readResourceIds(candidate.tabIds),
    downloadIds: readResourceIds(candidate.downloadIds),
    stopRequestedAt: Number.isFinite(candidate.stopRequestedAt) ? candidate.stopRequestedAt : undefined,
  }
}

function readPersistedStopRequest(value: unknown): PersistedScheduledStopRequest | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<PersistedScheduledStopRequest>
  if (typeof candidate.runId !== 'string' || !candidate.runId || !Number.isFinite(candidate.requestedAt)) {
    return null
  }
  return { runId: candidate.runId, requestedAt: candidate.requestedAt }
}

/** Serialize resource-list updates from parallel provider workers. */
async function updatePersistedScheduledRun(
  runId: string,
  mutate: (run: PersistedScheduledRun) => void,
  allowStopped = false
): Promise<boolean> {
  let updated = false
  const write = scheduledRunStateWrites
    .catch(() => undefined)
    .then(async () => {
      const stored = await chrome.storage.local.get(SCHEDULED_ACTIVE_RUN_KEY)
      const run = readPersistedScheduledRun(stored[SCHEDULED_ACTIVE_RUN_KEY])
      if (!run || run.id !== runId || (!allowStopped && run.stopRequestedAt)) return
      mutate(run)
      await chrome.storage.local.set({ [SCHEDULED_ACTIVE_RUN_KEY]: run })
      updated = true
    })
  scheduledRunStateWrites = write.catch(() => undefined)
  await write
  return updated
}

async function registerScheduledRunResource(
  runId: string,
  resource: 'tabIds' | 'downloadIds',
  id: number
): Promise<boolean> {
  return updatePersistedScheduledRun(runId, run => {
    if (!run[resource].includes(id)) run[resource].push(id)
  })
}

async function releaseScheduledRunResource(
  runId: string,
  resource: 'tabIds' | 'downloadIds',
  id: number
): Promise<void> {
  await updatePersistedScheduledRun(runId, run => {
    run[resource] = run[resource].filter(item => item !== id)
  }, true)
}

async function registerScheduledRunTab(runId: string | undefined, tabId: number): Promise<void> {
  if (!runId) return
  try {
    if (await registerScheduledRunResource(runId, 'tabIds', tabId)) return
  } catch (error) {
    try { await chrome.tabs.remove(tabId) } catch {}
    throw error
  }
  try { await chrome.tabs.remove(tabId) } catch {}
  throw new Error(EXPORT_CANCELLED_MESSAGE)
}

async function registerScheduledRunDownload(runId: string | undefined, downloadId: number): Promise<void> {
  if (!runId) return
  try {
    if (await registerScheduledRunResource(runId, 'downloadIds', downloadId)) return
  } catch (error) {
    try { await chrome.downloads.cancel(downloadId) } catch {}
    throw error
  }
  try { await chrome.downloads.cancel(downloadId) } catch {}
  throw new Error(EXPORT_CANCELLED_MESSAGE)
}

async function beginPersistedScheduledRun(runId: string): Promise<void> {
  // If the worker was restarted mid-run, its JavaScript queue is already gone
  // but a browser tab or download can still exist. Close those leftovers
  // before replacing the record with a fresh run.
  const existing = await chrome.storage.local.get(SCHEDULED_ACTIVE_RUN_KEY)
  const staleRun = readPersistedScheduledRun(existing[SCHEDULED_ACTIVE_RUN_KEY])
  if (staleRun) await cancelPersistedScheduledRunResources(staleRun)
  await chrome.storage.local.set({
    [SCHEDULED_ACTIVE_RUN_KEY]: {
      id: runId,
      startedAt: Date.now(),
      tabIds: [],
      downloadIds: [],
    } satisfies PersistedScheduledRun,
    [SCHEDULED_STOP_REQUEST_KEY]: null,
  })
}

async function clearPersistedScheduledRun(runId: string): Promise<void> {
  await scheduledRunStateWrites.catch(() => undefined)
  const stored = await chrome.storage.local.get([
    SCHEDULED_ACTIVE_RUN_KEY,
    SCHEDULED_STOP_REQUEST_KEY,
  ])
  const run = readPersistedScheduledRun(stored[SCHEDULED_ACTIVE_RUN_KEY])
  const stopRequest = readPersistedStopRequest(stored[SCHEDULED_STOP_REQUEST_KEY])
  const keys: string[] = []
  if (run?.id === runId) keys.push(SCHEDULED_ACTIVE_RUN_KEY)
  if (stopRequest?.runId === runId) keys.push(SCHEDULED_STOP_REQUEST_KEY)
  if (keys.length > 0) await chrome.storage.local.remove(keys)
}

function watchPersistedScheduledStop(runId: string, controller: AbortController): () => void {
  const onChanged = chrome.storage?.onChanged
  if (!onChanged?.addListener) return () => undefined
  const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== 'local') return
    const request = readPersistedStopRequest(changes[SCHEDULED_STOP_REQUEST_KEY]?.newValue)
    if (request?.runId === runId) {
      scheduledRunStopRequestedId = runId
      controller.abort()
    }
  }
  onChanged.addListener(listener)
  return () => onChanged.removeListener(listener)
}

function stoppedScheduledStatus(status: ScheduledExportStatus, finishedAt = Date.now()): ScheduledExportStatus {
  return {
    ...status,
    isRunning: false,
    currentPlatform: undefined,
    activePlatforms: [],
    lastRunCancelled: true,
    stopRequested: false,
    lastRunFinishedAt: finishedAt,
  }
}

async function cancelPersistedScheduledRunResources(run: PersistedScheduledRun): Promise<void> {
  await Promise.all([
    ...run.downloadIds.map(id => Promise.resolve(chrome.downloads.cancel(id)).catch(() => undefined)),
    ...run.tabIds.map(id => Promise.resolve(chrome.tabs.remove(id)).catch(() => undefined)),
  ])
}

// Foreground bulk export can fall back to an inactive tab when the current
// provider page does not expose the selected conversation. Keep those fetches
// independently abortable so the popup's Stop action also closes the fallback
// tab instead of merely hiding its progress UI.
const foregroundDetailFetchControllers = new Map<string, AbortController>()

const SCHEDULED_EXPORT_ALARM_NAME = 'scheduled-export-check'
/**
 * Chrome alarms are only the wake-up mechanism; each platform still decides
 * whether it is due from its own last-run checkpoint. The global cadence is
 * user-configurable; a shorter enabled platform interval still wins so its
 * configured due time is never postponed by the wake-up cadence.
 */
export function getScheduledExportAlarmPeriodMinutes(
  config: Pick<ScheduledExportSettings, 'platforms'> & Partial<Pick<ScheduledExportSettings, 'checkIntervalMinutes'>>,
): number {
  const configuredInterval = clampScheduledCheckIntervalMinutes(config.checkIntervalMinutes)
  const customIntervals = ALL_PLATFORMS
    .map(platform => config.platforms[platform])
    .filter(platform => platform?.enabled && platform.frequency === 'custom')
    .map(platform => clampScheduledIntervalMinutes(platform?.intervalMinutes))

  return Math.max(
    1,
    Math.min(configuredInterval, ...customIntervals),
  )
}

async function syncScheduledExportAlarm(): Promise<void> {
  try {
    const config = await getScheduledExportSettings()
    if (!config.enabled) {
      await chrome.alarms.clear(SCHEDULED_EXPORT_ALARM_NAME)
      return
    }
    const targetPeriod = getScheduledExportAlarmPeriodMinutes(config)
    const existing = await new Promise<chrome.alarms.Alarm | undefined>((resolve) => {
      try {
        chrome.alarms.get(SCHEDULED_EXPORT_ALARM_NAME, alarm => resolve(alarm))
      } catch {
        resolve(undefined)
      }
    })
    if (existing && existing.periodInMinutes === targetPeriod) return
    await chrome.alarms.create(SCHEDULED_EXPORT_ALARM_NAME, {
      periodInMinutes: targetPeriod,
    })
  } catch {
    // Alarm setup is best-effort. The next worker start retries it.
  }
}

// Listen for extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Set default settings on first install
    void chrome.storage.local.set({ settings: DEFAULT_SETTINGS }).then(() => syncScheduledExportAlarm())
    chrome.alarms.create('cleanup-exports', { periodInMinutes: 60 })
  }
})

// Ensure the alarm exists on startup and follows the saved global cadence.
void syncScheduledExportAlarm()

// The options page persists settings directly so every control can autosave.
// React to that storage event as well, otherwise a newly selected interval
// would not change the alarm until the next worker restart.
chrome.storage?.onChanged?.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.settings) void syncScheduledExportAlarm()
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
  'www.grok.com',
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

/**
 * Handle incoming messages
 */
async function handleMessage(
  message: MessagePayload,
  sender: chrome.runtime.MessageSender
): Promise<{ data?: unknown; error?: string }> {
  // Only this extension's own contexts may drive the worker. There is no
  // externally_connectable today, but never rely on the manifest alone.
  if (sender.id !== chrome.runtime.id) {
    return { error: 'Unauthorized message sender' }
  }

  switch (message.type) {
    case 'EXPORT_REQUEST':
      return handleExportRequest(message.data as { conversation: Conversation; format: string; filename?: string }, sender)
    
    case 'FETCH_CONVERSATION_DETAIL_IN_BACKGROUND_TAB':
      return handleForegroundConversationDetailRequest(
        message.data as ConversationListItem | BackgroundConversationDetailRequest
      )

    case 'CANCEL_BACKGROUND_CONVERSATION_FETCH':
      return handleCancelForegroundConversationDetailRequest(
        (message.data as { requestId?: string } | undefined)?.requestId
      )

    case 'SCHEDULED_EXPORT_RUN':
      return handleScheduledExportRun()
    
    case 'SCHEDULED_EXPORT_CLEAR_HISTORY':
      return handleClearExportHistory()

    case 'SCHEDULED_EXPORT_STOP':
      return handleScheduledExportStop()

    case 'GET_EXPORTED_CONVERSATION_IDS':
      return handleGetExportedConversationIds(message.data as ExportablePlatform)

    default:
      return { error: `Unknown message type: ${message.type}` }
  }
}

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

/**
 * Read the current global export policy. Scheduled exports can safely fall
 * back to defaults when storage is temporarily unavailable.
 */
async function getResolvedExtensionSettings(): Promise<ExtensionSettings> {
  try {
    const result = await chrome.storage.local.get('settings')
    return mergeExtensionSettings(result.settings)
  } catch {
    return DEFAULT_SETTINGS
  }
}

/**
 * Handle export request from popup
 */
async function handleExportRequest(
  data: { conversation: Conversation; format: string; filename?: string },
  sender: chrome.runtime.MessageSender
): Promise<{ data?: string; error?: string }> {
  try {
    if (!data.conversation || !isConversationComplete(data.conversation)) {
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
 * Parses a selected conversation in its own inactive tab. This is the fallback
 * for providers such as Grok whose content script can only read the currently
 * loaded conversation DOM.
 */
async function handleFetchConversationDetailInBackgroundTab(
  item: ConversationListItem,
  signal?: AbortSignal,
  scheduledRunId?: string
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
    return { error: error instanceof Error ? error.message : 'Failed to load the selected conversation' }
  } finally {
    if (tabId) {
      try {
        await chrome.tabs.remove(tabId)
      } catch {
        // The tab may already have been closed.
      }
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

interface BackgroundConversationDetailRequest {
  item: ConversationListItem
  requestId?: string
}

/**
 * Bridge a popup cancellation token into a background-tab fallback. Scheduled
 * jobs call the underlying function directly with their own AbortSignal.
 */
async function handleForegroundConversationDetailRequest(
  request: ConversationListItem | BackgroundConversationDetailRequest
): Promise<{ data?: Conversation; error?: string }> {
  const wrapped = request as BackgroundConversationDetailRequest
  const item = wrapped.item ?? request as ConversationListItem
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

async function handleCancelForegroundConversationDetailRequest(
  requestId?: string
): Promise<{ data: boolean }> {
  if (!requestId) return { data: false }
  const controller = foregroundDetailFetchControllers.get(requestId)
  if (!controller) return { data: false }
  controller.abort()
  return { data: true }
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
    const settings = mergeExtensionSettings(result.settings)
    return mergeScheduledExportSettings(settings.scheduledExport)
  } catch {
    return getDefaultScheduledExportSettings()
  }
}

/**
 * Handle manual scheduled export run request
 */
async function handleScheduledExportRun(): Promise<{ data?: boolean; error?: string }> {
  try {
    // A user-triggered run must not be held back by the next scheduled due
    // time (or by the global schedule toggle).
    if (!startScheduledExport(true)) return { error: 'Scheduled export already running' }
    return { data: true }
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

/**
 * Stop the active scheduled queue. The active run and its resource IDs are
 * persisted because a Manifest V3 worker may be recreated between starting a
 * queue and a user pressing Stop.
 */
export async function handleScheduledExportStop(): Promise<{ data?: boolean; error?: string }> {
  const now = Date.now()
  try {
    const stored = await chrome.storage.local.get([
      'scheduledExportStatus',
      SCHEDULED_ACTIVE_RUN_KEY,
    ])
    const status = stored.scheduledExportStatus as ScheduledExportStatus | undefined
    const persistedRun = readPersistedScheduledRun(stored[SCHEDULED_ACTIVE_RUN_KEY])
    const activeRunId = persistedRun?.id ?? status?.runId
    const hasInMemoryRun = Boolean(scheduledRunController && scheduledRunPromise)

    if (activeRunId) {
      scheduledRunStopRequestedId = activeRunId
      const stopUpdate: Record<string, unknown> = {
        [SCHEDULED_STOP_REQUEST_KEY]: { runId: activeRunId, requestedAt: now } satisfies PersistedScheduledStopRequest,
      }
      if (persistedRun) {
        stopUpdate[SCHEDULED_ACTIVE_RUN_KEY] = { ...persistedRun, stopRequestedAt: now }
      }
      await chrome.storage.local.set(stopUpdate)
      if (persistedRun) await cancelPersistedScheduledRunResources(persistedRun)
    }

    scheduledRunController?.abort()

    if (status?.isRunning) {
      await chrome.storage.local.set({
        scheduledExportStatus: hasInMemoryRun
          ? { ...status, lastRunCancelled: true, stopRequested: true }
          : stoppedScheduledStatus(status, now),
      })
    }

    // A controller can be temporarily absent after a worker restart. In that
    // case we still canceled the persisted browser resources and cleared the
    // stale running state above, so the user receives a successful stop.
    return { data: Boolean(activeRunId || hasInMemoryRun || status?.isRunning) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not stop scheduled export' }
  }
}

// ──────────────────────────────────────────────────────────────────
// Scheduled Export: Alarm Handler & Core Logic
// ──────────────────────────────────────────────────────────────────

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SCHEDULED_EXPORT_ALARM_NAME) {
    startScheduledExport(false)
  }
  if (alarm.name !== 'cleanup-exports') return
  try {
    // Read only the indexed preview snapshot keys. Scanning the whole storage
    // area with get(null) would deserialize every cached conversation and
    // credential on each pass just to filter by prefix.
    await cleanupExpiredPreviewSnapshots()
  } catch (error) {
    // Silently handle cleanup errors
  }
})

/**
 * Main entry: check all platforms and run scheduled exports as needed
 */
interface ScheduledStatusReporter {
  status: ScheduledExportStatus
  markProviderActive: (platform: ExportablePlatform) => void
  markProviderInactive: (platform: ExportablePlatform) => void
  markPlatformStatus: (platform: ExportablePlatform, state: ScheduledExportPlatformState) => void
  persist: () => Promise<void>
  flush: () => Promise<void>
}

/**
 * Multiple providers may finish at nearly the same time. Persist status writes
 * in order so one worker cannot overwrite another worker's counts or active
 * platform list.
 */
function createScheduledStatusReporter(status: ScheduledExportStatus): ScheduledStatusReporter {
  let writes = Promise.resolve()

  const snapshot = (): ScheduledExportStatus => ({
    ...status,
    activePlatforms: [...(status.activePlatforms ?? [])],
    lastRunRateLimitedPlatforms: [...(status.lastRunRateLimitedPlatforms ?? [])],
    platformStatuses: status.platformStatuses
      ? Object.fromEntries(
        Object.entries(status.platformStatuses).map(([platform, value]) => [platform, value ? { ...value } : value])
      ) as ScheduledExportStatus['platformStatuses']
      : undefined,
  })

  const persist = () => {
    const next = snapshot()
    writes = writes
      .catch(() => undefined)
      .then(() => chrome.storage.local.set({ scheduledExportStatus: next }))
      .catch(() => undefined)
    return writes
  }

  const syncCurrentPlatform = () => {
    status.currentPlatform = status.activePlatforms?.[0]
  }

  return {
    status,
    markProviderActive(platform) {
      const active = status.activePlatforms ?? (status.activePlatforms = [])
      if (!active.includes(platform)) active.push(platform)
      syncCurrentPlatform()
      void persist()
    },
    markProviderInactive(platform) {
      status.activePlatforms = (status.activePlatforms ?? []).filter(item => item !== platform)
      syncCurrentPlatform()
      void persist()
    },
    markPlatformStatus(platform, state) {
      const statuses = status.platformStatuses ?? (status.platformStatuses = {})
      statuses[platform] = { state, checkedAt: Date.now() }
      void persist()
    },
    persist,
    async flush() {
      await writes
    },
  }
}

async function checkAndRunScheduledExports(
  force = false,
  signal?: AbortSignal,
  runId?: string
): Promise<void> {
  throwIfExportCancelled(signal)
  const config = await getScheduledExportSettings()
  if (!config.enabled && !force) return
  throwIfExportCancelled(signal)

  // Prevent concurrent runs
  const statusResult = await chrome.storage.local.get('scheduledExportStatus')
  const currentStatus = statusResult.scheduledExportStatus as ScheduledExportStatus | undefined
  // startScheduledExport's single-flight guard means this function only runs
  // with a freshly minted runId, so a persisted "running" status with any
  // other runId — including one this dead worker's previous lifetime wrote —
  // belongs to a run whose JS queue no longer exists. Close that stale status
  // before starting a new queue so it cannot make the UI look permanently
  // "running" or block automatic retries for up to two hours.
  if (currentStatus?.isRunning && currentStatus.runId !== runId) {
    await chrome.storage.local.set({
      scheduledExportStatus: stoppedScheduledStatus(currentStatus),
    })
  }

  const now = Date.now()
  const duePlatforms: ExportablePlatform[] = []
  for (const platform of ALL_PLATFORMS) {
    const platformConfig = config.platforms[platform]
    if (!platformConfig?.enabled) continue

    const lastRunKey = `scheduledExport-lastRun-${platform}`
    const result = await chrome.storage.local.get(lastRunKey)
    const lastRun = (result[lastRunKey] as number) || 0

    if (force || isDueForSchedule(platformConfig, lastRun, now)) {
      duePlatforms.push(platform)
    }
  }

  if (duePlatforms.length === 0) return
  throwIfExportCancelled(signal)

  const reporter = createScheduledStatusReporter({
    runId,
    lastRunAt: now,
    isRunning: true,
    lastRunExported: 0,
    lastRunFailed: 0,
    lastRunFailureBreakdown: {},
    lastRunFallbackRecovered: 0,
    lastRunRateLimitedPlatforms: [],
    platformStatuses: currentStatus?.platformStatuses,
    activePlatforms: [],
    lastRunCancelled: false,
    stopRequested: false,
  })
  await reporter.persist()

  const budget = new ScheduledRunBudget(config.maxTotalPerRun)
  try {
    await runWithConcurrency(duePlatforms, config.maxConcurrentPlatforms, async (platform) => {
      if (signal?.aborted) {
        reporter.status.lastRunCancelled = true
        return
      }

      reporter.markProviderActive(platform)
      try {
        const runResult = await runScheduledExportForPlatform(platform, config, budget, reporter, signal, runId)
        // Do not postpone the next automatic retry after a platform-level
        // failure, cancellation, expired login, or a network outage.
        if (runResult.succeeded && !signal?.aborted) {
          try {
            await chrome.storage.local.set({ [`scheduledExport-lastRun-${platform}`]: now })
          } catch {
            // A checkpoint failure must not leave the visible task stuck in
            // “running”. The dedup index still prevents duplicate files, and
            // the next scan can retry the checkpoint safely.
            reporter.status.lastRunError = 'The scheduled checkpoint could not be saved.'
            void reporter.persist()
          }
        }
      } finally {
        reporter.markProviderInactive(platform)
      }
    })
  } catch (error) {
    if (isExportCancelledError(error) || signal?.aborted) {
      reporter.status.lastRunCancelled = true
    } else {
      // This is a queue-level failure, not a provider response. Keep the
      // diagnostic generic so status never stores conversation data.
      reporter.status.lastRunError = 'The scheduled export queue stopped unexpectedly.'
    }
  } finally {
    reporter.status.lastRunFinishedAt = Date.now()
    reporter.status.isRunning = false
    reporter.status.lastRunCancelled ||= Boolean(signal?.aborted)
    reporter.status.stopRequested = false
    await reporter.persist()
    await reporter.flush()
  }
}

function startScheduledExport(force: boolean): boolean {
  if (scheduledRunPromise) return false
  const controller = new AbortController()
  const runId = createScheduledRunId()
  scheduledRunController = controller
  scheduledRunStopRequestedId = null
  const removeStopWatcher = watchPersistedScheduledStop(runId, controller)
  scheduledRunPromise = (async () => {
    await beginPersistedScheduledRun(runId)
    const stored = await chrome.storage.local.get(SCHEDULED_STOP_REQUEST_KEY)
    if (readPersistedStopRequest(stored[SCHEDULED_STOP_REQUEST_KEY])?.runId === runId) {
      scheduledRunStopRequestedId = runId
      controller.abort()
    }
    await checkAndRunScheduledExports(force, controller.signal, runId)
  })()
    .catch(error => {
      // Keep the service worker promise handled while retaining a diagnostic
      // that does not include conversation text or credentials.
      console.error('[Scheduled Export] Run failed:', error instanceof Error ? error.message : 'unknown error')
    })
    .finally(async () => {
      removeStopWatcher()
      try {
        await clearPersistedScheduledRun(runId)
      } catch {
        // The next run safely replaces an orphaned resource record.
      }
      if (scheduledRunController === controller) scheduledRunController = null
      if (scheduledRunStopRequestedId === runId) scheduledRunStopRequestedId = null
      scheduledRunPromise = null
    })
  return true
}

type ScheduledConversationFetchResult = {
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

// ──────────────────────────────────────────────────────────────────
// Scheduled Export: Tab Management
// ──────────────────────────────────────────────────────────────────

/** Wait for a tab to finish loading */
function waitForTabComplete(tabId: number, timeoutMs: number, signal?: AbortSignal): Promise<void> {
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
    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === 'complete') {
        finish()
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

/** Expose only opaque IDs so the bulk UI can avoid re-downloading its archive. */
async function handleGetExportedConversationIds(
  platform: ExportablePlatform
): Promise<{ data?: string[]; error?: string }> {
  if (!ALL_PLATFORMS.includes(platform)) return { error: 'Unsupported platform' }
  try {
    return { data: [...await getExportedIds(platform)] }
  } catch {
    return { error: 'Could not read export history' }
  }
}

let exportHistoryQueue: Promise<void> = Promise.resolve()

/** Mark a conversation as exported after serializing storage updates. */
async function markAsExported(record: ExportedConversationRecord): Promise<void> {
  let release!: () => void
  const turn = new Promise<void>(resolve => { release = resolve })
  const previous = exportHistoryQueue
  exportHistoryQueue = previous.then(() => turn)
  await previous
  try {
    const key = `exportedIds-${record.platform}`
    const statusKey = `exportedRecord-${record.platform}-${record.id}`

    const result = await chrome.storage.local.get(key)
    const ids: string[] = Array.isArray(result[key]) ? [...result[key]] : []
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
  } finally {
    release()
  }
}

/** Clear all exported history for a platform (or all platforms) */
export async function clearExportedHistory(platform?: ExportablePlatform): Promise<void> {
  const platforms = platform
    ? [platform]
    : ALL_PLATFORMS
  // Record keys are derived from the ID lists (`exportedRecord-<p>-<id>`), so
  // a full-area get(null) scan is unnecessary.
  const idListKeys = platforms.map(p => `exportedIds-${p}`)
  const stored = await chrome.storage.local.get(idListKeys) as Record<string, unknown>
  for (const p of platforms) {
    const idList: unknown = stored[`exportedIds-${p}`]
    const ids: string[] = Array.isArray(idList) ? idList : []
    const recordKeys = ids.map(id => `exportedRecord-${p}-${id}`)
    await chrome.storage.local.remove([`exportedIds-${p}`, ...recordKeys])
  }

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

// ──────────────────────────────────────────────────────────────────
// Scheduled Export: Platform Export Runner
// ──────────────────────────────────────────────────────────────────

/**
 * Run scheduled export for a single platform
 */
interface ScheduledExportRunResult {
  processed: number
  succeeded: boolean
  cancelled?: boolean
  /** A provider told us to slow down; queued items remain eligible for retry. */
  rateLimited?: boolean
}

async function runScheduledExportForPlatform(
  platform: ExportablePlatform,
  config: ScheduledExportSettings,
  budget: ScheduledRunBudget,
  reporter: ScheduledStatusReporter,
  signal?: AbortSignal,
  runId?: string
): Promise<ScheduledExportRunResult> {
  let tabId: number | null = null
  let exported = 0
  let failed = 0
  const status = reporter.status
  let authenticationFailureRecorded = false
  const outputTasks: Promise<void>[] = []

  const recordFailure = (reason: ScheduledExportFailureReason) => {
    failed += 1
    status.lastRunFailed += 1
    recordScheduledFailure(status, reason)
    void reporter.persist()
  }

  try {
    throwIfExportCancelled(signal)
    // Keep scheduled output subject to the user's global export preferences.
    // If storage is unavailable, this resolves to the documented defaults.
    const settings = await getResolvedExtensionSettings()

    // 1. Open a tab to the platform
    const tab = await chrome.tabs.create({
      url: PLATFORM_URLS[platform],
      active: false, // background tab
    })
    tabId = tab.id ?? null

    if (!tabId) throw new Error('Failed to create tab')
    await registerScheduledRunTab(runId, tabId)
    throwIfExportCancelled(signal)

    // 2. Wait for the tab to finish loading
    await waitForTabComplete(tabId, 30000, signal) // 30s timeout

    // 3. Wait for content script to be ready
    await waitForContentScript(tabId, platform, 10000, signal)

    // A provider may redirect an inactive tab to its sign-in page while the
    // extension is waiting for the content script. Record that state without
    // retaining the URL or any page text.
    const loadedTab = await chrome.tabs.get(tabId).catch(() => undefined)
    if (isLikelyProviderLoginUrl(platform, loadedTab?.url)) {
      reporter.markPlatformStatus(platform, 'auth_required')
      recordFailure('authentication_required')
      authenticationFailureRecorded = true
      return { processed: 1, succeeded: false }
    }

    // 4. Fetch conversation list
    throwIfExportCancelled(signal)
    const listResponse = await chrome.tabs.sendMessage(tabId, {
      type: 'FETCH_ALL_CONVERSATIONS',
    })
    throwIfExportCancelled(signal)

    if (isProviderRateLimitError(listResponse?.error)) {
      reporter.markPlatformStatus(platform, 'rate_limited')
      recordScheduledRateLimit(status, platform)
      recordFailure('rate_limited')
      return { processed: 1, succeeded: false, rateLimited: true }
    }

    if (listResponse?.meta?.authRequired || isAuthenticationRequiredError(listResponse?.error)) {
      reporter.markPlatformStatus(platform, 'auth_required')
      recordFailure('authentication_required')
      authenticationFailureRecorded = true
      return { processed: 1, succeeded: false }
    }

    if (!listResponse?.data) {
      throw new Error(`Failed to fetch conversations from ${platform}`)
    }

    reporter.markPlatformStatus(platform, 'ready')

    const allConversations: ConversationListItem[] = listResponse.data
    const listComplete = isScheduledConversationListComplete(listResponse.meta)

    // 5. Filter out already-exported conversations
    const exportedIds = await getExportedIds(platform)
    const newConversations = allConversations.filter(c => !exportedIds.has(c.id))

    // 6. Limit to max per run
    const platformConfig = config.platforms[platform]
    const toExport = newConversations.slice(0, platformConfig.maxPerRun)

    // 7. Resolve conversation details with a user-selected per-provider
    // overlap cap. Starts remain paced, so raising concurrency improves
    // throughput for slow calls without firing an immediate request burst.
    // Markdown/download work is local and therefore runs through a separate
    // limiter; it never blocks the next eligible provider read.
    const requestPacer = new ScheduledRequestPacer(config.requestDelayMs)
    const outputGate = new ScheduledConcurrencyGate(platformConfig.maxConcurrentConversations)
    let rateLimited = false

    const exportResolvedConversation = async (
      convItem: ConversationListItem,
      conversation: Conversation
    ): Promise<void> => {
      let prepared: { markdown: string; filename: string }
      try {
        // Scheduled PDF export is deliberately unsupported: the MV3 worker
        // cannot render a document safely in the background.
        const exportFormat = platformConfig.format || config.defaultFormat
        if (exportFormat !== 'markdown') {
          throw new Error('Scheduled PDF export is not available in the background worker')
        }
        const exportOptions = buildScheduledExportOptions(exportFormat, settings)
        const markdown = conversationToMarkdown(conversation, exportOptions)
        const baseFilename = generateFilename(settings.filenamePattern, conversation)
        const filename = buildDownloadFilename(
          baseFilename,
          platform,
          '.md',
          settings.downloadFolder,
          settings.customFolderName
        )
        prepared = { markdown, filename }
      } catch {
        console.error('[Scheduled Export] Could not prepare Markdown output')
        recordFailure('serialization_failed')
        return
      }

      let downloadId: number | null = null
      try {
        // Build a service-worker-safe URL and wait for Chrome to report that
        // the file actually completed before recording it in history.
        const url = textToDataUrl(prepared.markdown, 'text/markdown')
        try {
          await downloadAndWait(
            { url, filename: prepared.filename, saveAs: false },
            60_000,
            chrome.downloads,
            {
              signal,
              onStarted: async (id) => {
                downloadId = id
                await registerScheduledRunDownload(runId, id)
              },
            }
          )
        } finally {
          if (downloadId !== null && runId) {
            await releaseScheduledRunResource(runId, 'downloadIds', downloadId)
          }
        }
      } catch (error) {
        if (isExportCancelledError(error)) throw error
        console.error('[Scheduled Export] Browser download did not complete')
        recordFailure(classifyScheduledDownloadFailure(error))
        return
      }

      try {
        // Track an item only after a completed download. This keeps a failed
        // item eligible for the next run.
        throwIfExportCancelled(signal)
        await markAsExported({
          id: convItem.id,
          platform,
          title: convItem.title,
          exportedAt: Date.now(),
          filename: prepared.filename,
        })
      } catch (error) {
        if (isExportCancelledError(error)) throw error
        console.error('[Scheduled Export] Could not save export history')
        recordFailure('history_write_failed')
        return
      }

      exported += 1
      status.lastRunExported += 1
      void reporter.persist()
    }

    await runWithConcurrency(
      toExport,
      platformConfig.maxConcurrentConversations,
      async (convItem) => {
        if (rateLimited) return
        await requestPacer.waitForTurn(signal)
        // An earlier concurrent request may have reported a limit while this
        // worker waited for its paced turn. Do not add more provider traffic.
        if (rateLimited) return
        throwIfExportCancelled(signal)
        // A shared claim counts a request only when it is about to start,
        // preserving the total-run ceiling across parallel providers.
        if (!budget.tryClaim()) return

        const resolution = await resolveScheduledConversation(
          convItem,
          async () => {
            const response = await chrome.tabs.sendMessage(tabId!, {
              type: 'FETCH_CONVERSATION_DETAIL',
              data: { id: convItem.id, title: convItem.title },
            })
            return response as ScheduledConversationFetchResult
          },
          item => handleFetchConversationDetailInBackgroundTab(item, signal, runId),
          signal,
        )

        if (resolution.directFailureReason === 'rate_limited') {
          rateLimited = true
          reporter.markPlatformStatus(platform, 'rate_limited')
          recordScheduledRateLimit(status, platform)
          void reporter.persist()
        }

        if (!resolution.conversation) {
          recordFailure(resolution.failureReason ?? 'detail_unavailable')
          return
        }

        if (resolution.fallbackRecovered) {
          status.lastRunFallbackRecovered = (status.lastRunFallbackRecovered ?? 0) + 1
          void reporter.persist()
        }

        const outputTask = outputGate.run(() => exportResolvedConversation(convItem, resolution.conversation!))
        outputTasks.push(outputTask)
        // A stop can abort a queued browser download before the aggregate
        // await below. Observe it immediately to prevent an unhandled worker
        // rejection while still allowing the outer queue to return the reason.
        void outputTask.catch(() => undefined)
      }
    )

    await Promise.allSettled(outputTasks)

    return {
      processed: exported + failed,
      // Do not advance the provider checkpoint after a rate limit: any queue
      // rows we intentionally left untouched must remain eligible next run.
      succeeded: !rateLimited && shouldAdvanceScheduledLastRun({
        attempted: exported + failed,
        exported,
        failed,
        skipped: Math.max(0, newConversations.length - (exported + failed)),
        listComplete,
      }),
      rateLimited,
    }

  } catch (err) {
    await Promise.allSettled(outputTasks)
    if (isExportCancelledError(err)) {
      status.lastRunCancelled = true
      void reporter.persist()
      return { processed: exported + failed, succeeded: false, cancelled: true }
    }
    console.error(`[Scheduled Export] Platform ${platform} failed:`, err)
    const authRequired = isAuthenticationRequiredError(err)
    reporter.markPlatformStatus(platform, authRequired ? 'auth_required' : 'error')
    if (authRequired && !authenticationFailureRecorded) {
      recordFailure('authentication_required')
      authenticationFailureRecorded = true
    }
    // Do not persist raw provider errors: they can include a URL or a
    // conversation title. The aggregate failures remain visible in the UI.
    status.lastRunError = 'A scheduled provider could not be prepared.'
    void reporter.persist()
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
    if (tabId && runId) {
      try {
        await releaseScheduledRunResource(runId, 'tabIds', tabId)
      } catch {
        // Resource bookkeeping must never leave the platform cleanup hanging.
      }
    }
  }
}
