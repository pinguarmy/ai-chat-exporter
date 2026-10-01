import { beforeEach, expect, it, vi } from 'vitest'
import { downloadAndWait } from '../src/lib/download-completion'
import type { ExportedConversationRecord } from '../src/lib/types'

let stored: Record<string, any>
let state: string
let api: any
const record: ExportedConversationRecord = { id: 'a', platform: 'chatgpt', title: 'Synthetic', filename: 'a.md', exportedAt: 1 }

beforeEach(() => {
  vi.resetModules()
  stored = {}
  state = 'in_progress'
  api = { download: vi.fn(async () => 42), search: vi.fn(async () => [{ id: 42, state }]), cancel: vi.fn(async () => { throw new Error('cancel failed') }),
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() } }
  vi.stubGlobal('chrome', { downloads: api, storage: { local: {
    get: async (key: string) => ({ [key]: structuredClone(stored[key]) }),
    set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(stored, structuredClone(values)) }),
  } } })
})

it('retains a timed-out download through worker restart and records its late completion', async () => {
  let ledger = await import('../src/lib/pending-downloads')
  await expect(downloadAndWait({ url: 'data:text/plain,test' }, 5, api, {
    onStarted: id => ledger.retainPendingDownload(id, record),
  })).rejects.toThrow('Download completion timed out')
  expect(await ledger.reconcilePendingDownloads(true)).toBe(false)
  expect(stored[ledger.PENDING_DOWNLOADS_KEY]['42']).toEqual(record)
  expect(stored['exportedIds-chatgpt']).toBeUndefined()
  vi.resetModules()
  ledger = await import('../src/lib/pending-downloads')
  state = 'complete'
  expect(await ledger.reconcilePendingDownloads()).toBe(true)
  expect(stored['exportedIds-chatgpt']).toEqual(['a'])
  expect(stored['exportedRecord-chatgpt-a']).toEqual(record)
  expect(stored[ledger.PENDING_DOWNLOADS_KEY]).toEqual({})
})

it('keeps completed downloads reconcilable after history persistence fails', async () => {
  const ledger = await import('../src/lib/pending-downloads')
  await ledger.retainPendingDownload(42, record)
  state = 'complete'
  chrome.storage.local.set = vi.fn(async values => {
    if (values['exportedRecord-chatgpt-a']) throw new Error('storage unavailable')
    Object.assign(stored, structuredClone(values))
  })
  await expect(ledger.completePendingDownload(42)).rejects.toThrow('storage unavailable')
  expect(stored[ledger.PENDING_DOWNLOADS_KEY]['42']).toEqual(record)
  expect(stored['exportedIds-chatgpt']).toBeUndefined()
  chrome.storage.local.set = vi.fn(async values => { Object.assign(stored, structuredClone(values)) })
  expect(await ledger.reconcilePendingDownloads()).toBe(true)
  expect(stored['exportedIds-chatgpt']).toEqual(['a'])
})

it('retains records on browser lookup failure and releases interrupted downloads without history', async () => {
  const ledger = await import('../src/lib/pending-downloads')
  await ledger.retainPendingDownload(42, record)
  api.search.mockRejectedValueOnce(new Error('browser unavailable'))
  await expect(ledger.reconcilePendingDownloads()).rejects.toThrow('browser unavailable')
  expect(stored[ledger.PENDING_DOWNLOADS_KEY]['42']).toEqual(record)
  state = 'interrupted'
  expect(await ledger.reconcilePendingDownloads()).toBe(true)
  expect(stored['exportedIds-chatgpt']).toBeUndefined()
})
