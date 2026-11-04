/**
 * Workspace session hand-off
 *
 * Opening the full export workspace reloads the popup component in a new tab,
 * which would otherwise lose the in-memory popup state (tab mode, format,
 * selection, search, quick-selection rules, and unsaved session settings).
 * This module passes that UI state through a short-lived, single-use storage
 * record; the workspace URL only carries the random hand-off id.
 *
 * Privacy contract: the payload never contains conversation content — only
 * conversation ids, UI choices, and an explicit whitelist of export/session
 * settings keys. The record is bound to the source tab, expires after a short
 * TTL, and is deleted on first read (consume-once), so closing the popup does
 * not lose the hand-off and a stale or replayed link cannot resurrect an old
 * selection. Reads and sweeps only ever touch this module's own keys — the
 * session area also holds provider credentials, which are never enumerated.
 *
 * Storage is chrome.storage.session only: it is memory-backed, survives a
 * popup close, and disappears with the browser session. When the session area
 * does not exist or rejects (access level not granted, older browser), this
 * module fails loudly instead of silently persisting UI state to disk.
 */

import type { ExportFormat, ExtensionSettings } from './types'

/** UI state carried from the popup into the full-page workspace. */
export interface WorkspaceSessionPayload {
  /** Tab the hand-off is bound to; a mismatch means the link was reused elsewhere. */
  sourceTabId?: number
  tabMode: 'current' | 'bulk'
  format: ExportFormat
  selectedIds: string[]
  searchQuery: string
  bulkFromDate: string
  bulkToDate: string
  bulkSelectionLimit: string
  /** Unsaved session-only export options (whitelisted keys only), never stored defaults. */
  settingsPatch: Partial<ExtensionSettings>
}

/** Hand-offs are transient UI state; ten minutes covers opening the workspace. */
export const WORKSPACE_SESSION_TTL_MS = 10 * 60 * 1000

/** Thrown when chrome.storage.session is missing or rejects in this context. */
export const WORKSPACE_SESSION_STORAGE_UNAVAILABLE = 'Workspace session storage is unavailable'

const KEY_PREFIX = 'workspaceSession:'
/** Tracks only our own hand-off ids so sweeps never enumerate foreign keys. */
const INDEX_KEY = 'workspaceSession:index'
const MAX_SESSION_ID_LENGTH = 64
/** Bound the index so repeated hand-offs cannot grow it without limit. */
const MAX_INDEX_ENTRIES = 20

/**
 * Session-only export options that may cross the hand-off. Stored defaults
 * (defaultFormat), identity settings saved immediately (theme/locale), and
 * complex subsystems with their own persistence and grants (scheduledExport,
 * recovery retention/expanded storage) are deliberately excluded.
 */
const SETTINGS_PATCH_KEYS = [
  'archiveBundle',
  'includeToolTrace',
  'includeRawPayload',
  'safeShare',
  'includeMetadata',
  'includeCodeBlocks',
  'includeImages',
  'filenamePattern',
  'downloadFolder',
  'customFolderName',
  'askForSaveLocation',
  'skipAlreadyExported',
  'exportArtifacts',
  'includeUploadedFiles',
  'referenceExportMode',
  'pdfStyle',
  'pdfTextLayer',
  'assistantDisplayName',
  'showMessageTimestamps',
] as const satisfies ReadonlyArray<keyof ExtensionSettings>

/** Minimal structural subset of a storage area; avoids overload-resolution surprises from Pick<StorageArea>. */
type WorkspaceSessionArea = {
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
  remove(keys: string | string[]): Promise<void>
}

interface StoredWorkspaceSession {
  createdAt: number
  payload: WorkspaceSessionPayload
}

export type ConsumeWorkspaceSessionResult =
  | { ok: true; payload: WorkspaceSessionPayload }
  | { ok: false; reason: 'missing' | 'expired' | 'tab-mismatch' }

let areaPromise: Promise<WorkspaceSessionArea> | null = null

/** Test hook: re-probe the storage area after swapping chrome mocks. */
export function resetWorkspaceSessionAreaForTests(): void {
  areaPromise = null
}

/**
 * Resolve the session area once per context, probing it like the Gemini
 * credential store does: the property can exist while every call rejects
 * (access level not granted, older browser), so a cheap read decides. There
 * is deliberately no on-disk fallback — callers surface the failure.
 */
function resolveArea(): Promise<WorkspaceSessionArea> {
  if (!areaPromise) {
    areaPromise = (async () => {
      const session = chrome.storage.session as WorkspaceSessionArea | undefined
      if (!session) throw new Error(WORKSPACE_SESSION_STORAGE_UNAVAILABLE)
      try {
        await session.get(INDEX_KEY)
      } catch {
        throw new Error(WORKSPACE_SESSION_STORAGE_UNAVAILABLE)
      }
      return session
    })()
    // A failed probe must not be cached forever: a later browser context may
    // grant access, and each attempt should re-probe.
    areaPromise.catch(() => { areaPromise = null })
  }
  return areaPromise
}

/** Keep only whitelisted export/session option keys; drop anything unknown. */
function pickSettingsPatch(patch: Partial<ExtensionSettings> | undefined): Partial<ExtensionSettings> {
  const picked: Partial<ExtensionSettings> = {}
  if (!patch || typeof patch !== 'object') return picked
  for (const key of SETTINGS_PATCH_KEYS) {
    if (patch[key] !== undefined) {
      ;(picked as Record<string, unknown>)[key] = patch[key]
    }
  }
  return picked
}

/** Keep only the declared UI fields; never trust or persist extra content. */
function sanitizePayload(payload: WorkspaceSessionPayload): WorkspaceSessionPayload {
  return {
    ...(typeof payload?.sourceTabId === 'number' ? { sourceTabId: payload.sourceTabId } : {}),
    tabMode: payload?.tabMode === 'bulk' ? 'bulk' : 'current',
    format: payload?.format === 'pdf' ? 'pdf' : 'markdown',
    selectedIds: [...new Set((Array.isArray(payload?.selectedIds) ? payload.selectedIds : [])
      .filter((id): id is string => typeof id === 'string' && id.length > 0))].slice(0, 500),
    searchQuery: String(payload?.searchQuery ?? '').slice(0, 200),
    bulkFromDate: String(payload?.bulkFromDate ?? ''),
    bulkToDate: String(payload?.bulkToDate ?? ''),
    bulkSelectionLimit: String(payload?.bulkSelectionLimit ?? ''),
    settingsPatch: pickSettingsPatch(payload?.settingsPatch),
  }
}

async function readIndex(area: WorkspaceSessionArea): Promise<string[]> {
  const value = (await area.get(INDEX_KEY))[INDEX_KEY]
  if (!Array.isArray(value)) return []
  return value.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= MAX_SESSION_ID_LENGTH)
}

/**
 * Record the new id and sweep expired hand-offs, reading only the keys our
 * own index names — never a whole-area enumeration. Best-effort: the create
 * itself has already succeeded, and consume still enforces the TTL per record.
 */
async function indexAndSweep(area: WorkspaceSessionArea, id: string, now: number): Promise<void> {
  try {
    const ids = await readIndex(area)
    const records = ids.length > 0 ? await area.get(ids.map(oldId => KEY_PREFIX + oldId)) : {}
    const alive: string[] = []
    const staleKeys: string[] = []
    for (const oldId of ids) {
      const record = records[KEY_PREFIX + oldId] as StoredWorkspaceSession | undefined
      if (record && typeof record.createdAt === 'number' && now - record.createdAt <= WORKSPACE_SESSION_TTL_MS) {
        alive.push(oldId)
      } else {
        staleKeys.push(KEY_PREFIX + oldId)
      }
    }
    alive.push(id)
    if (staleKeys.length > 0) await area.remove(staleKeys)
    await area.set({ [INDEX_KEY]: alive.slice(-MAX_INDEX_ENTRIES) })
  } catch {
    // Index maintenance is best-effort; see consume's per-record TTL check.
  }
}

/** Store the payload under a random id and return that id for the workspace URL. */
export async function createWorkspaceSession(payload: WorkspaceSessionPayload): Promise<string> {
  const area = await resolveArea()
  const now = Date.now()
  const id = crypto.randomUUID()
  const stored: StoredWorkspaceSession = { createdAt: now, payload: sanitizePayload(payload) }
  await area.set({ [KEY_PREFIX + id]: stored })
  void indexAndSweep(area, id, now)
  return id
}

/**
 * Read and immediately delete a hand-off. Deletion happens before validation
 * so every hand-off is consumed exactly once, including invalid or expired
 * ones. A deletion failure rejects loudly and the hand-off is NOT consumed —
 * silently swallowing it would both hide the failure and allow a replay.
 */
export async function consumeWorkspaceSession(
  id: string,
  sourceTabId?: number
): Promise<ConsumeWorkspaceSessionResult> {
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_SESSION_ID_LENGTH || !/^[\w-]+$/.test(id)) {
    return { ok: false, reason: 'missing' }
  }
  const area = await resolveArea()
  const key = KEY_PREFIX + id
  const stored = (await area.get(key))[key] as StoredWorkspaceSession | undefined
  // Consume-once: delete before validation, and let a delete failure throw.
  await area.remove(key)
  // Index cleanup is housekeeping only; it must not mask the consume result.
  void readIndex(area)
    .then(ids => (ids.includes(id) ? area.set({ [INDEX_KEY]: ids.filter(entry => entry !== id) }) : undefined))
    .catch(() => undefined)
  if (!stored || typeof stored.createdAt !== 'number' || !stored.payload || typeof stored.payload !== 'object') {
    return { ok: false, reason: 'missing' }
  }
  if (Date.now() - stored.createdAt > WORKSPACE_SESSION_TTL_MS) {
    return { ok: false, reason: 'expired' }
  }
  const boundTab = stored.payload.sourceTabId
  // A bound hand-off requires the caller to name the same tab; an unnamed
  // caller (no sourceTab in the URL) cannot satisfy the binding.
  if (typeof boundTab === 'number' && boundTab !== sourceTabId) {
    return { ok: false, reason: 'tab-mismatch' }
  }
  return { ok: true, payload: sanitizePayload(stored.payload) }
}
