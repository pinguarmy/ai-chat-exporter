/**
 * Preview snapshot key index.
 *
 * Conversation snapshots (`conversation-<id>`) are a short-lived hand-off to
 * the preview tab. Cleanup must never scan the whole storage area with
 * `chrome.storage.local.get(null)` — that would pull every cached snapshot and
 * credential into memory just to filter by key prefix. Instead, writers keep
 * a small index of the keys they created and the cleanup alarm reads only
 * those entries.
 *
 * Popup and content scripts send snapshot requests to the background worker.
 * Only that worker mutates the index, through one serialized queue shared with
 * cleanup and migration. A module-level queue alone cannot synchronize separate
 * browser contexts.
 */
import type { Conversation } from './types'

export const PREVIEW_SNAPSHOT_MESSAGE = 'STORE_PREVIEW_SNAPSHOT'

/** Keep all snapshot/index writes in the background worker's single queue. */
export async function requestPreviewSnapshot(conversation: Conversation): Promise<void> {
  // The raw provider payload is archive-only material: it must never be
  // persisted into chrome.storage or cross process boundaries for previews.
  const { rawProviderPayload: _rawProviderPayload, ...previewSafeConversation } = conversation
  const response = await chrome.runtime.sendMessage({
    type: PREVIEW_SNAPSHOT_MESSAGE,
    data: previewSafeConversation,
  })
  if (response?.error) throw new Error('Preview snapshot could not be stored')
}

export const PREVIEW_SNAPSHOT_INDEX_KEY = 'conversationSnapshotKeys'
// Reconcile again for upgrades that already ran the older, lossy index sweep.
export const PREVIEW_SNAPSHOT_SWEEP_KEY = 'conversationSnapshotSweepDoneV2'
export const PREVIEW_SNAPSHOT_TTL_MS = 3600000
export const PREVIEW_SNAPSHOT_PREFIX = 'conversation-'
export const PREVIEW_SNAPSHOT_INDEX_LIMIT = 500
export const PREVIEW_SNAPSHOT_MAX_ENTRY_BYTES = 1024 * 1024
export const PREVIEW_SNAPSHOT_MAX_BYTES = 2 * 1024 * 1024
const previewBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength

/** Serializes every read-modify-write of the snapshot index. */
let indexWrites: Promise<unknown> = Promise.resolve()

function queueIndexWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = indexWrites.catch(() => undefined).then(task)
  indexWrites = run.catch(() => undefined)
  return run
}

function readIndex(stored: Record<string, unknown>): string[] {
  const value = stored[PREVIEW_SNAPSHOT_INDEX_KEY]
  return Array.isArray(value)
    ? [...new Set(value.filter((key): key is string => typeof key === 'string' && key.startsWith(PREVIEW_SNAPSHOT_PREFIX)))]
    : []
}

/** Background-only writer. Index first so interruption never leaves an orphan. */
export async function storePreviewSnapshot(conversation: Conversation): Promise<void> {
  if (!conversation || typeof conversation.id !== 'string' || !conversation.id || !Array.isArray(conversation.messages)) {
    throw new Error('Invalid preview snapshot')
  }
  const { rawProviderPayload: _raw, ...safeConversation } = conversation
  const value = { ...safeConversation, timestamp: Date.now() }
  const incomingBytes = previewBytes(value)
  if (incomingBytes > PREVIEW_SNAPSHOT_MAX_ENTRY_BYTES) throw new Error('Conversation is too large for temporary preview')
  return queueIndexWrite(async () => {
    const key = `${PREVIEW_SNAPSHOT_PREFIX}${conversation.id}`
    const stored = await chrome.storage.local.get(PREVIEW_SNAPSHOT_INDEX_KEY)
    const keys = readIndex(stored).filter(existing => existing !== key)
    const entries = keys.length ? await chrome.storage.local.get(keys) : {}
    let bytes = keys.reduce((total, existing) => total + (entries[existing] ? previewBytes(entries[existing]) : 0), 0)
    const evicted: string[] = []
    while (keys.length >= PREVIEW_SNAPSHOT_INDEX_LIMIT || bytes + incomingBytes > PREVIEW_SNAPSHOT_MAX_BYTES) {
      const oldest = keys.shift()
      if (!oldest) break
      bytes -= entries[oldest] ? previewBytes(entries[oldest]) : 0
      evicted.push(oldest)
    }
    keys.push(key)
    // Delete before forgetting keys; a failed deletion remains retryable.
    if (evicted.length) await chrome.storage.local.remove(evicted)
    await chrome.storage.local.set({ [PREVIEW_SNAPSHOT_INDEX_KEY]: keys })
    await chrome.storage.local.set({ [key]: value })
  })
}

/** Remove expired preview snapshots listed in the index. */
export async function cleanupExpiredPreviewSnapshots(now = Date.now()): Promise<void> {
  return queueIndexWrite(async () => {
    const stored = await chrome.storage.local.get(PREVIEW_SNAPSHOT_INDEX_KEY)
    const keys = readIndex(stored)
    if (keys.length === 0) return

    const entries = await chrome.storage.local.get(keys)
    const expired: string[] = []
    const alive: string[] = []
    for (const key of keys) {
      const value = entries[key] as { timestamp?: number } | undefined
      if (
        value && typeof value === 'object'
        && typeof value.timestamp === 'number'
        && now - value.timestamp <= PREVIEW_SNAPSHOT_TTL_MS
        && previewBytes(value) <= PREVIEW_SNAPSHOT_MAX_ENTRY_BYTES
      ) {
        alive.push(key)
      } else {
        // Missing entries and unparseable timestamps are both safe to drop.
        expired.push(key)
      }
    }

    let totalBytes = alive.reduce((total, key) => total + previewBytes(entries[key]), 0)
    while (totalBytes > PREVIEW_SNAPSHOT_MAX_BYTES && alive.length) {
      const key = alive.shift()!
      totalBytes -= previewBytes(entries[key])
      expired.push(key)
    }
    // A deletion failure must leave the old index intact for the next alarm.
    if (expired.length > 0) await chrome.storage.local.remove(expired)
    if (alive.length !== keys.length) {
      if (alive.length === 0) await chrome.storage.local.remove(PREVIEW_SNAPSHOT_INDEX_KEY)
      else await chrome.storage.local.set({ [PREVIEW_SNAPSHOT_INDEX_KEY]: alive })
    }
  })
}

/**
 * One-time reconciliation for snapshots written before the index existed.
 *
 * Releases up to 1.2.6 cleaned up by scanning the whole storage area, so those
 * `conversation-*` keys have no index entry. Once cleanup switched to the
 * index they became unreachable and would sit on disk indefinitely holding
 * full conversation text. This adopts the live ones into the index and deletes
 * the expired ones.
 *
 * `get(null)` is exactly what the index exists to avoid, so this runs once and
 * records a flag. It retries on the next worker start until it succeeds.
 */
export async function sweepUnindexedPreviewSnapshots(now = Date.now()): Promise<boolean> {
  return queueIndexWrite(async () => {
    try {
      const stored = await chrome.storage.local.get([
        PREVIEW_SNAPSHOT_SWEEP_KEY,
        PREVIEW_SNAPSHOT_INDEX_KEY,
      ])
      if (stored[PREVIEW_SNAPSHOT_SWEEP_KEY] === true) return true

      const indexed = new Set(readIndex(stored))
      const all = await chrome.storage.local.get(null) as unknown as Record<string, unknown>

      const adopted: string[] = []
      const expired: string[] = []
      for (const [key, value] of Object.entries(all)) {
        if (!key.startsWith(PREVIEW_SNAPSHOT_PREFIX) || indexed.has(key)) continue
        const timestamp = (value as { timestamp?: number } | null)?.timestamp
        if (typeof timestamp === 'number' && now - timestamp <= PREVIEW_SNAPSHOT_TTL_MS && previewBytes(value) <= PREVIEW_SNAPSHOT_MAX_ENTRY_BYTES) {
          adopted.push(key)
        } else {
          expired.push(key)
        }
      }

      const allKeys = [...indexed, ...adopted]
      const evicted = allKeys.splice(0, Math.max(0, allKeys.length - PREVIEW_SNAPSHOT_INDEX_LIMIT))
      let totalBytes = allKeys.reduce((total, key) => total + (all[key] ? previewBytes(all[key]) : 0), 0)
      while (totalBytes > PREVIEW_SNAPSHOT_MAX_BYTES && allKeys.length) {
        const key = allKeys.shift()!
        totalBytes -= all[key] ? previewBytes(all[key]) : 0
        evicted.push(key)
      }
      const toRemove = [...new Set([...expired, ...evicted])]
      // Mark done only after removals succeed, including live limit evictions.
      if (toRemove.length > 0) await chrome.storage.local.remove(toRemove)
      await chrome.storage.local.set({
        [PREVIEW_SNAPSHOT_INDEX_KEY]: allKeys,
        [PREVIEW_SNAPSHOT_SWEEP_KEY]: true,
      })
      return true
    } catch {
      // Leave the flag unset so the next worker start retries.
      return false
    }
  })
}
