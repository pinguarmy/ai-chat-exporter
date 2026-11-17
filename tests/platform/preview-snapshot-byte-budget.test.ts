import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../../src/core/types'
import { createStorageArea, type StorageData } from '../helpers/chrome-mock'

let data: StorageData
let area: ReturnType<typeof createStorageArea>
beforeEach(() => {
  vi.resetModules()
  data = {}
  area = createStorageArea(data, { clone: true })
  vi.stubGlobal('chrome', { storage: { local: area } })
})
const conversation = (id: string, content: string) => ({
  id,
  title: 'Synthetic',
  url: '',
  platform: 'gemini' as const,
  messages: [{ id: 'm', role: 'user' as const, content }]
})
describe('legacy preview byte budget', () => {
  it('rejects a single oversized transcript without replacing an existing preview', async () => {
    const cache = await import('../../src/platform/preview-snapshots')
    await cache.storePreviewSnapshot(conversation('a', 'small'))
    await expect(
      cache.storePreviewSnapshot(
        conversation('a', 'x'.repeat(cache.PREVIEW_SNAPSHOT_MAX_ENTRY_BYTES))
      )
    ).rejects.toThrow('too large')
    expect((data['conversation-a'] as Conversation).messages[0].content).toBe('small')
  })
  it('evicts oldest previews by bytes and retains unrelated settings', async () => {
    const cache = await import('../../src/platform/preview-snapshots')
    data.settings = { locale: 'en' }
    for (let n = 0; n < 4; n++)
      await cache.storePreviewSnapshot(conversation(String(n), 'x'.repeat(700000)))
    expect(data['conversation-0']).toBeUndefined()
    expect(data['conversation-3']).toBeDefined()
    expect(data.settings).toEqual({ locale: 'en' })
    expect(area.get.mock.calls.some(([key]) => key === null)).toBe(false)
  })
})
