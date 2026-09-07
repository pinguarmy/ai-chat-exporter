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
  const response = await chrome.runtime.sendMessage({
    type: PREVIEW_SNAPSHOT_MESSAGE,
    data: conversation,
  })
  if (response?.error) throw new Error('Preview snapshot could not be stored')
}

export const PREVIEW_SNAPSHOT_INDEX_KEY = 'conversationSnapshotKeys'
// Reconcile again for upgrades that already ran the older, lossy index sweep.
export const PREVIEW_SNAPSHOT_SWEEP_KEY = 'conversationSnapshotSweepDoneV2'
export const PREVIEW_SNAPSHOT_TTL_MS = 3600000
export const PREVIEW_SNAPSHOT_PREFIX = 'conversation-'
export const PREVIEW_SNAPSHOT_INDEX_LIMIT = 500

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
  return queueIndexWrite(async () => {
    const key = `${PREVIEW_SNAPSHOT_PREFIX}${conversation.id}`
    const stored = await chrome.storage.local.get(PREVIEW_SNAPSHOT_INDEX_KEY)
    const keys = readIndex(stored).filter(existing => existing !== key)
    keys.push(key)
    const evicted = keys.splice(0, Math.max(0, keys.length - PREVIEW_SNAPSHOT_INDEX_LIMIT))
    // Delete before forgetting keys; a failed deletion remains retryable.
    if (evicted.length) await chrome.storage.local.remove(evicted)
    await chrome.storage.local.set({ [PREVIEW_SNAPSHOT_INDEX_KEY]: keys })
    await chrome.storage.local.set({ [key]: { ...conversation, timestamp: Date.now() } })
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
      ) {
        alive.push(key)
      } else {
        // Missing entries and unparseable timestamps are both safe to drop.
        expired.push(key)
      }
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
        if (typeof timestamp === 'number' && now - timestamp <= PREVIEW_SNAPSHOT_TTL_MS) {
          adopted.push(key)
        } else {
          expired.push(key)
        }
      }

      const allKeys = [...indexed, ...adopted]
      const evicted = allKeys.splice(0, Math.max(0, allKeys.length - PREVIEW_SNAPSHOT_INDEX_LIMIT))
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
