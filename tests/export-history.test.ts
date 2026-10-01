import { beforeEach, expect, it, vi } from 'vitest'
import type { ExportedConversationRecord } from '../src/lib/types'

let stored: Record<string, any>
let set: ReturnType<typeof vi.fn>
let remove: ReturnType<typeof vi.fn>
const record: ExportedConversationRecord = { id: 'a', platform: 'chatgpt', title: 'Synthetic', filename: 'a.md', exportedAt: 1 }

beforeEach(() => {
  vi.resetModules()
  stored = {}
  set = vi.fn(async (values: Record<string, unknown>) => { Object.assign(stored, structuredClone(values)) })
  remove = vi.fn(async (keys: string[]) => { keys.forEach(key => delete stored[key]) })
  vi.stubGlobal('chrome', { storage: { local: {
    get: vi.fn(async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(stored[key])]))),
    set, remove,
  } } })
})

it('never publishes a dedup ID when the history record write fails and permits retry', async () => {
  const { markAsExported, getExportedIds } = await import('../src/lib/export-history')
  set.mockImplementationOnce(async values => {
    if (values['exportedRecord-chatgpt-a']) throw new Error('storage unavailable')
    Object.assign(stored, values)
  })
  await expect(markAsExported(record)).rejects.toThrow('storage unavailable')
  expect(await getExportedIds('chatgpt')).toEqual(new Set())
  expect(stored['exportedRecord-chatgpt-a']).toBeUndefined()
  await markAsExported(record)
  expect(await getExportedIds('chatgpt')).toEqual(new Set(['a']))
  expect(stored['exportedRecord-chatgpt-a']).toEqual(record)
})

it('preserves concurrent history entries and orders clear with in-flight writes', async () => {
  const { markAsExported, clearPlatformHistory, getExportedIds } = await import('../src/lib/export-history')
  await Promise.all([markAsExported(record), markAsExported({ ...record, id: 'b' })])
  expect(await getExportedIds('chatgpt')).toEqual(new Set(['a', 'b']))
  await Promise.all([markAsExported({ ...record, id: 'c' }), clearPlatformHistory(['chatgpt'])])
  expect(await getExportedIds('chatgpt')).toEqual(new Set())
  expect(stored).toEqual({})
})

it('keeps a committed export successful when retention cleanup fails', async () => {
  const { markAsExported, getExportedIds } = await import('../src/lib/export-history')
  stored['exportedIds-chatgpt'] = Array.from({ length: 500 }, (_, i) => `old-${i}`)
  remove.mockRejectedValueOnce(new Error('cleanup unavailable'))
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  await markAsExported(record)
  expect((await getExportedIds('chatgpt')).size).toBe(500)
  expect((await getExportedIds('chatgpt')).has('a')).toBe(true)
  expect(stored['exportedRecord-chatgpt-a']).toEqual(record)
  expect(warning).toHaveBeenCalledWith('[Export History] Could not remove expired history records')
  warning.mockRestore()
})
