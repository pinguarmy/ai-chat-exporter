import { beforeEach, it, expect, vi } from 'vitest'
let storage: Record<string, any>
let api: any
beforeEach(() => {
  vi.resetModules()
  storage = {}
  api = { storage: { local: { get: async (key: string) => ({ [key]: storage[key] }), set: async (v: any) => { Object.assign(storage, structuredClone(v)) } } }, runtime: { getManifest: () => ({ version: 'test' }) }, tabs: { remove: vi.fn() }, downloads: { download: vi.fn(async () => 7), search: vi.fn(async () => [{ state: 'complete' }]), cancel: vi.fn() } }
  vi.stubGlobal('chrome', api)
})
const item = { id: 'c', title: 'Synthetic', platform: 'chatgpt' as const, url: 'https://chatgpt.com/c/c' }
it('finishes without a popup, snapshots settings, and records only completed downloads', async () => {
  const { initializeManualJobs, startManualJob, MANUAL_JOB_KEY } = await import('../src/lib/manual-export-job')
  const { DEFAULT_SETTINGS } = await import('../src/lib/types')
  const record = vi.fn(async () => {})
  await initializeManualJobs({ record, read: async () => ({ data: { ...item, source: 'api', sourceCompleteness: 'verified', messages: [{ id: 'a', role: 'assistant', content: 'answer' }] } }) })
  await startManualJob([item], DEFAULT_SETTINGS)
  await vi.waitFor(() => expect(storage[MANUAL_JOB_KEY].status).toBe('done'))
  expect(record).toHaveBeenCalledTimes(1)
  expect(storage[MANUAL_JOB_KEY].completedIds).toEqual(['c'])
  expect(api.downloads.download).toHaveBeenCalledTimes(1)
})
it('reconciles an already completed download on restart without downloading it again', async () => {
  const { initializeManualJobs, startManualJob, MANUAL_JOB_KEY } = await import('../src/lib/manual-export-job')
  const { DEFAULT_SETTINGS } = await import('../src/lib/types')
  storage[MANUAL_JOB_KEY] = { id: 'old', status: 'running', items: [item], settings: DEFAULT_SETTINGS, completedIds: [], failed: [], updatedAt: 0, activeTabId: 9, activeDownload: { id: 7, item, filename: 'x.md' } }
  const record = vi.fn(async () => {})
  await initializeManualJobs({ record, read: vi.fn() })
  expect(storage[MANUAL_JOB_KEY].status).toBe('interrupted')
  expect(storage[MANUAL_JOB_KEY].completedIds).toEqual(['c'])
  expect(api.tabs.remove).toHaveBeenCalledWith(9)
  await startManualJob([], DEFAULT_SETTINGS, true)
  await vi.waitFor(() => expect(storage[MANUAL_JOB_KEY].status).toBe('done'))
  expect(api.downloads.download).not.toHaveBeenCalled()
  expect(record).toHaveBeenCalledTimes(1)
})
