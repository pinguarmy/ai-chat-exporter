/**
 * Preview snapshot index contract.
 *
 * The index exists so cleanup never has to scan the whole storage area. That
 * makes the index the only thing standing between a cached conversation and
 * living on disk forever, so its failure modes matter more than its happy path.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const HOUR = 3600000

function installStorage(initial: Record<string, any> = {}) {
  const data: Record<string, any> = { ...initial }
  const area = {
    get: vi.fn(async (keys: string | string[] | null) => {
      if (keys === null || keys === undefined) return { ...data }
      const requested = typeof keys === 'string' ? [keys] : keys
      return Object.fromEntries(
        requested.filter(key => data[key] !== undefined).map(key => [key, data[key]])
      )
    }),
    set: vi.fn(async (items: Record<string, any>) => { Object.assign(data, items) }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of typeof keys === 'string' ? [keys] : keys) delete data[key]
    }),
  }
  ;(globalThis as any).chrome = { storage: { local: area } }
  return { data, area }
}

async function loadModule() {
  vi.resetModules()
  return import('../src/lib/preview-snapshots')
}

describe('background snapshot writer', () => {
  it('serializes independent clients through the background message boundary', async () => {
    const { data, area } = installStorage()
    const worker = await loadModule()
    ;(globalThis as any).chrome.runtime = {
      sendMessage: vi.fn(async (message: { type: string; data: any }) => {
        expect(message.type).toBe(worker.PREVIEW_SNAPSHOT_MESSAGE)
        await worker.storePreviewSnapshot(message.data)
        return { data: true }
      }),
    }
    // Separate module instances represent independent popup/content contexts.
    const clientA = await loadModule()
    const clientB = await loadModule()
    const snapshot = (id: string) => ({ id, title: 'Synthetic', platform: 'chatgpt' as const, url: '', messages: [] })

    await Promise.all([
      clientA.requestPreviewSnapshot(snapshot('a')),
      clientB.requestPreviewSnapshot(snapshot('b')),
    ])

    expect(new Set(data[worker.PREVIEW_SNAPSHOT_INDEX_KEY])).toEqual(new Set(['conversation-a', 'conversation-b']))
    expect(data['conversation-a'].id).toBe('a')
    expect(data['conversation-b'].id).toBe('b')
    // Every snapshot body write follows an index write, never the reverse.
    const writes = area.set.mock.calls.map(([value]) => Object.keys(value)[0])
    expect(writes).toEqual([worker.PREVIEW_SNAPSHOT_INDEX_KEY, 'conversation-a', worker.PREVIEW_SNAPSHOT_INDEX_KEY, 'conversation-b'])
  })

  it('does not write a body when indexing fails', async () => {
    const { data, area } = installStorage()
    const worker = await loadModule()
    area.set.mockRejectedValueOnce(new Error('storage unavailable'))
    await expect(worker.storePreviewSnapshot({ id: 'a', title: '', url: '', platform: 'chatgpt', messages: [] }))
      .rejects.toThrow('storage unavailable')
    expect(data['conversation-a']).toBeUndefined()
  })

  it('rejects malformed requests without changing storage', async () => {
    const { area } = installStorage()
    const worker = await loadModule()
    await expect(worker.storePreviewSnapshot({ id: '', messages: [] } as any)).rejects.toThrow('Invalid preview snapshot')
    expect(area.set).not.toHaveBeenCalled()
  })
})

describe('snapshot index writes are serialized', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('does not lose keys when the worker handles concurrent requests', async () => {
    const { data } = installStorage()
    const { storePreviewSnapshot, PREVIEW_SNAPSHOT_INDEX_KEY } = await loadModule()

    await Promise.all(['a', 'b', 'c'].map(id => storePreviewSnapshot({
      id, title: 'Synthetic', url: '', platform: 'chatgpt', messages: [],
    })))

    expect(new Set(data[PREVIEW_SNAPSHOT_INDEX_KEY])).toEqual(
      new Set(['conversation-a', 'conversation-b', 'conversation-c'])
    )
  })

  it('deletes evicted snapshots instead of merely forgetting them', async () => {
    const { data } = installStorage()
    const mod = await loadModule()
    const limit = mod.PREVIEW_SNAPSHOT_INDEX_LIMIT

    for (let i = 0; i < limit + 3; i++) {
      await mod.storePreviewSnapshot({
        id: String(i), title: 'Synthetic', url: '', platform: 'chatgpt', messages: [],
      })
    }

    expect(data[mod.PREVIEW_SNAPSHOT_INDEX_KEY]).toHaveLength(limit)
    // The three oldest fell out of the index and must not linger on disk.
    expect(data['conversation-0']).toBeUndefined()
    expect(data['conversation-1']).toBeUndefined()
    expect(data['conversation-2']).toBeUndefined()
    expect(data[`conversation-${limit + 2}`]).toBeDefined()
  })
})

describe('one-time sweep for pre-index snapshots', () => {
  it('adopts live orphans and deletes expired ones', async () => {
    const now = Date.now()
    const { data } = installStorage({
      // Written by a release before the index existed: no index entry.
      'conversation-old-live': { timestamp: now - 10_000 },
      'conversation-old-stale': { timestamp: now - 5 * HOUR },
      'conversation-known': { timestamp: now - 10_000 },
      conversationSnapshotKeys: ['conversation-known'],
      // Unrelated keys must survive untouched.
      settings: { theme: 'dark' },
      'exportedIds-chatgpt': ['x'],
    })
    const mod = await loadModule()

    await expect(mod.sweepUnindexedPreviewSnapshots(now)).resolves.toBe(true)

    expect(new Set(data[mod.PREVIEW_SNAPSHOT_INDEX_KEY])).toEqual(
      new Set(['conversation-known', 'conversation-old-live'])
    )
    expect(data['conversation-old-stale']).toBeUndefined()
    expect(data['conversation-old-live']).toBeDefined()
    expect(data.settings).toEqual({ theme: 'dark' })
    expect(data['exportedIds-chatgpt']).toEqual(['x'])
    expect(data[mod.PREVIEW_SNAPSHOT_SWEEP_KEY]).toBe(true)
  })

  it('runs its full-area scan only once', async () => {
    const now = Date.now()
    const { area } = installStorage({ 'conversation-orphan': { timestamp: now } })
    const mod = await loadModule()

    await mod.sweepUnindexedPreviewSnapshots(now)
    const scansAfterFirst = area.get.mock.calls.filter(([keys]) => keys === null).length
    await mod.sweepUnindexedPreviewSnapshots(now)
    const scansAfterSecond = area.get.mock.calls.filter(([keys]) => keys === null).length

    expect(scansAfterFirst).toBe(1)
    expect(scansAfterSecond).toBe(1)
  })

  it('leaves the flag unset so a failed sweep retries', async () => {
    const now = Date.now()
    const { data, area } = installStorage({ 'conversation-orphan': { timestamp: now } })
    area.get.mockImplementationOnce(async () => ({}))
    area.get.mockImplementationOnce(async () => { throw new Error('storage unavailable') })
    const mod = await loadModule()

    await expect(mod.sweepUnindexedPreviewSnapshots(now)).resolves.toBe(false)
    expect(data[mod.PREVIEW_SNAPSHOT_SWEEP_KEY]).toBeUndefined()

    await expect(mod.sweepUnindexedPreviewSnapshots(now)).resolves.toBe(true)
    expect(data[mod.PREVIEW_SNAPSHOT_SWEEP_KEY]).toBe(true)
  })
})

describe('snapshot migration retention failures', () => {
  it('reconciles orphans even when an earlier release marked its sweep done', async () => {
    const now = Date.now()
    const { data } = installStorage({
      conversationSnapshotSweepDone: true,
      'conversation-orphan': { timestamp: now - 2 * HOUR },
    })
    const mod = await loadModule()
    await mod.sweepUnindexedPreviewSnapshots(now)
    expect(data['conversation-orphan']).toBeUndefined()
    expect(data[mod.PREVIEW_SNAPSHOT_SWEEP_KEY]).toBe(true)
  })

  it('deletes live snapshots evicted by the migration limit', async () => {
    const now = Date.now()
    const initial = Object.fromEntries(Array.from({ length: 503 }, (_, i) => [
      `conversation-${i}`, { timestamp: now },
    ]))
    const { data } = installStorage(initial)
    const mod = await loadModule()

    await expect(mod.sweepUnindexedPreviewSnapshots(now)).resolves.toBe(true)

    expect(data[mod.PREVIEW_SNAPSHOT_INDEX_KEY]).toHaveLength(500)
    const retained = new Set(data[mod.PREVIEW_SNAPSHOT_INDEX_KEY])
    for (const key of Object.keys(initial)) {
      expect(data[key] !== undefined).toBe(retained.has(key))
    }
  })

  it('does not mark migration complete before deletion succeeds', async () => {
    const now = Date.now()
    const { data, area } = installStorage({
      'conversation-expired': { timestamp: now - 2 * HOUR },
    })
    area.remove.mockRejectedValueOnce(new Error('storage unavailable'))
    const mod = await loadModule()

    await expect(mod.sweepUnindexedPreviewSnapshots(now)).resolves.toBe(false)
    expect(data[mod.PREVIEW_SNAPSHOT_SWEEP_KEY]).not.toBe(true)
    await expect(mod.sweepUnindexedPreviewSnapshots(now)).resolves.toBe(true)
    expect(data['conversation-expired']).toBeUndefined()
  })

  it('keeps expired keys discoverable when cleanup deletion fails', async () => {
    const now = Date.now()
    const { data, area } = installStorage({
      'conversation-live': { timestamp: now },
      'conversation-expired': { timestamp: now - 2 * HOUR },
      conversationSnapshotKeys: ['conversation-live', 'conversation-expired'],
    })
    area.remove.mockRejectedValueOnce(new Error('storage unavailable'))
    const mod = await loadModule()

    await expect(mod.cleanupExpiredPreviewSnapshots(now)).rejects.toThrow('storage unavailable')
    await mod.cleanupExpiredPreviewSnapshots(now)
    expect(data['conversation-expired']).toBeUndefined()
    expect(data[mod.PREVIEW_SNAPSHOT_INDEX_KEY]).toEqual(['conversation-live'])
  })
})

describe('expiry cleanup', () => {
  it('removes expired snapshots and keeps live ones indexed', async () => {
    const now = Date.now()
    const { data } = installStorage({
      'conversation-live': { timestamp: now - 60_000 },
      'conversation-expired': { timestamp: now - 2 * HOUR },
      conversationSnapshotKeys: ['conversation-live', 'conversation-expired'],
    })
    const mod = await loadModule()

    await mod.cleanupExpiredPreviewSnapshots(now)

    expect(data['conversation-expired']).toBeUndefined()
    expect(data['conversation-live']).toBeDefined()
    expect(data[mod.PREVIEW_SNAPSHOT_INDEX_KEY]).toEqual(['conversation-live'])
  })

  it('drops the index entirely once nothing is left', async () => {
    const now = Date.now()
    const { data } = installStorage({
      'conversation-expired': { timestamp: now - 2 * HOUR },
      conversationSnapshotKeys: ['conversation-expired', 'conversation-already-gone'],
    })
    const mod = await loadModule()

    await mod.cleanupExpiredPreviewSnapshots(now)

    expect(data[mod.PREVIEW_SNAPSHOT_INDEX_KEY]).toBeUndefined()
    expect(data['conversation-expired']).toBeUndefined()
  })
})
