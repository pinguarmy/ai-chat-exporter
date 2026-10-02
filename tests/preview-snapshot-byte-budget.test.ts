import { beforeEach, describe, expect, it, vi } from 'vitest'

let data: Record<string, any>
let area: any
beforeEach(() => {
  vi.resetModules(); data = {}
  area = {
    get: vi.fn(async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in data).map(key => [key, data[key]]))),
    set: vi.fn(async (items: any) => { Object.assign(data, structuredClone(items)) }),
    remove: vi.fn(async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key] }),
  }
  vi.stubGlobal('chrome', { storage: { local: area } })
})
const conversation = (id: string, content: string) => ({ id, title: 'Synthetic', url: '', platform: 'gemini' as const, messages: [{ id: 'm', role: 'user' as const, content }] })
describe('legacy preview byte budget', () => {
  it('rejects a single oversized transcript without replacing an existing preview', async () => {
    const cache = await import('../src/lib/preview-snapshots')
    await cache.storePreviewSnapshot(conversation('a', 'small'))
    await expect(cache.storePreviewSnapshot(conversation('a', 'x'.repeat(cache.PREVIEW_SNAPSHOT_MAX_ENTRY_BYTES)))).rejects.toThrow('too large')
    expect(data['conversation-a'].messages[0].content).toBe('small')
  })
  it('evicts oldest previews by bytes and retains unrelated settings', async () => {
    const cache = await import('../src/lib/preview-snapshots')
    data.settings = { locale: 'en' }
    for (let n = 0; n < 4; n++) await cache.storePreviewSnapshot(conversation(String(n), 'x'.repeat(700000)))
    expect(data['conversation-0']).toBeUndefined()
    expect(data['conversation-3']).toBeDefined()
    expect(data.settings).toEqual({ locale: 'en' })
    expect(area.get.mock.calls.some(([key]: any[]) => key === null)).toBe(false)
  })
})
