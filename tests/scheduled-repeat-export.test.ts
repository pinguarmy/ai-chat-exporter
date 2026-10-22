import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type ExportablePlatform } from '../src/lib/types'
import { getDefaultScheduledExportSettings, PLATFORM_URLS } from '../src/lib/scheduled-export'

let stored: Record<string, any>
let listener: (message: any, sender: any, respond: (response: any) => void) => void
let alarmListener: (alarm: { name: string }) => void
let api: any
let ids: string[]
let revision: string
let listComplete: boolean
let cancelDetail: boolean
let failDownloads: boolean | 'second'
let reads: Array<{ platform: ExportablePlatform; id: string }>

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  ids = ['a', 'b', 'c', 'd']
  revision = 'First answer'
  listComplete = true
  cancelDetail = false
  failDownloads = false
  reads = []
  const schedule = getDefaultScheduledExportSettings()
  schedule.enabled = true
  schedule.platforms.chatgpt.maxPerRun = 2
  stored = {
    settings: { ...DEFAULT_SETTINGS, scheduledExport: schedule },
    conversationSnapshotSweepDoneV2: true,
    'exportedIds-chatgpt': ['a'],
    'exportedIds-claude': ['a'],
    'exportedRecord-claude-a': { id: 'a', title: 'Synthetic prior export' },
    'scheduledExport-lastRun-claude': 123,
  }
  const event = { addListener: vi.fn(), removeListener: vi.fn() }
  const tabs = new Map<number, ExportablePlatform>()
  const item = (platform: ExportablePlatform, id: string) => ({
    id, platform, title: `Synthetic ${id}`, url: `${PLATFORM_URLS[platform]}${platform === 'claude' ? 'chat' : 'c'}/${id}`,
  })
  api = {
    runtime: {
      id: 'test', onInstalled: event,
      onMessage: { addListener: (next: typeof listener) => { listener = next } },
    },
    storage: { onChanged: event, local: {
      get: async (keys: string | string[]) => Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(stored[key])])
      ),
      set: async (values: Record<string, unknown>) => { Object.assign(stored, structuredClone(values)) },
      remove: async (keys: string | string[]) => { (Array.isArray(keys) ? keys : [keys]).forEach(key => delete stored[key]) },
    } },
    alarms: {
      onAlarm: { addListener: (next: typeof alarmListener) => { alarmListener = next } },
      get: (_: string, cb: (value?: unknown) => void) => cb(undefined), create: vi.fn(), clear: vi.fn(),
    },
    tabs: {
      create: vi.fn(async ({ url }: { url: string }) => {
        const id = tabs.size + 1
        tabs.set(id, Object.keys(PLATFORM_URLS).find(platform => PLATFORM_URLS[platform] === url) as ExportablePlatform)
        return { id }
      }),
      get: async (id: number) => ({ id, status: 'complete', url: PLATFORM_URLS[tabs.get(id)!] }),
      remove: vi.fn(), onUpdated: event,
      sendMessage: async (tabId: number, message: any) => {
        const platform = tabs.get(tabId)!
        if (message.type === 'DETECT_PLATFORM') return { data: { platform } }
        if (message.type === 'FETCH_ALL_CONVERSATIONS') {
          return { data: ids.map(id => item(platform, id)), meta: { source: 'api', complete: listComplete } }
        }
        reads.push({ platform, id: message.data.id })
        if (cancelDetail) throw new Error('Export cancelled')
        return { data: {
          ...item(platform, message.data.id), source: 'api', sourceCompleteness: 'verified',
          messages: [{ id: 'u', role: 'user', content: 'Question' }, { id: 'r', role: 'assistant', content: revision }],
        } }
      },
    },
    downloads: {
      download: vi.fn(async () => {
        if (failDownloads === true || (failDownloads === 'second' && api.downloads.download.mock.calls.length === 2)) {
          throw new Error('Synthetic download failure')
        }
        return api.downloads.download.mock.calls.length
      }),
      search: vi.fn(async ({ id }: { id: number }) => [{ id, state: 'complete' }]),
      cancel: vi.fn(), onChanged: event,
    },
  }
  vi.stubGlobal('chrome', api)
})

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function run() {
  const response = await new Promise(resolve => listener({ type: 'SCHEDULED_EXPORT_RUN' }, { id: 'test' }, resolve))
  expect(response).toEqual({ data: true })
  await vi.advanceTimersByTimeAsync(15_000)
  expect(stored.scheduledExportStatus.isRunning).toBe(false)
}

it('preserves archive-once and its backlog checkpoint behavior by default', async () => {
  await import('../src/background')
  await run()
  expect(reads.map(read => read.id)).toEqual(['b', 'c'])
  expect(api.downloads.download.mock.calls[0][0]).not.toHaveProperty('conflictAction')
  expect(stored['scheduledExport-lastRun-chatgpt']).toBeUndefined()
  await run()
  expect(reads.map(read => read.id)).toEqual(['b', 'c', 'd'])
  expect(stored['scheduledExport-lastRun-chatgpt']).toBeTypeOf('number')
})

it('re-exports current details for the first N each run without clearing other platform state', async () => {
  stored.settings.scheduledExport.platforms.chatgpt.skipAlreadyExported = false
  await import('../src/background')
  await run()
  const checkpoint = stored['scheduledExport-lastRun-chatgpt']
  expect(checkpoint).toBeTypeOf('number')
  expect(reads.map(read => read.id)).toEqual(['a', 'b'])
  // A completed repeat batch must respect its daily schedule on ordinary wake-ups.
  alarmListener({ name: 'scheduled-export-check' })
  await vi.advanceTimersByTimeAsync(0)
  expect(reads).toHaveLength(2)

  revision = 'Updated answer'
  await run()
  expect(reads.map(read => read.id)).toEqual(['a', 'b', 'a', 'b'])
  const lastUrl = api.downloads.download.mock.calls.at(-1)[0].url
  expect(Buffer.from(lastUrl.split(',')[1], 'base64').toString()).toContain('Updated answer')

  // The existing provider order, rather than a cached selection, determines each batch.
  ids = ['d', 'a', 'b', 'c']
  await run()
  expect(reads.slice(-2).map(read => read.id)).toEqual(['d', 'a'])
  expect(stored['exportedIds-chatgpt']).toEqual(['a', 'b', 'd'])
  expect(stored['exportedIds-claude']).toEqual(['a'])
  expect(stored['exportedRecord-claude-a']).toEqual({ id: 'a', title: 'Synthetic prior export' })
  expect(stored['scheduledExport-lastRun-claude']).toBe(123)
})

it('opts into overwriting the same stable path with refreshed content, not filename-based skipping', async () => {
  stored.settings.filenamePattern = '{platform}-{id}'
  stored.settings.scheduledExport.platforms.chatgpt.skipAlreadyExported = false
  stored.settings.scheduledExport.platforms.chatgpt.overwriteExistingFiles = true
  await import('../src/background')
  await run()
  const firstDownload = api.downloads.download.mock.calls[0][0]
  expect(firstDownload).toMatchObject({ filename: 'chatgpt-a.md', conflictAction: 'overwrite', saveAs: false })
  expect(api.downloads.download.mock.calls[1][0]).toMatchObject({ filename: 'chatgpt-b.md', conflictAction: 'overwrite' })

  revision = 'Changed earlier answer, same chat'
  await run()
  const repeatedDownload = api.downloads.download.mock.calls[2][0]
  expect(repeatedDownload.filename).toBe(firstDownload.filename)
  expect(repeatedDownload.conflictAction).toBe('overwrite')
  const decode = (url: string) => Buffer.from(url.split(',')[1], 'base64').toString()
  expect(decode(firstDownload.url)).toContain('First answer')
  expect(decode(repeatedDownload.url)).toContain('Changed earlier answer, same chat')
  expect(stored.scheduledExportStatus.lastRunExported).toBe(2)
  expect(stored['exportedRecord-chatgpt-a'].filename).toBe('chatgpt-a.md')
})

it('limits overwrite to the selected platform and restores default conflict behavior when turned off', async () => {
  stored.settings.filenamePattern = '{platform}-{id}'
  const schedule = stored.settings.scheduledExport
  schedule.platforms.chatgpt.skipAlreadyExported = false
  schedule.platforms.chatgpt.overwriteExistingFiles = true
  schedule.platforms.claude.enabled = true
  schedule.platforms.claude.skipAlreadyExported = false
  await import('../src/background')
  await run()
  const downloads = api.downloads.download.mock.calls.map(([options]: [any]) => options)
  const chatgptDownloads = downloads.filter((options: any) => options.filename.startsWith('chatgpt-'))
  const claudeDownloads = downloads.filter((options: any) => options.filename.startsWith('claude-'))
  expect(chatgptDownloads).toHaveLength(2)
  expect(claudeDownloads).toHaveLength(4)
  for (const options of chatgptDownloads) expect(options.conflictAction).toBe('overwrite')
  for (const options of claudeDownloads) expect(options).not.toHaveProperty('conflictAction')

  stored.settings.scheduledExport.platforms.chatgpt.overwriteExistingFiles = false
  api.downloads.download.mockClear()
  await run()
  expect(api.downloads.download).toHaveBeenCalledTimes(6)
  for (const [options] of api.downloads.download.mock.calls) expect(options).not.toHaveProperty('conflictAction')
})

it.each(['request failure', 'interrupted download'])(
  'does not record an overwrite as successful after %s', async (failure) => {
    ids = ['new-chat']
    stored.settings.scheduledExport.platforms.chatgpt.skipAlreadyExported = false
    stored.settings.scheduledExport.platforms.chatgpt.overwriteExistingFiles = true
    if (failure === 'request failure') failDownloads = true
    else api.downloads.search.mockResolvedValue([{ id: 1, state: 'interrupted' }])
    await import('../src/background')
    await run()
    expect(api.downloads.download.mock.calls[0][0].conflictAction).toBe('overwrite')
    expect(stored.scheduledExportStatus.lastRunExported).toBe(0)
    expect(stored.scheduledExportStatus.lastRunFailed).toBe(1)
    expect(stored['exportedIds-chatgpt']).toEqual(['a'])
    expect(stored['exportedRecord-chatgpt-new-chat']).toBeUndefined()
  }
)

it('applies repeat mode only to the selected platform and can return to archive-once', async () => {
  const schedule = stored.settings.scheduledExport
  schedule.platforms.chatgpt.skipAlreadyExported = false
  schedule.platforms.claude.enabled = true
  await import('../src/background')
  await run()
  expect(reads.filter(read => read.platform === 'chatgpt').map(read => read.id)).toEqual(['a', 'b'])
  expect(reads.filter(read => read.platform === 'claude').map(read => read.id)).toEqual(['b', 'c', 'd'])
  stored.settings.scheduledExport.platforms.chatgpt.skipAlreadyExported = true
  reads = []
  await run()
  expect(reads).toEqual([{ platform: 'chatgpt', id: 'c' }, { platform: 'chatgpt', id: 'd' }])
})

it.each(['partial list', 'download failure', 'partial download failure'])(
  'honors repeat cadence after %s without hiding the failure', async (failure) => {
    stored.settings.scheduledExport.platforms.chatgpt.skipAlreadyExported = false
    if (failure === 'partial list') listComplete = false
    if (failure === 'download failure') failDownloads = true
    if (failure === 'partial download failure') failDownloads = 'second'
    await import('../src/background')
    await run()
    expect(stored['scheduledExport-lastRun-chatgpt']).toBeTypeOf('number')
    if (failure === 'partial list') {
      expect(stored.scheduledExportStatus.lastRunError).toContain('conversation list was incomplete')
      expect(stored.scheduledExportStatus.platformStatuses.chatgpt.state).toBe('error')
    } else {
      expect(stored.scheduledExportStatus.lastRunFailed).toBe(failDownloads === true ? 2 : 1)
      expect(stored.scheduledExportStatus.lastRunExported).toBe(failDownloads === true ? 0 : 1)
    }
    alarmListener({ name: 'scheduled-export-check' })
    await vi.advanceTimersByTimeAsync(0)
    expect(reads).toHaveLength(2)
    expect(api.downloads.download).toHaveBeenCalledTimes(2)
  }
)

it('preserves archive-once retries after a download failure', async () => {
  failDownloads = true
  await import('../src/background')
  await run()
  expect(stored['scheduledExport-lastRun-chatgpt']).toBeUndefined()
})

it('does not advance a repeat platform that gets no share of the global budget', async () => {
  const schedule = stored.settings.scheduledExport
  schedule.maxConcurrentPlatforms = 1
  schedule.maxTotalPerRun = 1
  schedule.platforms.claude.enabled = true
  schedule.platforms.claude.skipAlreadyExported = false
  const priorCheckpoint = stored['scheduledExport-lastRun-claude']
  await import('../src/background')
  await run()
  expect(reads).toEqual([{ platform: 'chatgpt', id: 'b' }])
  expect(stored['scheduledExport-lastRun-claude']).toBe(priorCheckpoint)
})

it('respects cadence after a successful repeat batch limited by the global budget', async () => {
  const schedule = stored.settings.scheduledExport
  schedule.platforms.chatgpt.skipAlreadyExported = false
  schedule.maxTotalPerRun = 1
  await import('../src/background')
  await run()
  expect(reads).toEqual([{ platform: 'chatgpt', id: 'a' }])
  expect(stored.scheduledExportStatus.lastRunExported).toBe(1)
  expect(stored['scheduledExport-lastRun-chatgpt']).toBeTypeOf('number')
  alarmListener({ name: 'scheduled-export-check' })
  await vi.advanceTimersByTimeAsync(0)
  expect(reads).toHaveLength(1)
})

it('does not advance repeat cadence after cancellation during a detail attempt', async () => {
  stored.settings.scheduledExport.platforms.chatgpt.skipAlreadyExported = false
  cancelDetail = true
  await import('../src/background')
  await run()
  expect(reads).toHaveLength(1)
  expect(stored.scheduledExportStatus.lastRunCancelled).toBe(true)
  expect(stored['scheduledExport-lastRun-chatgpt']).toBeUndefined()
})

it('does not advance repeat cadence when the user stops after the first attempt', async () => {
  stored.settings.scheduledExport.platforms.chatgpt.skipAlreadyExported = false
  await import('../src/background')
  await new Promise(resolve => listener({ type: 'SCHEDULED_EXPORT_RUN' }, { id: 'test' }, resolve))
  await vi.advanceTimersByTimeAsync(0)
  expect(reads).toHaveLength(1)
  const response = await new Promise(resolve => listener({ type: 'SCHEDULED_EXPORT_STOP' }, { id: 'test' }, resolve))
  expect(response).toEqual({ data: true })
  await vi.advanceTimersByTimeAsync(15_000)
  expect(stored.scheduledExportStatus.isRunning).toBe(false)
  expect(stored.scheduledExportStatus.lastRunCancelled).toBe(true)
  expect(stored['scheduledExport-lastRun-chatgpt']).toBeUndefined()
  expect(reads).toHaveLength(1)
})
