import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../src/lib/types'
import { getDefaultScheduledExportSettings } from '../src/lib/scheduled-export'

let stored: Record<string, any>
let listener: (message: any, sender: any, respond: (response: any) => void) => void
let changes: Array<(delta: any) => void>
let downloadState: string
let api: any
let alarmListener: (alarm: { name: string }) => Promise<void>
let items: any[]

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 23, 10))
  changes = []
  downloadState = 'in_progress'
  const schedule = getDefaultScheduledExportSettings()
  schedule.enabled = true
  for (const platform of Object.keys(schedule.platforms)) schedule.platforms[platform].enabled = platform === 'chatgpt'
  const item = { id: 'a', platform: 'chatgpt', title: 'Synthetic', url: 'https://chatgpt.com/c/a' }
  items = [item]
  schedule.allowedDays = [1, 2, 3, 4, 5]
  schedule.dailyWindow = { start: '09:00', end: '17:00' }
  stored = { settings: { ...DEFAULT_SETTINGS, scheduledExport: schedule }, conversationSnapshotSweepDoneV2: true }
  const event = { addListener: vi.fn(), removeListener: vi.fn() }
  api = {
    runtime: { id: 'test', onInstalled: event, onMessage: { addListener: (next: typeof listener) => { listener = next } } },
    storage: { onChanged: event, local: {
      get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(stored[key])])),
      set: async (values: Record<string, unknown>) => { Object.assign(stored, structuredClone(values)) },
      remove: async (keys: string | string[]) => { (Array.isArray(keys) ? keys : [keys]).forEach(key => delete stored[key]) },
    } },
    alarms: { onAlarm: { addListener: (next: typeof alarmListener) => { alarmListener = next } }, get: (_: string, cb: (value?: unknown) => void) => cb(undefined), create: vi.fn(), clear: vi.fn() },
    tabs: { create: vi.fn(async () => ({ id: 9 })), get: async () => ({ id: 9, status: 'complete', url: 'https://chatgpt.com/' }), remove: vi.fn(), onUpdated: event,
      sendMessage: vi.fn(async (_: number, message: any) => {
        if (message.type === 'DETECT_PLATFORM') return { data: { platform: 'chatgpt' } }
        if (message.type === 'FETCH_ALL_CONVERSATIONS') return { data: items, meta: { source: 'api', complete: true } }
        return { data: { ...item, id: message.data?.id ?? item.id, source: 'api', sourceCompleteness: 'verified', messages: [{ id: 'u', role: 'user', content: 'Question' }, { id: 'r', role: 'assistant', content: 'Answer' }] } }
      }),
    },
    downloads: { download: vi.fn(async () => 42), search: vi.fn(async () => [{ id: 42, state: downloadState }]), cancel: vi.fn(async () => { throw new Error('cancel failed') }),
      onChanged: { addListener: (cb: (delta: any) => void) => changes.push(cb), removeListener: (cb: (delta: any) => void) => { changes = changes.filter(value => value !== cb) } },
    },
  }
  vi.stubGlobal('chrome', api)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

async function message(type: string): Promise<any> {
  return new Promise(resolve => listener({ type }, { id: 'test' }, resolve))
}


async function alarm() {
  await alarmListener({ name: 'scheduled-export-check' })
  await vi.advanceTimersByTimeAsync(0)
}

it('does not open provider tabs, download or advance checkpoints outside the window or with no weekdays', async () => {
  await import('../src/background')
  vi.setSystemTime(new Date(2026, 9, 24, 12))
  await alarm()
  expect(api.tabs.create).not.toHaveBeenCalled()
  vi.setSystemTime(new Date(2026, 9, 26, 17, 1))
  await alarm()
  expect(api.tabs.create).not.toHaveBeenCalled()
  stored.settings.scheduledExport.allowedDays = []
  vi.setSystemTime(new Date(2026, 9, 26, 12))
  await alarm()
  expect(api.tabs.create).not.toHaveBeenCalled()
  expect(api.downloads.download).not.toHaveBeenCalled()
  expect(stored['scheduledExport-lastRun-chatgpt']).toBeUndefined()
})

it('starts at the inclusive boundary, keeps per-platform frequencies and does not replay missed intervals', async () => {
  downloadState = 'complete'
  stored.settings.scheduledExport.platforms.chatgpt.frequency = 'hourly'
  await import('../src/background')
  vi.setSystemTime(new Date(2026, 9, 26, 9))
  await alarm()
  expect(api.downloads.download).toHaveBeenCalledTimes(1)
  expect(stored['scheduledExport-lastRun-chatgpt']).toBe(Date.now())
  await alarm()
  expect(api.tabs.create).toHaveBeenCalledTimes(1)
  expect(api.downloads.download).toHaveBeenCalledTimes(1)
})

it('allows manual Run now outside days/hours even when the automatic schedule is disabled', async () => {
  downloadState = 'complete'
  stored.settings.scheduledExport.enabled = false
  stored.settings.scheduledExport.allowedDays = []
  await import('../src/background')
  vi.setSystemTime(new Date(2026, 9, 24, 23))
  await message('SCHEDULED_EXPORT_RUN')
  await vi.advanceTimersByTimeAsync(0)
  expect(api.downloads.download).toHaveBeenCalledTimes(1)
  expect(stored.scheduledExportStatus.lastRunExported).toBe(1)
})

it('lets an active download finish but starts no next item or provider after the end boundary', async () => {
  items.push({ ...items[0], id: 'b' })
  stored.settings.scheduledExport.platforms.claude.enabled = true
  stored.settings.scheduledExport.maxConcurrentPlatforms = 1
  await import('../src/background')
  vi.setSystemTime(new Date(2026, 9, 23, 17, 0, 59))
  await alarm()
  expect(api.downloads.download).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(3001)
  expect(api.downloads.download).toHaveBeenCalledTimes(1)
  const detailCalls = api.tabs.sendMessage.mock.calls.filter(([, message]: any[]) => message.type === 'FETCH_CONVERSATION_DETAIL')
  expect(detailCalls).toHaveLength(1)
  downloadState = 'complete'
  changes.forEach(cb => cb({ id: 42, state: { current: 'complete' } }))
  await vi.advanceTimersByTimeAsync(0)
  expect(stored['exportedIds-chatgpt']).toEqual(['a'])
  expect(api.downloads.cancel).not.toHaveBeenCalled()
  expect(api.tabs.create).toHaveBeenCalledTimes(1)
  expect(stored['scheduledExport-lastRun-chatgpt']).toBeUndefined()
  expect(stored['scheduledExport-lastRun-claude']).toBeUndefined()
  expect(stored.scheduledExportStatus).toMatchObject({ isRunning: false, lastRunWindowClosed: true, lastRunExported: 1, lastRunFailed: 0 })
})

it('does not launch a download when an in-flight detail read resolves after the window closes', async () => {
  const send = api.tabs.sendMessage.getMockImplementation()
  api.tabs.sendMessage.mockImplementation(async (id: number, request: any) => {
    if (request.type === 'FETCH_CONVERSATION_DETAIL') vi.setSystemTime(new Date(2026, 9, 23, 17, 1))
    return send(id, request)
  })
  await import('../src/background')
  vi.setSystemTime(new Date(2026, 9, 23, 17, 0, 59))
  await alarm()
  expect(api.downloads.download).not.toHaveBeenCalled()
  expect(stored['scheduledExport-lastRun-chatgpt']).toBeUndefined()
  expect(stored.scheduledExportStatus).toMatchObject({ isRunning: false, lastRunWindowClosed: true, lastRunExported: 0, lastRunFailed: 0 })
})

it('does not launch a page fallback when direct detail becomes incomplete after the window closes', async () => {
  const send = api.tabs.sendMessage.getMockImplementation()
  api.tabs.sendMessage.mockImplementation(async (id: number, request: any) => {
    if (request.type === 'FETCH_CONVERSATION_DETAIL') {
      vi.setSystemTime(new Date(2026, 9, 23, 17, 1))
      return { data: null }
    }
    return send(id, request)
  })
  await import('../src/background')
  vi.setSystemTime(new Date(2026, 9, 23, 17, 0, 59))
  await alarm()
  expect(api.tabs.create).toHaveBeenCalledTimes(1)
  expect(api.downloads.download).not.toHaveBeenCalled()
  expect(stored['scheduledExport-lastRun-chatgpt']).toBeUndefined()
  expect(stored.scheduledExportStatus).toMatchObject({ isRunning: false, lastRunWindowClosed: true, lastRunFailed: 0 })
})

it('does not retry an empty conversation list after the window closes', async () => {
  items = []
  await import('../src/background')
  vi.setSystemTime(new Date(2026, 9, 23, 17, 0, 59))
  await alarm()
  await vi.advanceTimersByTimeAsync(1001)
  const listCalls = api.tabs.sendMessage.mock.calls.filter(([, request]: any[]) => request.type === 'FETCH_ALL_CONVERSATIONS')
  expect(listCalls).toHaveLength(1)
  expect(api.downloads.download).not.toHaveBeenCalled()
  expect(stored['scheduledExport-lastRun-chatgpt']).toBeUndefined()
  expect(stored.scheduledExportStatus).toMatchObject({ isRunning: false, lastRunWindowClosed: true, lastRunFailed: 0 })
})

it('sets minute wake-ups for a narrow window without changing hourly export frequency, with unchanged platform frequency', async () => {
  stored.settings.scheduledExport.checkIntervalMinutes = 60
  stored.settings.scheduledExport.platforms.chatgpt.frequency = 'hourly'
  stored.settings.scheduledExport.dailyWindow = { start: '09:01', end: '09:02' }
  downloadState = 'complete'
  await import('../src/background')
  await vi.advanceTimersByTimeAsync(0)
  expect(api.alarms.create).toHaveBeenCalledWith('scheduled-export-check', { periodInMinutes: 1 })
  vi.setSystemTime(new Date(2026, 9, 26, 9, 0, 30))
  await alarm()
  expect(api.downloads.download).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(60_000)
  await alarm()
  expect(api.downloads.download).toHaveBeenCalledTimes(1)
  expect(stored.settings.scheduledExport.platforms.chatgpt.frequency).toBe('hourly')
  await vi.advanceTimersByTimeAsync(60_000)
  await alarm()
  expect(api.downloads.download).toHaveBeenCalledTimes(1)
})

it('anchors actual automatic scans to start+interval across late wakes and settings saves', async () => {
  Object.assign(stored.settings.scheduledExport.platforms.chatgpt, { frequency: 'custom', intervalMinutes: 120 })
  downloadState = 'complete'
  await import('../src/background')
  vi.setSystemTime(new Date(2026, 9, 26, 9, 7))
  await alarm()
  expect(api.tabs.create).toHaveBeenCalledTimes(1)
  stored.settings.scheduledExport = structuredClone(stored.settings.scheduledExport)
  vi.setSystemTime(new Date(2026, 9, 26, 10, 59))
  await alarm()
  expect(api.tabs.create).toHaveBeenCalledTimes(1)
  vi.setSystemTime(new Date(2026, 9, 26, 11, 0, 20))
  await alarm()
  expect(api.tabs.create).toHaveBeenCalledTimes(2)
  await alarm()
  expect(api.tabs.create).toHaveBeenCalledTimes(2)
  expect(stored['scheduledExport-lastRun-chatgpt']).toBe(new Date(2026, 9, 26, 11, 0, 20).getTime())
})

it('runs an aligned final slot at 17:00:20 but never first-starts it at 17:01', async () => {
  Object.assign(stored.settings.scheduledExport.platforms.chatgpt, { frequency: 'custom', intervalMinutes: 120 })
  stored['scheduledExport-lastRun-chatgpt'] = new Date(2026, 9, 23, 15, 20).getTime()
  downloadState = 'complete'
  await import('../src/background')
  vi.setSystemTime(new Date(2026, 9, 23, 17, 0, 20))
  await alarm()
  expect(api.downloads.download).toHaveBeenCalledTimes(1)
  vi.setSystemTime(new Date(2026, 9, 26, 17, 1))
  await alarm()
  expect(api.tabs.create).toHaveBeenCalledTimes(1)
})

it('checkpoints a queued provider at its own start slot, not the earlier queue start', async () => {
  const config = stored.settings.scheduledExport
  config.maxConcurrentPlatforms = 1
  config.platforms.chatgpt.frequency = 'hourly'
  config.platforms.claude = { ...config.platforms.chatgpt, enabled: true }
  const send = api.tabs.sendMessage.getMockImplementation()
  api.tabs.create.mockImplementation(async ({ url }: { url: string }) => ({ id: url.includes('claude') ? 10 : 9 }))
  api.tabs.get = async (id: number) => ({ id, status: 'complete', url: id === 10 ? 'https://claude.ai/' : 'https://chatgpt.com/' })
  api.tabs.sendMessage.mockImplementation(async (id: number, request: any) => {
    if (id === 10 && request.type === 'DETECT_PLATFORM') return { data: { platform: 'claude' } }
    if (id === 10 && request.type === 'FETCH_ALL_CONVERSATIONS') return { data: [], meta: { source: 'api', complete: true } }
    return send(id, request)
  })
  await import('../src/background')
  vi.setSystemTime(new Date(2026, 9, 26, 9, 59))
  await alarm()
  expect(api.tabs.create).toHaveBeenCalledTimes(1)
  vi.setSystemTime(new Date(2026, 9, 26, 10, 5))
  downloadState = 'complete'
  changes.forEach(cb => cb({ id: 42, state: { current: 'complete' } }))
  await vi.advanceTimersByTimeAsync(2100)
  expect(api.tabs.create).toHaveBeenCalledTimes(2)
  expect(stored['scheduledExport-lastRun-chatgpt']).toBe(new Date(2026, 9, 26, 9, 59).getTime())
  expect(stored['scheduledExport-lastRun-claude']).toBe(new Date(2026, 9, 26, 10, 5).getTime())
  vi.setSystemTime(new Date(2026, 9, 26, 10, 6))
  await alarm()
  expect(api.tabs.create.mock.calls.filter(([tab]: any) => tab.url.includes('claude'))).toHaveLength(1)
})
