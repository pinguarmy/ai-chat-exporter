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
 * The index is read-modify-written from several contexts (the popup and each
 * provider content script), so every mutation goes through one serialized
 * queue. Without it two concurrent writers can each read the same index and
 * the later write silently drops the other's key, orphaning a snapshot that
 * holds full conversation text.
 */

export const PREVIEW_SNAPSHOT_INDEX_KEY = 'conversationSnapshotKeys'
export const PREVIEW_SNAPSHOT_SWEEP_KEY = 'conversationSnapshotSweepDone'
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
  return Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string') : []
}

/** Register a snapshot key in the index. Best-effort: the hourly cleanup alarm
 * is the only consumer, so an index failure must not break a preview write. */
export async function registerPreviewSnapshotKey(key: string): Promise<void> {
  return queueIndexWrite(async () => {
    try {
      const stored = await chrome.storage.local.get(PREVIEW_SNAPSHOT_INDEX_KEY)
      const keys = readIndex(stored)
      if (keys.includes(key)) return
      keys.push(key)

      // Bound the index even if cleanup is disabled or fails repeatedly. The
      // evicted snapshots are deleted rather than merely forgotten, otherwise
      // trimming would leak exactly the conversation text this index exists
      // to clean up.
      const evicted = keys.length > PREVIEW_SNAPSHOT_INDEX_LIMIT
        ? keys.splice(0, keys.length - PREVIEW_SNAPSHOT_INDEX_LIMIT)
        : []

      await chrome.storage.local.set({ [PREVIEW_SNAPSHOT_INDEX_KEY]: keys })
      if (evicted.length > 0) await chrome.storage.local.remove(evicted)
    } catch {
      // Preview snapshots are still cleaned up with their TTL by the next run
      // that does manage to record the key.
    }
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

    const toRemove = [...expired]
    if (alive.length !== keys.length) {
      if (alive.length === 0) toRemove.push(PREVIEW_SNAPSHOT_INDEX_KEY)
      else await chrome.storage.local.set({ [PREVIEW_SNAPSHOT_INDEX_KEY]: alive })
    }
    if (toRemove.length > 0) await chrome.storage.local.remove(toRemove)
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

      const merged = [...indexed, ...adopted].slice(-PREVIEW_SNAPSHOT_INDEX_LIMIT)
      await chrome.storage.local.set({
        [PREVIEW_SNAPSHOT_INDEX_KEY]: merged,
        [PREVIEW_SNAPSHOT_SWEEP_KEY]: true,
      })
      if (expired.length > 0) await chrome.storage.local.remove(expired)
      return true
    } catch {
      // Leave the flag unset so the next worker start retries.
      return false
    }
  })
}
