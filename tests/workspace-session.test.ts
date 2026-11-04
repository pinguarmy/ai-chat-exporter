/**
 * Workspace session hand-off tests (jsdom, in-memory storage mocks).
 *
 * Covers: create/consume roundtrip, consume-once deletion, TTL expiry,
 * source-tab binding (including unnamed callers), settings-patch whitelisting
 * (never conversation content or complex subsystems), index-scoped sweeping
 * that never enumerates foreign session keys, loud deletion failures, and the
 * loud failure when chrome.storage.session is missing or rejects.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_SESSION_STORAGE_UNAVAILABLE,
  WORKSPACE_SESSION_TTL_MS,
  consumeWorkspaceSession,
  createWorkspaceSession,
  resetWorkspaceSessionAreaForTests,
  type WorkspaceSessionPayload,
} from '../src/lib/workspace-session'

type Area = {
  get: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  map: Map<string, unknown>
}

function makeArea(): Area {
  const map = new Map<string, unknown>()
  return {
    map,
    get: vi.fn(async (keys?: string | string[] | null) => {
      if (keys == null) return Object.fromEntries(map)
      const list = Array.isArray(keys) ? keys : [keys]
      return Object.fromEntries(list.filter(key => map.has(key)).map(key => [key, map.get(key)]))
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) map.set(key, value)
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) map.delete(key)
    }),
  }
}

function makePayload(overrides: Partial<WorkspaceSessionPayload> = {}): WorkspaceSessionPayload {
  return {
    sourceTabId: 7,
    tabMode: 'bulk',
    format: 'markdown',
    selectedIds: ['c1', 'c2'],
    searchQuery: 'hello',
    bulkFromDate: '2026-01-01',
    bulkToDate: '2026-02-01',
    bulkSelectionLimit: '50',
    settingsPatch: { archiveBundle: true },
    ...overrides,
  }
}

let area: Area

beforeEach(() => {
  area = makeArea()
  resetWorkspaceSessionAreaForTests()
  vi.stubGlobal('chrome', { storage: { session: area } })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('workspace session hand-off', () => {
  it('round-trips a sanitized payload through a random single-use id', async () => {
    const id = await createWorkspaceSession({
      ...makePayload(),
      // Extra top-level fields must not survive the hand-off.
      ...({ conversationContent: 'private chat text' } as unknown as Partial<WorkspaceSessionPayload>),
      selectedIds: ['c1', 'c1', '', 'c2', 42 as unknown as string],
    })
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(10)

    const result = await consumeWorkspaceSession(id, 7)
    expect(result).toEqual({
      ok: true,
      payload: {
        ...makePayload(),
        selectedIds: ['c1', 'c2'],
      },
    })
    expect(JSON.stringify(result)).not.toContain('private chat text')
  })

  it('keeps only whitelisted session option keys in the settings patch', async () => {
    const id = await createWorkspaceSession(makePayload({
      settingsPatch: {
        archiveBundle: true,
        skipAlreadyExported: false,
        // Unknown, content-shaped, and complex-subsystem keys must be dropped.
        conversationContent: 'PRIVATE CHAT TEXT',
        scheduledExport: { enabled: true },
        theme: 'dark',
        locale: 'de',
      } as unknown as WorkspaceSessionPayload['settingsPatch'],
    }))
    const result = await consumeWorkspaceSession(id, 7)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.payload.settingsPatch).toEqual({ archiveBundle: true, skipAlreadyExported: false })
    }
    expect(JSON.stringify(result)).not.toContain('PRIVATE CHAT TEXT')
  })

  it('consumes each hand-off exactly once', async () => {
    const id = await createWorkspaceSession(makePayload())
    const first = await consumeWorkspaceSession(id, 7)
    expect(first.ok).toBe(true)
    const second = await consumeWorkspaceSession(id, 7)
    expect(second).toEqual({ ok: false, reason: 'missing' })
    expect(area.remove).toHaveBeenCalledWith(`workspaceSession:${id}`)
  })

  it('rejects expired hand-offs and still consumes them', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-04T21:00:00Z'))
    const id = await createWorkspaceSession(makePayload())
    vi.setSystemTime(new Date('2026-11-04T21:00:00Z').getTime() + WORKSPACE_SESSION_TTL_MS + 1)
    expect(await consumeWorkspaceSession(id, 7)).toEqual({ ok: false, reason: 'expired' })
    // Even an expired record is gone after the attempt.
    expect(await consumeWorkspaceSession(id, 7)).toEqual({ ok: false, reason: 'missing' })
  })

  it('binds the hand-off to its source tab', async () => {
    const id = await createWorkspaceSession(makePayload({ sourceTabId: 7 }))
    expect(await consumeWorkspaceSession(id, 99)).toEqual({ ok: false, reason: 'tab-mismatch' })
    // The mismatch consumed it; the right tab cannot replay it either.
    expect(await consumeWorkspaceSession(id, 7)).toEqual({ ok: false, reason: 'missing' })
  })

  it('treats an unnamed caller as a mismatch for a bound hand-off', async () => {
    const id = await createWorkspaceSession(makePayload({ sourceTabId: 7 }))
    expect(await consumeWorkspaceSession(id)).toEqual({ ok: false, reason: 'tab-mismatch' })
  })

  it('rejects malformed ids without touching storage records', async () => {
    expect(await consumeWorkspaceSession('', 7)).toEqual({ ok: false, reason: 'missing' })
    expect(await consumeWorkspaceSession('../../etc/passwd', 7)).toEqual({ ok: false, reason: 'missing' })
    // Only the probe may have read; no record key was fetched or removed.
    expect(area.remove).not.toHaveBeenCalled()
  })

  it('rejects loudly and does not consume when deletion fails', async () => {
    const id = await createWorkspaceSession(makePayload())
    area.remove.mockRejectedValueOnce(new Error('remove failed'))
    await expect(consumeWorkspaceSession(id, 7)).rejects.toThrow('remove failed')
    // The hand-off was NOT consumed: swallowing the failure would hide it and
    // allow a replay, so the record is left for an explicit retry.
    expect(area.map.has(`workspaceSession:${id}`)).toBe(true)
  })

  it('sweeps expired hand-offs through its own index without enumerating foreign keys', async () => {
    // Foreign session content (provider credentials) must never be read.
    area.map.set('gemini_credentials', { token: 'SECRET' })
    area.map.set('workspaceSession:stale-id', { createdAt: Date.now() - WORKSPACE_SESSION_TTL_MS - 1, payload: makePayload() })
    area.map.set('workspaceSession:index', ['stale-id'])

    await createWorkspaceSession(makePayload())
    await vi.waitFor(() => {
      expect(area.map.has('workspaceSession:stale-id')).toBe(false)
    })
    expect(area.map.get('gemini_credentials')).toEqual({ token: 'SECRET' })
    // No whole-area read ever happened.
    for (const call of area.get.mock.calls) {
      expect(call[0] === null || call[0] === undefined).toBe(false)
    }
  })

  it('fails loudly when the session area does not exist', async () => {
    vi.stubGlobal('chrome', { storage: {} })
    resetWorkspaceSessionAreaForTests()
    await expect(createWorkspaceSession(makePayload())).rejects.toThrow(WORKSPACE_SESSION_STORAGE_UNAVAILABLE)
    await expect(consumeWorkspaceSession('abc', 7)).rejects.toThrow(WORKSPACE_SESSION_STORAGE_UNAVAILABLE)
  })

  it('fails loudly when the session area rejects', async () => {
    area.get.mockRejectedValue(new Error('access denied'))
    resetWorkspaceSessionAreaForTests()
    await expect(createWorkspaceSession(makePayload())).rejects.toThrow(WORKSPACE_SESSION_STORAGE_UNAVAILABLE)
  })
})
