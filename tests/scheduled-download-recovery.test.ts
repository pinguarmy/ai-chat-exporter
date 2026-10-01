import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../src/lib/types'
import { getDefaultScheduledExportSettings } from '../src/lib/scheduled-export'

let stored: Record<string, any>
let listener: (message: any, sender: any, respond: (response: any) => void) => void
let changes: Array<(delta: any) => void>
let downloadState: string
let api: any

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  changes = []
  downloadState = 'in_progress'
  const schedule = getDefaultScheduledExportSettings()
  schedule.enabled = true
  for (const platform of Object.keys(schedule.platforms)) schedule.platforms[platform].enabled = platform === 'chatgpt'
  const item = { id: 'a', platform: 'chatgpt', title: 'Synthetic', url: 'https://chatgpt.com/c/a' }
  stored = { settings: { ...DEFAULT_SETTINGS, scheduledExport: schedule }, conversationSnapshotSweepDoneV2: true }
  const event = { addListener: vi.fn(), removeListener: vi.fn() }
  api = {
    runtime: { id: 'test', onInstalled: event, onMessage: { addListener: (next: typeof listener) => { listener = next } } },
    storage: { onChanged: event, local: {
      get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(stored[key])])),
      set: async (values: Record<string, unknown>) => { Object.assign(stored, structuredClone(values)) },
      remove: async (keys: string | string[]) => { (Array.isArray(keys) ? keys : [keys]).forEach(key => delete stored[key]) },
    } },
    alarms: { onAlarm: event, get: (_: string, cb: (value?: unknown) => void) => cb(undefined), create: vi.fn(), clear: vi.fn() },
    tabs: { create: vi.fn(async () => ({ id: 9 })), get: async () => ({ id: 9, status: 'complete', url: 'https://chatgpt.com/' }), remove: vi.fn(), onUpdated: event,
      sendMessage: async (_: number, message: any) => {
        if (message.type === 'DETECT_PLATFORM') return { data: { platform: 'chatgpt' } }
        if (message.type === 'FETCH_ALL_CONVERSATIONS') return { data: [item], meta: { source: 'api', complete: true } }
        return { data: { ...item, source: 'api', sourceCompleteness: 'verified', messages: [{ id: 'u', role: 'user', content: 'Question' }, { id: 'r', role: 'assistant', content: 'Answer' }] } }
      },
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

it('retains timed-out files after scheduled-run cleanup, blocks duplicate runs, then reconciles a late completion', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await import('../src/background')
  const { PENDING_DOWNLOADS_KEY } = await import('../src/lib/pending-downloads')
  await message('SCHEDULED_EXPORT_RUN')
  await vi.advanceTimersByTimeAsync(0)
  expect(api.downloads.download).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(60_001)
  expect(stored.scheduledExportStatus.isRunning).toBe(false)
  expect(stored['scheduledExport-activeRun']).toBeUndefined()
  expect(stored[PENDING_DOWNLOADS_KEY]['42'].id).toBe('a')
  expect(stored['exportedIds-chatgpt']).toBeUndefined()
  await message('SCHEDULED_EXPORT_RUN')
  await vi.advanceTimersByTimeAsync(0)
  expect(api.downloads.download).toHaveBeenCalledTimes(1)
  expect(stored[PENDING_DOWNLOADS_KEY]['42'].id).toBe('a')
  expect(stored.scheduledExportStatus.lastRunError).toContain('could not be reconciled')
  downloadState = 'complete'
  changes.forEach(cb => cb({ id: 42, state: { current: 'complete' } }))
  await vi.advanceTimersByTimeAsync(0)
  expect(stored['exportedIds-chatgpt']).toEqual(['a'])
  expect(stored[PENDING_DOWNLOADS_KEY]).toEqual({})
  await message('SCHEDULED_EXPORT_RUN')
  await vi.advanceTimersByTimeAsync(0)
  expect(api.downloads.download).toHaveBeenCalledTimes(1)
})
