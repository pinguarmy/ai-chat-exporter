import { vi, type Mock } from 'vitest'
import type { ExtensionSettings, ScheduledExportStatus } from '../../src/core/types'

/**
 * Shared typed helpers for tests that stub the `chrome` extension API.
 *
 * The real `chrome` namespace is huge and tests only ever provide the handful
 * of members the code under test touches, so stubs are typed as loose records
 * of `unknown` rather than as `typeof chrome`. Consumers narrow what they read.
 */

/** Backing store for a fake `chrome.storage.*` area. */
export type StorageData = Record<string, unknown>

/** A partial `chrome` object. */
export type ChromeStub = Record<string, unknown>

/** Signature of a `chrome.runtime.onMessage` listener. */
export type RuntimeMessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void
) => boolean | void

/**
 * Typed access to `globalThis.chrome` for tests that install or amend a stub
 * by assignment (`globalWithChrome.chrome = { ... }`).
 */
export const globalWithChrome = globalThis as unknown as { chrome: ChromeStub }

/** Current stub on `globalThis`, typed loosely. */
export function currentChrome(): ChromeStub {
  return globalWithChrome.chrome
}

/** Read an own property of an unknown value as a record, for fixture navigation. */
export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new TypeError('Expected an object')
  return value as Record<string, unknown>
}

/** Narrow an unknown value to an array, failing loudly in the test otherwise. */
export function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TypeError('Expected an array')
  return value
}

/**
 * In-memory `chrome.storage` area over `data`. Mirrors the promise API subset
 * used by the extension: `get(null | key | keys)`, `set`, `remove`. With
 * `clone: true`, values are structured-cloned on the way in and out so tests
 * cannot accidentally share object identity with the code under test.
 */
export function createStorageArea(data: StorageData, options: { clone?: boolean } = {}) {
  const copy = <T>(value: T): T => (options.clone ? structuredClone(value) : value)
  return {
    get: vi.fn(async (keys?: string | string[] | null) => {
      if (keys === null || keys === undefined) return { ...data }
      const wanted = Array.isArray(keys) ? keys : [keys]
      const result: StorageData = {}
      for (const key of wanted) if (key in data) result[key] = copy(data[key])
      return result
    }),
    set: vi.fn(async (items: StorageData) => {
      Object.assign(data, copy(items))
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]
    })
  }
}

/** Arguments of `chrome.downloads.download`, as far as tests inspect them. */
export interface DownloadRequest {
  url: string
  filename?: string
  conflictAction?: string
  saveAs?: boolean
}

/** Any callable, mock or plain; assertable through `expect(...)`. */
export type AnyFn = (...args: never[]) => unknown

export type DownloadFn = (options: DownloadRequest) => Promise<number>

/**
 * Subset of a mocked `chrome` API object that background tests inspect after
 * the fact. `download` is typed so `mock.calls[n][0]` is a `DownloadRequest`;
 * the rest only need to be assertable via `expect(...)`.
 */
export interface ChromeApiMock extends ChromeStub {
  downloads?: ChromeStub & {
    download: Mock<DownloadFn>
    search?: Mock
    cancel?: Mock
    onChanged?: { addListener: AnyFn; removeListener?: AnyFn }
    onDeterminingFilename?: { addListener: AnyFn; removeListener?: AnyFn }
  }
  alarms?: ChromeStub & { create: Mock; get?: AnyFn; clear?: AnyFn }
  tabs?: ChromeStub & { remove?: AnyFn; create?: AnyFn }
}

/** Settings and status records the background worker keeps in `chrome.storage.local`. */
export interface ExtensionStorageState extends StorageData {
  settings?: ExtensionSettings
  scheduledExportStatus?: ScheduledExportStatus
}

/** Envelope the background worker and parser content scripts answer with. */
export interface RuntimeResponse<T = unknown> {
  data?: T
  error?: string
  meta?: Record<string, unknown>
}

/**
 * `vi.mocked(chrome.storage.local.get)` typed for the promise form the code
 * under test uses. The `chrome.storage` typings expose the callback overload
 * first, which makes `mockResolvedValue` reject any realistic payload.
 */
export function storageGetMock() {
  return vi.mocked(chrome.storage.local.get) as unknown as Mock<(keys?: unknown) => Promise<StorageData>>
}
