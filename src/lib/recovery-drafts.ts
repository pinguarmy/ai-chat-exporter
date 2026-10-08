import type { PageSnapshot } from './types'
import { normalizeRecoveryRetentionDays } from './types'
import { buildPageSnapshot, isPageSnapshot } from './page-snapshot'

export const RECOVERY_DRAFT_MAX_BYTES = 1024 * 1024
export const RECOVERY_TOTAL_MAX_BYTES = 4 * 1024 * 1024
export const RECOVERY_MAX_DRAFTS = 20
/** Default retention (7 days); the effective value comes from settings. */
export const RECOVERY_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Retention chosen in settings, in milliseconds after the last save. Returns
 * null when drafts are kept until deleted. Falls back to the 7-day default
 * when settings cannot be read.
 */
export async function recoveryRetentionMs(): Promise<number | null> {
  let days = 7
  try {
    const stored = (await chrome.storage.local.get('settings'))?.settings as { recoveryRetentionDays?: unknown } | undefined
    days = normalizeRecoveryRetentionDays(stored?.recoveryRetentionDays)
  } catch { /* keep the default */ }
  return days === 0 ? null : days * DAY_MS
}
const INDEX_KEY = 'recoveryDraftIndexV1'
const SLOT_PREFIX = 'recoveryDraftSlotV1:'
const FAILURE = 'Local save failed. Existing saved content was retained; retry or save Markdown directly.'
const encoder = new TextEncoder()
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).length

export interface RecoveryStatus {
  sessionKey: string
  token?: string
  state: 'off' | 'protected' | 'paused'
  lastSavedAt?: number
  error?: string
  draftId?: string
}
export interface RecoveryDraftSummary {
  id: string
  sessionKey: string
  title: string
  platform: string
  capturedAt: number
  lastSavedAt: number
  state: RecoveryStatus['state']
  messageCount: number
}
interface Entry extends RecoveryDraftSummary { slot: string; size: number; fingerprint: string; token?: string; error?: string }
interface Index { entries: Entry[]; cleanupSlots: string[]; pendingSlots: { slot: string; size: number }[] }
const PAUSED_SESSION_KEY = 'recoveryPendingPausesV1'
const pendingPauses = new Map<string, string>()
let queue: Promise<unknown> = Promise.resolve()
async function publishPause(value: Index): Promise<void> {
  try { await publish(value) } catch {
    for (const entry of value.entries) if (entry.state === 'paused') pendingPauses.set(entry.sessionKey, entry.error || FAILURE)
    // Session storage has an independent quota and survives worker suspension.
    // Browser restart already pauses every protected entry through background initialization.
    try { await chrome.storage.session?.set({ [PAUSED_SESSION_KEY]: Object.fromEntries(pendingPauses) }) } catch { /* current worker remains fail-closed */ }
  }
}
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation, operation)
  queue = result.catch(() => undefined)
  return result
}
async function index(): Promise<Index> {
  const value = (await chrome.storage.local.get(INDEX_KEY))[INDEX_KEY] as Index | undefined
  const result: Index = { entries: Array.isArray(value?.entries) ? value.entries : [], cleanupSlots: Array.isArray(value?.cleanupSlots) ? value.cleanupSlots : [], pendingSlots: Array.isArray(value?.pendingSlots) ? value.pendingSlots : [] }
  try {
    const held = (await chrome.storage.session?.get(PAUSED_SESSION_KEY))?.[PAUSED_SESSION_KEY]
    if (held && typeof held === 'object') for (const [sessionKey, reason] of Object.entries(held)) if (typeof reason === 'string') pendingPauses.set(sessionKey, reason)
  } catch { /* memory map still rejects late checkpoints */ }
  if (pendingPauses.size) {
    for (const entry of result.entries) if (pendingPauses.has(entry.sessionKey)) { entry.state = 'paused'; entry.token = undefined; entry.error = pendingPauses.get(entry.sessionKey) }
    try {
      await publish(result)
      await chrome.storage.session?.remove(PAUSED_SESSION_KEY)
      pendingPauses.clear()
    } catch { /* next operation retries without accepting stale tokens */ }
  }
  return result
}
async function publish(value: Index): Promise<void> { await chrome.storage.local.set({ [INDEX_KEY]: value }) }
function status(sessionKey: string, entry?: Entry): RecoveryStatus {
  return entry ? { sessionKey, state: entry.state, ...(entry.token ? { token: entry.token } : {}), lastSavedAt: entry.lastSavedAt, draftId: entry.id, ...(entry.error ? { error: entry.error } : {}) } : { sessionKey, state: 'off' }
}
async function contentFingerprint(snapshot: PageSnapshot): Promise<string> {
  const c = snapshot.conversation
  const content = JSON.stringify({ platform: c.platform, title: c.title, url: c.url, modelName: c.modelName,
    messages: c.messages.map(({ id: _id, timestamp: _timestamp, ...message }) => message), artifacts: c.artifacts })
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(content))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
async function drain(value: Index): Promise<void> {
  if (!value.cleanupSlots.length && !value.pendingSlots.length) return
  const referenced = new Set(value.entries.map(e => e.slot))
  const obsolete = [...new Set([...value.cleanupSlots, ...value.pendingSlots.map(entry => entry.slot)])].filter(slot => !referenced.has(slot))
  if (!obsolete.length) return
  try {
    await chrome.storage.local.remove(obsolete)
    value.cleanupSlots = value.cleanupSlots.filter(slot => !obsolete.includes(slot))
    value.pendingSlots = value.pendingSlots.filter(entry => !obsolete.includes(entry.slot))
    await publish(value)
  } catch { /* keep finite cleanup list for the next operation */ }
}
function discard(value: Index, entry: Entry): void {
  value.entries = value.entries.filter(e => e.id !== entry.id)
  if (!value.cleanupSlots.includes(entry.slot)) value.cleanupSlots.push(entry.slot)
  if (!value.pendingSlots.some(item => item.slot === entry.slot)) value.pendingSlots.push({ slot: entry.slot, size: entry.size })
}
function prune(value: Index, now: number, ttlMs: number | null): void {
  if (ttlMs === null) return
  for (const entry of [...value.entries]) if (now - entry.lastSavedAt > ttlMs) discard(value, entry)
}
async function save(sessionKey: string, snapshot: PageSnapshot, initial: boolean, token?: string): Promise<RecoveryStatus> {
  const value = await index()
  await drain(value)
  let previous = value.entries.find(e => e.sessionKey === sessionKey)
  if (!initial && (!previous || previous.state !== 'protected' || previous.token !== token)) return status(sessionKey, previous)
  if (!isPageSnapshot(snapshot)) {
    if (previous) { previous.state = 'paused'; previous.token = undefined; previous.error = 'Invalid page snapshot'; await publish(value) }
    return { sessionKey, state: 'paused', lastSavedAt: previous?.lastSavedAt, draftId: previous?.id, error: 'Invalid page snapshot' }
  }
  // Rebuild at the persistence boundary; validated envelopes may still carry arbitrary extra fields.
  snapshot = buildPageSnapshot(snapshot.conversation, snapshot.generationState, snapshot.capturedAt, snapshot.captureId)
  if (previous && !initial && snapshot.conversation.messages.length < previous.messageCount) {
    previous.state = 'paused'; previous.token = undefined; previous.error = 'Visible message count decreased. Protection paused; existing draft retained.'
    await publish(value)
    return status(sessionKey, previous)
  }
  const fingerprint = await contentFingerprint(snapshot)
  if (previous && !initial && fingerprint === previous.fingerprint) return status(sessionKey, previous)
  const now = Date.now()
  const id = previous?.id || crypto.randomUUID()
  const slot = SLOT_PREFIX + crypto.randomUUID()
  const next: Entry = { id, sessionKey, title: snapshot.conversation.title, platform: snapshot.conversation.platform,
    capturedAt: snapshot.capturedAt, lastSavedAt: now, state: 'protected', token: initial ? crypto.randomUUID() : token,
    messageCount: snapshot.conversation.messages.length, slot, size: bytes(snapshot), fingerprint }
  function pause(reason: string): RecoveryStatus { return status(sessionKey, previous ? { ...previous, state: 'paused', token: undefined, error: reason } : { ...next, state: 'paused', token: undefined, error: reason }) }
  if (next.size > RECOVERY_DRAFT_MAX_BYTES) {
    if (previous) { previous.state = 'paused'; previous.token = undefined; previous.error = FAILURE; await publishPause(value) }
    return pause(FAILURE)
  }
  prune(value, now, await recoveryRetentionMs())
  if (value.cleanupSlots.length || value.pendingSlots.length) { await publish(value); await drain(value) }
  previous = value.entries.find(e => e.sessionKey === sessionKey)
  const removable = value.entries.filter(e => e.id !== id && e.state !== 'protected').sort((a, b) => a.lastSavedAt - b.lastSavedAt)
  const projected = () => Math.max(
    bytes({ ...value, pendingSlots: [...value.pendingSlots, { slot, size: next.size }] }),
    bytes({ ...value, entries: value.entries.filter(e => e.id !== id).concat(next), pendingSlots: [...value.pendingSlots, ...(previous ? [{ slot: previous.slot, size: previous.size }] : [])] })
  ) + value.entries.filter(e => e.id !== id).reduce((sum, e) => sum + e.size, 0) + next.size + (previous?.size || 0) + value.pendingSlots.reduce((sum, e) => sum + e.size, 0)
  while ((value.entries.filter(e => e.id !== id).length >= RECOVERY_MAX_DRAFTS || projected() > RECOVERY_TOTAL_MAX_BYTES) && removable.length) {
    discard(value, removable.shift()!)
    await publish(value)
    await drain(value)
  }
  if (value.entries.filter(e => e.id !== id).length >= RECOVERY_MAX_DRAFTS || projected() > RECOVERY_TOTAL_MAX_BYTES) {
    if (previous) { previous.state = 'paused'; previous.token = undefined; previous.error = FAILURE; await publishPause(value) }
    return pause(FAILURE)
  }
  try {
    // Reserve the future body key before writing; worker interruption cannot orphan a transcript.
    value.pendingSlots.push({ slot, size: next.size })
    await publish(value)
    await chrome.storage.local.set({ [slot]: snapshot })
    const oldSlot = previous?.slot
    value.entries = value.entries.filter(e => e.id !== id).concat(next)
    value.pendingSlots = value.pendingSlots.filter(entry => entry.slot !== slot)
    if (oldSlot && !value.cleanupSlots.includes(oldSlot)) value.cleanupSlots.push(oldSlot)
    if (oldSlot && previous && !value.pendingSlots.some(entry => entry.slot === oldSlot)) value.pendingSlots.push({ slot: oldSlot, size: previous.size })
    await publish(value)
    await drain(value)
    return status(sessionKey, next)
  } catch {
    const fresh = await index().catch(() => value)
    // The reserved key stays indexed until a deletion succeeds, including failed publication.
    if (!fresh.pendingSlots.some(entry => entry.slot === slot) && !fresh.entries.some(entry => entry.slot === slot)) fresh.pendingSlots.push({ slot, size: next.size })
    const old = fresh.entries.find(e => e.sessionKey === sessionKey)
    if (old) { old.state = 'paused'; old.token = undefined; old.error = FAILURE }
    await publishPause(fresh)
    await drain(fresh)
    return old ? status(sessionKey, old) : { sessionKey, state: 'paused', error: FAILURE }
  }
}
export function startRecoveryProtection(sessionKey: string, snapshot: PageSnapshot): Promise<RecoveryStatus> { return serial(() => save(sessionKey, snapshot, true)) }
export function writeRecoveryCheckpoint(sessionKey: string, token: string, snapshot: PageSnapshot): Promise<RecoveryStatus> { return serial(() => save(sessionKey, snapshot, false, token)) }
export function stopRecoveryProtection(sessionKey: string): Promise<RecoveryStatus> { return serial(async () => {
  const value = await index(); const entry = value.entries.find(e => e.sessionKey === sessionKey)
  if (entry) { entry.state = 'off'; entry.token = undefined; entry.error = undefined; await publish(value) }
  return status(sessionKey, entry)
}) }
export function pauseRecoveryProtection(sessionKey: string, reason = 'Protection paused. Existing draft retained.'): Promise<RecoveryStatus> { return serial(async () => {
  const value = await index(); const entry = value.entries.find(e => e.sessionKey === sessionKey)
  if (entry) { entry.state = 'paused'; entry.token = undefined; entry.error = reason; await publishPause(value) }
  return status(sessionKey, entry)
}) }
export function pauseAllRecoveryProtection(reason: string): Promise<void> { return serial(async () => {
  const value = await index(); for (const entry of value.entries) if (entry.state === 'protected') { entry.state = 'paused'; entry.token = undefined; entry.error = reason }
  await publishPause(value)
}) }
async function currentIndex(): Promise<Index> {
  const value = await index()
  const before = value.entries.length
  prune(value, Date.now(), await recoveryRetentionMs())
  if (value.entries.length !== before) await publish(value)
  await drain(value)
  return value
}
export function listRecoveryDrafts(): Promise<RecoveryDraftSummary[]> { return serial(async () => (await currentIndex()).entries.map(({ id, sessionKey, title, platform, capturedAt, lastSavedAt, state, messageCount }) => ({ id, sessionKey, title, platform, capturedAt, lastSavedAt, state, messageCount }))) }
export function getRecoveryStatus(sessionKey: string): Promise<RecoveryStatus> { return serial(async () => status(sessionKey, (await currentIndex()).entries.find(e => e.sessionKey === sessionKey))) }
export function getRecoveryDraft(id: string): Promise<PageSnapshot | null> { return serial(async () => {
  const entry = (await currentIndex()).entries.find(e => e.id === id)
  if (!entry) return null
  const snapshot = (await chrome.storage.local.get(entry.slot))[entry.slot]
  return isPageSnapshot(snapshot) ? snapshot : null
}) }
export function deleteRecoveryDraft(id: string): Promise<void> { return serial(async () => {
  const value = await index(); const entry = value.entries.find(e => e.id === id)
  if (!entry) return
  discard(value, entry); await publish(value); await drain(value)
}) }
export function clearRecoveryDrafts(): Promise<void> { return serial(async () => {
  const value = await index(); for (const entry of [...value.entries]) discard(value, entry)
  await publish(value); await drain(value)
}) }
export function cleanupRecoveryDrafts(now = Date.now()): Promise<void> { return serial(async () => {
  const value = await index(); prune(value, now, await recoveryRetentionMs()); await publish(value); await drain(value)
}) }
