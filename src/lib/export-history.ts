import type { ExportablePlatform, ExportedConversationRecord } from './types'

let writes: Promise<unknown> = Promise.resolve()

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = writes.catch(() => undefined).then(operation)
  writes = result
  return result
}

export async function getExportedIds(platform: ExportablePlatform): Promise<Set<string>> {
  const key = `exportedIds-${platform}`
  const stored = await chrome.storage.local.get(key)
  return new Set(Array.isArray(stored[key]) ? stored[key].filter((id: unknown) => typeof id === 'string') : [])
}

/** Publish the dedup index and its history record in the same storage write. */
export function markAsExported(record: ExportedConversationRecord): Promise<void> {
  return serialize(async () => {
    const key = `exportedIds-${record.platform}`
    const ids = [...await getExportedIds(record.platform)]
    if (!ids.includes(record.id)) ids.push(record.id)
    const evicted = ids.splice(0, Math.max(0, ids.length - 500))
    await chrome.storage.local.set({
      [key]: ids,
      [`exportedRecord-${record.platform}-${record.id}`]: record,
    })
    if (evicted.length) {
      // The export is already committed. Cleanup failure must not turn it into
      // a failed export or poison the next history writer.
      try {
        await chrome.storage.local.remove(evicted.map(id => `exportedRecord-${record.platform}-${id}`))
      } catch {
        console.warn('[Export History] Could not remove expired history records')
      }
    }
  })
}

/** Clear uses the same queue as writers so it cannot orphan a concurrent record. */
export function clearPlatformHistory(platforms: ExportablePlatform[]): Promise<void> {
  return serialize(async () => {
    const keys = platforms.map(platform => `exportedIds-${platform}`)
    const stored = await chrome.storage.local.get(keys)
    await chrome.storage.local.remove(platforms.flatMap(platform => {
      const key = `exportedIds-${platform}`
      const ids: string[] = Array.isArray(stored[key]) ? stored[key] : []
      return [key, ...ids.map(id => `exportedRecord-${platform}-${id}`)]
    }))
  })
}
