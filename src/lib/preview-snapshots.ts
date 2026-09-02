/**
 * Preview snapshot key index.
 *
 * Conversation snapshots (`conversation-<id>`) are a short-lived hand-off to
 * the preview tab. Cleanup must never scan the whole storage area with
 * `chrome.storage.local.get(null)` — that would pull every cached snapshot and
 * credential into memory just to filter by key prefix. Instead, writers keep
 * a small index of the keys they created and the cleanup alarm reads only
 * those entries.
 */

export const PREVIEW_SNAPSHOT_INDEX_KEY = 'conversationSnapshotKeys'
export const PREVIEW_SNAPSHOT_TTL_MS = 3600000

/** Register a snapshot key in the index. Best-effort: the hourly cleanup alarm
 * is the only consumer, so an index failure must not break a preview write. */
export async function registerPreviewSnapshotKey(key: string): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(PREVIEW_SNAPSHOT_INDEX_KEY)
    const keys: string[] = Array.isArray(stored[PREVIEW_SNAPSHOT_INDEX_KEY])
      ? stored[PREVIEW_SNAPSHOT_INDEX_KEY]
      : []
    if (!keys.includes(key)) keys.push(key)
    // Bound the index even if cleanup is disabled or fails repeatedly.
    const trimmed = keys.slice(-500)
    await chrome.storage.local.set({ [PREVIEW_SNAPSHOT_INDEX_KEY]: trimmed })
  } catch {
    // Preview snapshots are still cleaned up with their TTL by the next run
    // that does manage to record the key.
  }
}

/** Remove expired preview snapshots listed in the index. */
export async function cleanupExpiredPreviewSnapshots(now = Date.now()): Promise<void> {
  const stored = await chrome.storage.local.get(PREVIEW_SNAPSHOT_INDEX_KEY)
  const keys: string[] = Array.isArray(stored[PREVIEW_SNAPSHOT_INDEX_KEY])
    ? stored[PREVIEW_SNAPSHOT_INDEX_KEY]
    : []
  if (keys.length === 0) return

  const entries = await chrome.storage.local.get(keys)
  const expired: string[] = []
  const alive: string[] = []
  for (const key of keys) {
    const value = entries[key] as { timestamp?: number } | undefined
    if (value && typeof value === 'object' && typeof value.timestamp === 'number' && now - value.timestamp <= PREVIEW_SNAPSHOT_TTL_MS) {
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
}
