/**
 * Local recovery protection for Gemini conversations: start/stop/status
 * controls (extension pages only), checkpoint writes from the protected tab's
 * content script, and draft management.
 */
import type { BackgroundRequestOf, BackgroundResponse } from '../platform/background-messages'
import { isPageSnapshot } from '../core/page-snapshot'
import {
  startRecoveryProtection, writeRecoveryCheckpoint, stopRecoveryProtection, pauseRecoveryProtection,
  listRecoveryDrafts, getRecoveryDraft, deleteRecoveryDraft, clearRecoveryDrafts, getRecoveryStatus,
  pauseAllRecoveryProtection,
} from '../platform/recovery-drafts'
import type { SnapshotContext } from '../platform/recovery-monitor'
import { isExtensionPageSender } from './sender'

const RESTART_PAUSE_REASON = 'Browser restarted. Enable protection again for the current conversation.'

function validSnapshotContext(value: unknown): value is SnapshotContext {
  if (!value || typeof value !== 'object') return false
  const context = value as SnapshotContext
  return typeof context.documentId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(context.documentId)
    && typeof context.sessionId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(context.sessionId)
    && Number.isSafeInteger(context.sessionEpoch) && context.sessionEpoch >= 0
}
function recoverySessionKey(tabId: number, context: SnapshotContext): string {
  return `gemini:${tabId}:${context.documentId}:${context.sessionId}:${context.sessionEpoch}`
}

let recoveryReady: Promise<void> = Promise.resolve()
/** Called once at worker start: pauses protection left over from a previous browser session. */
export function startRecoveryInitialization(): void {
  recoveryReady = (async () => {
    // session storage survives worker suspension, but is cleared by browser restart.
    const session = chrome.storage.session
    if (!session) return // onStartup still pauses protection on browsers without session storage.
    const key = 'recoveryBrowserSessionInitialized'
    const initialized = await session.get(key)
    if (initialized[key] !== true) {
      await pauseAllRecoveryProtection(RESTART_PAUSE_REASON)
      await session.set({ [key]: true })
    }
  })()
  // Attach a rejection handler now; requests below still receive a safe failure.
  void recoveryReady.catch(() => console.warn('[Recovery] Initialization failed; protection is unavailable'))
}

/** onStartup is a browser restart, not an ordinary MV3 worker wake-up. */
export function registerRecoveryListeners(): void {
  chrome.runtime.onStartup?.addListener(() => {
    void pauseAllRecoveryProtection(RESTART_PAUSE_REASON).catch(() => console.warn('[Recovery] Could not pause protection after restart'))
  })
  chrome.tabs?.onRemoved?.addListener(tabId => { void stopRecoveryTab(tabId).catch(() => undefined) })
}

const recoveryTabCommands = new Map<number, number>()
function nextRecoveryCommand(tabId: number): number {
  const sequence = (recoveryTabCommands.get(tabId) || 0) + 1
  recoveryTabCommands.set(tabId, sequence)
  return sequence
}
async function captureRecoveryTab(tabId: number) {
  const tab = await chrome.tabs.get(tabId)
  if (!tab.url || new URL(tab.url).hostname !== 'gemini.google.com') throw new Error('Local protection is currently available for Gemini only.')
  const requestId = crypto.randomUUID()
  const response = await chrome.tabs.sendMessage(tabId, { type: 'CAPTURE_PAGE_SNAPSHOT', data: { requestId } })
  if (!isPageSnapshot(response?.data) || response?.data.conversation.platform !== 'gemini' || response?.meta?.requestId !== requestId || !validSnapshotContext(response?.meta)) {
    throw new Error('Current conversation could not be captured for local protection.')
  }
  return { snapshot: response.data, context: response.meta as SnapshotContext }
}
async function stopRecoveryTab(tabId: number): Promise<number> {
  const command = nextRecoveryCommand(tabId)
  await chrome.tabs.sendMessage(tabId, { type: 'STOP_RECOVERY_MONITOR' }).catch(() => undefined)
  for (const draft of await listRecoveryDrafts()) {
    const record = draft as unknown as { sessionKey?: string }
    if (record.sessionKey?.startsWith(`gemini:${tabId}:`)) await stopRecoveryProtection(record.sessionKey)
  }
  return command
}

const EXTENSION_PAGE_ERROR: BackgroundResponse = { error: 'Recovery controls require an extension page' }

/**
 * Checkpoint writes and pauses come from the protected tab's content script.
 * They must come from a Gemini tab whose id matches the session key, and carry
 * the token of the currently protected session.
 */
async function authorizeCheckpointSender(
  data: { sessionKey?: unknown; token?: unknown } | undefined,
  sender: chrome.runtime.MessageSender,
): Promise<BackgroundResponse | { sessionKey: string; token: string; tabId: number }> {
  if (!sender.tab?.id || !sender.url || new URL(sender.url).hostname !== 'gemini.google.com' || typeof data?.sessionKey !== 'string' || !data.sessionKey.startsWith(`gemini:${sender.tab.id}:`) || typeof data.token !== 'string') {
    return { error: 'Invalid recovery checkpoint sender' }
  }
  const status = await getRecoveryStatus(data.sessionKey)
  if (status.state !== 'protected' || status.token !== data.token) return { error: 'Local protection is no longer active' }
  return { sessionKey: data.sessionKey, token: data.token, tabId: sender.tab.id }
}

export async function handleWriteRecoveryCheckpoint(
  { data }: BackgroundRequestOf<'WRITE_RECOVERY_CHECKPOINT'>,
  sender: chrome.runtime.MessageSender,
): Promise<BackgroundResponse> {
  await recoveryReady
  const authorized = await authorizeCheckpointSender(data, sender)
  if (!('sessionKey' in authorized)) return authorized
  if (!validSnapshotContext(data.context) || recoverySessionKey(authorized.tabId, data.context) !== data.sessionKey || !isPageSnapshot(data.snapshot) || data.snapshot.conversation.platform !== 'gemini') return { error: 'Invalid recovery checkpoint' }
  return { data: await writeRecoveryCheckpoint(data.sessionKey, data.token, data.snapshot) }
}

export async function handlePauseRecoveryProtection(
  { data }: BackgroundRequestOf<'PAUSE_RECOVERY_PROTECTION'>,
  sender: chrome.runtime.MessageSender,
): Promise<BackgroundResponse> {
  await recoveryReady
  const authorized = await authorizeCheckpointSender(data, sender)
  if (!('sessionKey' in authorized)) return authorized
  return { data: await pauseRecoveryProtection(data.sessionKey, 'Page changed or capture failed. Enable protection again for the current conversation.') }
}

export async function handleListRecoveryDrafts(
  _request: BackgroundRequestOf<'LIST_RECOVERY_DRAFTS'>,
  sender: chrome.runtime.MessageSender,
): Promise<BackgroundResponse> {
  await recoveryReady
  if (!isExtensionPageSender(sender)) return EXTENSION_PAGE_ERROR
  return { data: await listRecoveryDrafts() }
}

export async function handleGetRecoveryDraft(
  { data }: BackgroundRequestOf<'GET_RECOVERY_DRAFT'>,
  sender: chrome.runtime.MessageSender,
): Promise<BackgroundResponse> {
  await recoveryReady
  if (!isExtensionPageSender(sender)) return EXTENSION_PAGE_ERROR
  return { data: await getRecoveryDraft(String(data?.id || '')) }
}

export async function handleStopRecoveryDraft(
  { data }: BackgroundRequestOf<'STOP_RECOVERY_DRAFT'>,
  sender: chrome.runtime.MessageSender,
): Promise<BackgroundResponse> {
  await recoveryReady
  if (!isExtensionPageSender(sender)) return EXTENSION_PAGE_ERROR
  const draft = (await listRecoveryDrafts()).find(item => item.id === data?.id)
  if (!draft) return { error: 'Recovery draft is unavailable' }
  const tabId = Number(draft.sessionKey.split(':')[1])
  if (Number.isSafeInteger(tabId)) {
    nextRecoveryCommand(tabId)
    await chrome.tabs.sendMessage(tabId, { type: 'STOP_RECOVERY_MONITOR' }).catch(() => undefined)
  }
  return { data: await stopRecoveryProtection(draft.sessionKey) }
}

export async function handleDeleteRecoveryDraft(
  { data }: BackgroundRequestOf<'DELETE_RECOVERY_DRAFT'>,
  sender: chrome.runtime.MessageSender,
): Promise<BackgroundResponse> {
  await recoveryReady
  if (!isExtensionPageSender(sender)) return EXTENSION_PAGE_ERROR
  const id = String(data?.id || '')
  const draft = (await listRecoveryDrafts()).find(item => item.id === id)
  if (draft?.state === 'protected') {
    const sourceTabId = Number(draft.sessionKey.split(':')[1])
    if (Number.isSafeInteger(sourceTabId)) {
      nextRecoveryCommand(sourceTabId)
      await chrome.tabs.sendMessage(sourceTabId, { type: 'STOP_RECOVERY_MONITOR' }).catch(() => undefined)
    }
  }
  await deleteRecoveryDraft(id)
  return { data: true }
}

export async function handleClearRecoveryDrafts(
  _request: BackgroundRequestOf<'CLEAR_RECOVERY_DRAFTS'>,
  sender: chrome.runtime.MessageSender,
): Promise<BackgroundResponse> {
  await recoveryReady
  if (!isExtensionPageSender(sender)) return EXTENSION_PAGE_ERROR
  // Cancel pending initial captures as well as already registered tokens.
  const sourceTabs = new Set(recoveryTabCommands.keys())
  for (const draft of await listRecoveryDrafts()) {
    const sourceTabId = Number(draft.sessionKey.split(':')[1])
    if (Number.isSafeInteger(sourceTabId)) sourceTabs.add(sourceTabId)
  }
  for (const sourceTabId of sourceTabs) nextRecoveryCommand(sourceTabId)
  await Promise.all([...sourceTabs].map(sourceTabId => chrome.tabs.sendMessage(sourceTabId, { type: 'STOP_RECOVERY_MONITOR' }).catch(() => undefined)))
  await clearRecoveryDrafts()
  return { data: true }
}

/** Shared by the tab-addressed controls: extension page only, with a valid source tab id. */
async function authorizeTabControl(
  data: { tabId?: unknown } | undefined,
  sender: chrome.runtime.MessageSender,
): Promise<BackgroundResponse | { tabId: number }> {
  await recoveryReady
  if (!isExtensionPageSender(sender)) return EXTENSION_PAGE_ERROR
  const tabId = data?.tabId
  if (!Number.isSafeInteger(tabId) || (tabId as number) < 0) return { error: 'Invalid source tab' }
  return { tabId: tabId as number }
}

export async function handleStopRecoveryProtection(
  { data }: BackgroundRequestOf<'STOP_RECOVERY_PROTECTION'>,
  sender: chrome.runtime.MessageSender,
): Promise<BackgroundResponse> {
  const authorized = await authorizeTabControl(data, sender)
  if (!('tabId' in authorized)) return authorized
  await stopRecoveryTab(authorized.tabId)
  return { data: { state: 'off', sessionKey: '' } }
}

export async function handleGetRecoveryStatus(
  { data }: BackgroundRequestOf<'GET_RECOVERY_STATUS'>,
  sender: chrome.runtime.MessageSender,
): Promise<BackgroundResponse> {
  const authorized = await authorizeTabControl(data, sender)
  if (!('tabId' in authorized)) return authorized
  const { tabId } = authorized
  const summaries = await listRecoveryDrafts()
  const matching = summaries.filter(item => (item as unknown as { sessionKey?: string }).sessionKey?.startsWith(`gemini:${tabId}:`))
  const draft = (matching.find(item => (item as unknown as { state?: string }).state === 'protected') || matching.sort((a, b) => b.lastSavedAt - a.lastSavedAt)[0]) as unknown as { sessionKey?: string } | undefined
  return { data: draft?.sessionKey ? await getRecoveryStatus(draft.sessionKey) : { state: 'off', sessionKey: '' } }
}

export async function handleStartRecoveryProtection(
  { data }: BackgroundRequestOf<'START_RECOVERY_PROTECTION'>,
  sender: chrome.runtime.MessageSender,
): Promise<BackgroundResponse> {
  const authorized = await authorizeTabControl(data, sender)
  if (!('tabId' in authorized)) return authorized
  const { tabId } = authorized
  const command = await stopRecoveryTab(tabId)
  if (recoveryTabCommands.get(tabId) !== command) return { error: 'Protection request was superseded' }
  const { snapshot, context } = await captureRecoveryTab(tabId)
  if (recoveryTabCommands.get(tabId) !== command) return { error: 'Protection request was superseded' }
  const sessionKey = recoverySessionKey(tabId, context)
  const status = await startRecoveryProtection(sessionKey, snapshot)
  if (recoveryTabCommands.get(tabId) !== command) { await stopRecoveryProtection(sessionKey); return { error: 'Protection request was superseded' } }
  if (status.state !== 'protected' || !status.token) return { data: status }
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'ACTIVATE_RECOVERY_MONITOR', data: { sessionKey, token: status.token, context } })
    if (response?.data !== true || recoveryTabCommands.get(tabId) !== command) throw new Error('Conversation changed before protection could start.')
    return { data: status }
  } catch {
    await stopRecoveryProtection(sessionKey)
    return { error: 'Conversation changed before protection could start. The initial draft was retained.' }
  }
}
