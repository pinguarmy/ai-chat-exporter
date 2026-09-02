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

describe('snapshot index writes are serialized', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('does not lose keys when several contexts register concurrently', async () => {
    // The popup and each provider content script all write this index. With an
    // unserialized read-modify-write the later set() overwrites the earlier
    // one, orphaning a snapshot that holds full conversation text.
    const { data } = installStorage()
    const { registerPreviewSnapshotKey, PREVIEW_SNAPSHOT_INDEX_KEY } = await loadModule()

    await Promise.all([
      registerPreviewSnapshotKey('conversation-a'),
      registerPreviewSnapshotKey('conversation-b'),
      registerPreviewSnapshotKey('conversation-c'),
    ])

    expect(new Set(data[PREVIEW_SNAPSHOT_INDEX_KEY])).toEqual(
      new Set(['conversation-a', 'conversation-b', 'conversation-c'])
    )
  })

  it('deletes evicted snapshots instead of merely forgetting them', async () => {
    const { data } = installStorage()
    const mod = await loadModule()
    const limit = mod.PREVIEW_SNAPSHOT_INDEX_LIMIT

    for (let i = 0; i < limit + 3; i++) {
      data[`conversation-${i}`] = { timestamp: Date.now() }
      await mod.registerPreviewSnapshotKey(`conversation-${i}`)
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
