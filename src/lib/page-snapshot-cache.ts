import type { ExtensionSettings } from './types'
import { buildSnapshotExportOptions, isPageSnapshot, prepareSnapshotForOutput, type PageSnapshot } from './page-snapshot'

export const PAGE_SNAPSHOT_CACHE_KEY = 'pageSnapshotPreviewIndex'
export const PAGE_SNAPSHOT_CACHE_PREFIX = 'page-snapshot-preview-'
export const PAGE_SNAPSHOT_CACHE_TTL_MS = 60 * 60 * 1000
export const PAGE_SNAPSHOT_CACHE_MAX_BYTES = 2 * 1024 * 1024
export const PAGE_SNAPSHOT_CACHE_MAX_ENTRY_BYTES = 1024 * 1024
export const PAGE_SNAPSHOT_CACHE_LIMIT = 20

type CacheIndexEntry = { id: string; expiresAt: number; bytes: number }
export interface PageSnapshotPreview { snapshot: PageSnapshot; settings?: Partial<ExtensionSettings> }
let writes: Promise<unknown> = Promise.resolve()
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = writes.catch(() => undefined).then(task)
  writes = run.catch(() => undefined)
  return run
}
function validId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id)
}
async function readIndex(): Promise<CacheIndexEntry[]> {
  const stored = await chrome.storage.local.get(PAGE_SNAPSHOT_CACHE_KEY)
  const index = stored[PAGE_SNAPSHOT_CACHE_KEY]
  return Array.isArray(index) ? index.filter((entry): entry is CacheIndexEntry =>
    entry && validId(entry.id) && Number.isFinite(entry.expiresAt) && Number.isFinite(entry.bytes) && entry.bytes > 0) : []
}
async function replaceIndex(index: CacheIndexEntry[]): Promise<void> {
  await chrome.storage.local.set({ [PAGE_SNAPSHOT_CACHE_KEY]: index })
}
async function cleanup(index: CacheIndexEntry[], now: number): Promise<CacheIndexEntry[]> {
  const expired = index.filter(entry => entry.expiresAt <= now)
  if (expired.length) {
    await chrome.storage.local.remove(expired.map(entry => PAGE_SNAPSHOT_CACHE_PREFIX + entry.id))
    index = index.filter(entry => entry.expiresAt > now)
    await replaceIndex(index)
  }
  return index
}

function previewSettings(settings?: Partial<ExtensionSettings>): Partial<ExtensionSettings> | undefined {
  if (!settings) return undefined
  // Never persist arbitrary message fields alongside a sanitized transcript.
  const keys = ['theme', 'locale', 'safeShare', 'includeMetadata', 'includeCodeBlocks', 'includeImages', 'exportArtifacts', 'includeUploadedFiles', 'referenceExportMode', 'pdfStyle', 'pdfTextLayer', 'assistantDisplayName', 'showMessageTimestamps', 'downloadFolder', 'customFolderName', 'askForSaveLocation'] as const
  return Object.fromEntries(keys.filter(key => settings[key] !== undefined).map(key => [key, settings[key]])) as Partial<ExtensionSettings>
}

/** Background-only serialized writer. A capture is immutable, including preview options. */
export async function storePageSnapshotPreview(snapshot: PageSnapshot, settings?: Partial<ExtensionSettings>): Promise<void> {
  if (!isPageSnapshot(snapshot) || !validId(snapshot.captureId)) throw new Error('Invalid page snapshot')
  // A share preview never persists its unredacted source transcript.
  const prepared = prepareSnapshotForOutput(snapshot, settings)
  const safeSettings = previewSettings(settings)
  if (safeSettings && settings?.safeShare) safeSettings.assistantDisplayName = buildSnapshotExportOptions('markdown', settings).assistantDisplayName
  const entry: PageSnapshotPreview = { snapshot: prepared, settings: safeSettings }
  const bytes = new TextEncoder().encode(JSON.stringify(entry)).byteLength
  if (bytes > PAGE_SNAPSHOT_CACHE_MAX_ENTRY_BYTES) throw new Error('Snapshot is too large for temporary preview. Save Markdown directly instead.')
  await serialize(async () => {
    let index = await cleanup(await readIndex(), Date.now())
    if (index.some(item => item.id === snapshot.captureId)) {
      const key = PAGE_SNAPSHOT_CACHE_PREFIX + snapshot.captureId
      const previous = (await chrome.storage.local.get(key))[key] as PageSnapshotPreview | undefined
      if (previous && JSON.stringify(previous.settings || {}) !== JSON.stringify(entry.settings || {})) {
        throw new Error('Preview settings changed. Recapture the page before opening a new preview or PDF.')
      }
      if (previous) return
      // A reserved key whose body write failed may be retried without changing identity.
      index = index.filter(item => item.id !== snapshot.captureId)
    }
    const evicted: CacheIndexEntry[] = []
    while (index.length >= PAGE_SNAPSHOT_CACHE_LIMIT || index.reduce((n, item) => n + item.bytes, 0) + bytes > PAGE_SNAPSHOT_CACHE_MAX_BYTES) {
      const oldest = index.shift()
      if (!oldest) break
      evicted.push(oldest)
    }
    if (evicted.length) {
      await chrome.storage.local.remove(evicted.map(item => PAGE_SNAPSHOT_CACHE_PREFIX + item.id))
      await replaceIndex(index)
    }
    // Index first leaves interruption cleanup retryable, never an unindexed body.
    index.push({ id: snapshot.captureId, expiresAt: Date.now() + PAGE_SNAPSHOT_CACHE_TTL_MS, bytes })
    await replaceIndex(index)
    await chrome.storage.local.set({ [PAGE_SNAPSHOT_CACHE_PREFIX + snapshot.captureId]: entry })
  })
}

/** Background-only reader; expiry is enforced even while cleanup alarms are delayed. */
export async function readPageSnapshotPreview(id: string): Promise<PageSnapshotPreview | null> {
  if (!validId(id)) return null
  return serialize(async () => {
    const index = await cleanup(await readIndex(), Date.now())
    if (!index.some(entry => entry.id === id)) return null
    const key = PAGE_SNAPSHOT_CACHE_PREFIX + id
    const stored = await chrome.storage.local.get(key)
    const value = stored[key] as PageSnapshotPreview | undefined
    return value && isPageSnapshot(value.snapshot) && value.snapshot.captureId === id ? value : null
  })
}
export async function removePageSnapshotPreview(id: string): Promise<void> {
  if (!validId(id)) throw new Error('Invalid page snapshot identifier')
  await serialize(async () => {
    const index = await readIndex()
    await chrome.storage.local.remove(PAGE_SNAPSHOT_CACHE_PREFIX + id)
    await replaceIndex(index.filter(entry => entry.id !== id))
  })
}
export async function cleanupPageSnapshotPreviews(): Promise<void> {
  await serialize(async () => { await cleanup(await readIndex(), Date.now()) })
}

export async function requestPageSnapshotPreview(snapshot: PageSnapshot, settings?: Partial<ExtensionSettings>): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: 'STORE_PAGE_SNAPSHOT_PREVIEW', data: { snapshot, settings } })
  if (response?.error || response?.data !== true) throw new Error(response?.error || 'Page snapshot preview could not be stored')
}
export async function loadPageSnapshotPreview(captureId: string): Promise<PageSnapshotPreview | null> {
  const response = await chrome.runtime.sendMessage({ type: 'GET_PAGE_SNAPSHOT_PREVIEW', data: { captureId } })
  if (response?.error) throw new Error(response.error)
  return response?.data ?? null
}
export async function deletePageSnapshotPreview(captureId: string): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: 'DELETE_PAGE_SNAPSHOT_PREVIEW', data: { captureId } })
  if (response?.error || response?.data !== true) throw new Error(response?.error || 'Page snapshot preview could not be deleted')
}
