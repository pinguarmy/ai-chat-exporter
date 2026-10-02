import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPageSnapshot } from '../src/lib/page-snapshot'

let data: Record<string, any>
let area: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }
beforeEach(() => {
  vi.resetModules()
  data = {}
  area = {
    get: vi.fn(async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in data).map(key => [key, data[key]]))),
    set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(data, structuredClone(items)) }),
    remove: vi.fn(async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key] }),
  }
  vi.stubGlobal('chrome', { storage: { local: area } })
})
const snapshot = (id: string, content = 'Synthetic text') => buildPageSnapshot({ id: 'local-session', title: 'Synthetic', url: 'https://gemini.google.com/app', platform: 'gemini', messages: [{ id: 'u', role: 'user', content }] }, 'unknown', Date.now(), id)

describe('immutable page snapshot preview cache', () => {
  it('keeps two captures of the same conversation separate and never overwrites a capture', async () => {
    const cache = await import('../src/lib/page-snapshot-cache')
    await cache.storePageSnapshotPreview(snapshot('capture-a', 'A'))
    await cache.storePageSnapshotPreview(snapshot('capture-b', 'B'))
    await cache.storePageSnapshotPreview(snapshot('capture-a', 'Changed'))
    expect((await cache.readPageSnapshotPreview('capture-a'))?.snapshot.conversation.messages[0].content).toBe('A')
    expect((await cache.readPageSnapshotPreview('capture-b'))?.snapshot.conversation.messages[0].content).toBe('B')
    expect(await cache.readPageSnapshotPreview('missing')).toBeNull()
    expect(area.get.mock.calls.some(([key]) => key === null)).toBe(false)
  })
  it('refuses to reuse a non-share preview after privacy options change', async () => {
    const cache = await import('../src/lib/page-snapshot-cache')
    const capture = snapshot('immutable-privacy', 'api_key=sk-abcdefghijklmnopqrstuvwxyz')
    await cache.storePageSnapshotPreview(capture, { safeShare: false })
    await expect(cache.storePageSnapshotPreview(capture, { safeShare: true })).rejects.toThrow('Recapture')
    expect((await cache.readPageSnapshotPreview('immutable-privacy'))?.settings?.safeShare).toBe(false)
  })

  it('enforces expiry on read without waiting for an alarm', async () => {
    const cache = await import('../src/lib/page-snapshot-cache')
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    await cache.storePageSnapshotPreview(snapshot('old'))
    clock.mockReturnValue(now + cache.PAGE_SNAPSHOT_CACHE_TTL_MS + 1)
    expect(await cache.readPageSnapshotPreview('old')).toBeNull()
    expect(data[cache.PAGE_SNAPSHOT_CACHE_PREFIX + 'old']).toBeUndefined()
    clock.mockRestore()
  })
  it('rejects oversized previews but leaves existing entries intact', async () => {
    const cache = await import('../src/lib/page-snapshot-cache')
    await cache.storePageSnapshotPreview(snapshot('small'))
    await expect(cache.storePageSnapshotPreview(snapshot('large', 'a'.repeat(cache.PAGE_SNAPSHOT_CACHE_MAX_ENTRY_BYTES)))).rejects.toThrow('too large')
    expect(await cache.readPageSnapshotPreview('small')).not.toBeNull()
  })
  it('never persists the unredacted source for share previews', async () => {
    const cache = await import('../src/lib/page-snapshot-cache')
    await cache.storePageSnapshotPreview(snapshot('share', 'api_key=sk-abcdefghijklmnopqrstuvwxyz'), { safeShare: true, assistantDisplayName: 'key sk-abcdefghijklmnopqrstuvwxyz' })
    expect(JSON.stringify(data)).not.toContain('sk-abcdefghijklmnopqrstuvwxyz')
  })
  it('surfaces storage failure and handles deletion without selecting other captures', async () => {
    const cache = await import('../src/lib/page-snapshot-cache')
    area.set.mockRejectedValueOnce(new Error('quota'))
    await expect(cache.storePageSnapshotPreview(snapshot('failed'))).rejects.toThrow('quota')
    await cache.storePageSnapshotPreview(snapshot('a'))
    await cache.storePageSnapshotPreview(snapshot('b'))
    await cache.removePageSnapshotPreview('a')
    expect(await cache.readPageSnapshotPreview('a')).toBeNull()
    expect(await cache.readPageSnapshotPreview('b')).not.toBeNull()
  })
})
