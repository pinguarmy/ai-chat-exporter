import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type ExportablePlatform } from '../../src/core/types'
import { getDefaultScheduledExportSettings, PLATFORM_URLS } from '../../src/core/scheduled-export'
import {
  asRecord,
  must,
  type SchedulerChromeApi,
  type DownloadFn,
  type ExtensionStorageState,
  type RuntimeMessageListener
} from '../helpers/chrome-mock'

/**
 * Behavioral guards for the MV3 worker's download and cleanup contracts. These
 * used to grep the worker's source text; they now load the real worker against
 * a mocked `chrome` and assert what it does.
 */
let stored: ExtensionStorageState
let messageListener: RuntimeMessageListener
let installedListener: (details: { reason: string }) => void
let existingCleanupAlarm: unknown
let api: SchedulerChromeApi
let createObjectURL: ReturnType<typeof vi.fn>

const event = () => ({ addListener: vi.fn(), removeListener: vi.fn() })

function buildChrome() {
  const schedule = getDefaultScheduledExportSettings()
  schedule.enabled = true
  schedule.platforms.chatgpt.maxPerRun = 1
  stored = {
    settings: { ...DEFAULT_SETTINGS, scheduledExport: schedule },
    conversationSnapshotSweepDoneV2: true
  }
  const platform: ExportablePlatform = 'chatgpt'
  api = {
    runtime: {
      id: 'test',
      getURL: (path: string) => `chrome-extension://test/${path}`,
      onInstalled: {
        addListener: (next: typeof installedListener) => {
          installedListener = next
        }
      },
      onStartup: event(),
      onMessage: {
        addListener: (next: typeof messageListener) => {
          messageListener = next
        }
      }
    },
    storage: {
      onChanged: event(),
      local: {
        get: async (keys: string | string[] | null) =>
          keys === null
            ? structuredClone(stored)
            : Object.fromEntries(
                (Array.isArray(keys) ? keys : [keys]).map(key => [
                  key,
                  structuredClone(stored[key])
                ])
              ),
        set: async (values: Record<string, unknown>) => {
          Object.assign(stored, structuredClone(values))
        },
        remove: async (keys: string | string[]) => {
          ;(Array.isArray(keys) ? keys : [keys]).forEach(key => delete stored[key])
        }
      }
    },
    alarms: {
      onAlarm: event(),
      get: vi.fn((name: string, cb: (value?: unknown) => void) =>
        cb(name === 'cleanup-exports' ? existingCleanupAlarm : undefined)
      ),
      create: vi.fn(),
      clear: vi.fn()
    },
    tabs: {
      create: vi.fn(async () => ({ id: 1 })),
      get: async (id: number) => ({ id, status: 'complete', url: PLATFORM_URLS[platform] }),
      remove: vi.fn(),
      onUpdated: event(),
      onRemoved: event(),
      sendMessage: async (_tabId: number, message: { type: string }) => {
        if (message.type === 'DETECT_PLATFORM') return { data: { platform } }
        if (message.type === 'FETCH_ALL_CONVERSATIONS') {
          return {
            data: [
              { id: 'a', platform, title: 'Synthetic a', url: `${PLATFORM_URLS[platform]}c/a` }
            ],
            meta: { source: 'api', complete: true }
          }
        }
        return {
          data: {
            id: 'a',
            platform,
            title: 'Synthetic a',
            url: `${PLATFORM_URLS[platform]}c/a`,
            source: 'api',
            sourceCompleteness: 'verified',
            messages: [
              { id: 'u', role: 'user', content: 'Question' },
              { id: 'r', role: 'assistant', content: 'Answer' }
            ]
          }
        }
      }
    },
    downloads: {
      download: vi.fn<DownloadFn>(async () => 7),
      search: vi.fn(async ({ id }: { id: number }) => [{ id, state: 'complete' }]),
      cancel: vi.fn(),
      onChanged: event(),
      onDeterminingFilename: event()
    }
  }
  vi.stubGlobal('chrome', api)
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  existingCleanupAlarm = undefined
  createObjectURL = vi.fn(() => {
    throw new Error('Blob URLs are unavailable in the MV3 service worker')
  })
  vi.stubGlobal(
    'URL',
    Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL: vi.fn() })
  )
  buildChrome()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('background download filename behavior', () => {
  it('does not register onDeterminingFilename, so requested filenames are never overridden', async () => {
    await import('../../src/background')
    await vi.advanceTimersByTimeAsync(0)

    expect(must(api.downloads.onDeterminingFilename).addListener).not.toHaveBeenCalled()
    // The only downloads listener is the reconciliation hook on onChanged.
    expect(must(api.downloads.onChanged).addListener).toHaveBeenCalledTimes(1)
  })

  it('downloads scheduled Markdown through a data: URL and never creates a blob URL', async () => {
    await import('../../src/background')
    const response = await new Promise(resolve =>
      messageListener({ type: 'SCHEDULED_EXPORT_RUN' }, { id: 'test' }, resolve)
    )
    expect(response).toEqual({ data: true })
    await vi.advanceTimersByTimeAsync(15_000)

    expect(api.downloads.download).toHaveBeenCalledTimes(1)
    const request = api.downloads.download.mock.calls[0][0]
    expect(request.url).toMatch(/^data:text\/markdown/)
    expect(Buffer.from(request.url.split(',')[1], 'base64').toString()).toContain('Answer')
    expect(request.filename).toMatch(/\.md$/)
    expect(createObjectURL).not.toHaveBeenCalled()
  })
})

describe('snapshot cleanup alarm and expiry', () => {
  it('creates the cleanup alarm on first install', async () => {
    await import('../../src/background')
    installedListener({ reason: 'install' })
    await vi.advanceTimersByTimeAsync(0)

    expect(api.alarms.create).toHaveBeenCalledWith('cleanup-exports', { periodInMinutes: 60 })
    expect(stored.settings).toEqual(DEFAULT_SETTINGS)
  })

  it('does not reset the install state on updates', async () => {
    await import('../../src/background')
    api.alarms.create.mockClear()
    installedListener({ reason: 'update' })
    await vi.advanceTimersByTimeAsync(0)

    expect(api.alarms.create).not.toHaveBeenCalledWith('cleanup-exports', expect.anything())
  })

  it('recreates a missing cleanup alarm at worker start and keeps an existing one', async () => {
    await import('../../src/background')
    expect(api.alarms.get).toHaveBeenCalledWith('cleanup-exports', expect.any(Function))
    expect(api.alarms.create).toHaveBeenCalledWith('cleanup-exports', { periodInMinutes: 60 })

    vi.resetModules()
    existingCleanupAlarm = { name: 'cleanup-exports', periodInMinutes: 60 }
    api.alarms.create.mockClear()
    await import('../../src/background')
    await vi.advanceTimersByTimeAsync(0)
    expect(api.alarms.create).not.toHaveBeenCalledWith('cleanup-exports', expect.anything())
  })

  it('stamps stored preview conversations with an expiry timestamp', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    await import('../../src/background')
    const conversation = {
      id: 'preview-1',
      platform: 'chatgpt',
      title: 'Synthetic',
      url: `${PLATFORM_URLS.chatgpt}c/preview-1`,
      messages: [{ id: 'u', role: 'user', content: 'Hello' }]
    }
    const response = await new Promise(resolve =>
      messageListener(
        { type: 'STORE_PREVIEW_SNAPSHOT', data: conversation },
        { id: 'test' },
        resolve
      )
    )

    expect(response).toEqual({ data: true })
    expect(asRecord(stored['conversation-preview-1']).timestamp).toBe(Date.now())
  })
})
