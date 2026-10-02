import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPageSnapshot } from '../src/lib/page-snapshot'
import type { PageSnapshot } from '../src/lib/types'
import * as drafts from '../src/lib/recovery-drafts'

// Focused reliability review for the recovery draft store. Unlike
// recovery-drafts.test.ts (behavior contract of the current implementation)
// these tests encode the hardened invariants a local persistence layer for
// private chat content should hold. They use fault injection to prevent
// regressions in durable status, cleanup, privacy and byte accounting.
//
// The storage mock structured-clones on read/write so in-memory mutations of
// an unpublished index cannot leak into "storage" — chrome.storage.local
// never shares object references with callers.
const store: Record<string, unknown> = {}
let failSlot = false
let failIndex = false
let failRemove = false
// Allows index publishes to start failing only after N successes, so a test
// can fail the final publish while the slot reservation has already landed.
let failIndexAfter = Number.POSITIVE_INFINITY
let indexPublishes = 0
const storage = {
  get: vi.fn(async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in store).map(k => [k, structuredClone(store[k])]))),
  set: vi.fn(async (items: Record<string, unknown>) => {
    if (failSlot && Object.keys(items).some(k => k.startsWith('recoveryDraftSlot'))) throw new Error('QUOTA_BYTES')
    if ('recoveryDraftIndexV1' in items) { indexPublishes++; if (failIndex || indexPublishes > failIndexAfter) throw new Error('QUOTA_BYTES') }
    Object.assign(store, structuredClone(items))
  }),
  remove: vi.fn(async (keys: string | string[]) => {
    if (failRemove) throw new Error('TRANSIENT_REMOVE_FAILURE')
    for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key]
  }),
}
const INDEX_KEY = 'recoveryDraftIndexV1'
const storedIndex = () => store[INDEX_KEY] as { entries: Array<{ slot: string; state: string; token?: string }>; cleanupSlots: string[] } | undefined
const slotKeys = () => Object.keys(store).filter(k => k.startsWith('recoveryDraftSlot'))
const orphanSlots = () => {
  const referenced = new Set((storedIndex()?.entries || []).map(e => e.slot))
  return slotKeys().filter(k => !referenced.has(k))
}
const totalRecoveryBytes = () => Object.entries(store).filter(([k]) => k.startsWith('recoveryDraft')).reduce((sum, [, v]) => sum + JSON.stringify(v).length, 0)
function snapshot(text = 'hello', count = 1): PageSnapshot {
  return buildPageSnapshot({ id: 'c', title: 'Conversation', url: 'https://gemini.google.com/app/1', platform: 'gemini', messages: Array.from({ length: count }, (_, i) => ({ id: `m${i}`, role: 'user' as const, content: text })) }, 'idle')
}
const start = () => drafts.startRecoveryProtection('gemini:1', snapshot())
beforeEach(async () => {
  failSlot = false; failIndex = false; failRemove = false
  failIndexAfter = Number.POSITIVE_INFINITY; indexPublishes = 0
  vi.stubGlobal('chrome', { storage: { local: storage } })
  await drafts.clearRecoveryDrafts().catch(() => undefined)
  for (const key of Object.keys(store)) delete store[key]
  vi.clearAllMocks()
})
afterEach(() => { vi.useRealTimers() })

describe('recovery persistence hardening', () => {
  it('keeps message bodies out of the index metadata', async () => {
    // The index is written on every operation and counts against the same
    // quota; embedding a second copy of every draft body in it (fingerprint)
    // doubles the footprint of private content and defeats the byte budget.
    const marker = 'BODY-MARKER-7f3a2e'
    await drafts.startRecoveryProtection('gemini:1', snapshot(marker))
    expect(JSON.stringify(store[INDEX_KEY])).not.toContain(marker)
  })

  it('persists the pause when the visible message count decreases', async () => {
    // A returned-but-unpersisted pause leaves the stored entry protected with
    // a live token: GET status disagrees with the stopped monitor and the old
    // token keeps writing.
    const s = await drafts.startRecoveryProtection('gemini:1', snapshot('old', 2))
    const p = await drafts.writeRecoveryCheckpoint('gemini:1', s.token!, snapshot('new', 1))
    expect(p.state).toBe('paused')
    expect((await drafts.getRecoveryStatus('gemini:1')).state).toBe('paused')
    await drafts.writeRecoveryCheckpoint('gemini:1', s.token!, snapshot('late', 3))
    expect((await drafts.getRecoveryDraft(s.draftId!))?.conversation.messages[0].content).toBe('old')
  })

  it('does not leave a stale protected entry when an initial save is rejected as invalid', async () => {
    const s = await start()
    const rejected = await drafts.startRecoveryProtection('gemini:1', {} as PageSnapshot)
    expect(rejected.state).not.toBe('protected')
    // The persisted truth must match the returned truth: no live token may
    // survive a start that reported failure.
    expect((await drafts.getRecoveryStatus('gemini:1')).state).not.toBe('protected')
    await drafts.writeRecoveryCheckpoint('gemini:1', s.token!, snapshot('late'))
    expect((await drafts.getRecoveryDraft(s.draftId!))?.conversation.messages[0].content).toBe('hello')
  })

  it('reclaims an orphaned slot once storage recovers from a transient failure', async () => {
    // The slot body write succeeds, then the final index publish and the
    // compensating remove both fail. The slot reservation recorded before the
    // body write must drive reclamation once storage recovers.
    const s = await start()
    indexPublishes = 0
    failIndexAfter = 1 // reservation publish lands, the final one fails
    failRemove = true
    const p = await drafts.writeRecoveryCheckpoint('gemini:1', s.token!, snapshot('new'))
    expect(p.state).toBe('paused')
    failIndexAfter = Number.POSITIVE_INFINITY; failRemove = false
    expect(orphanSlots().length).toBeGreaterThan(0)
    await drafts.cleanupRecoveryDrafts()
    await drafts.startRecoveryProtection('gemini:2', snapshot())
    expect(orphanSlots()).toEqual([])
  })

  it('keeps failed cleanup slots on the retry list and frees them after recovery', async () => {
    const s = await start()
    failRemove = true
    await drafts.writeRecoveryCheckpoint('gemini:1', s.token!, snapshot('new'))
    failRemove = false
    expect(storedIndex()?.cleanupSlots.length).toBeGreaterThan(0)
    await drafts.writeRecoveryCheckpoint('gemini:1', s.token!, snapshot('newer'))
    expect(orphanSlots()).toEqual([])
  })

  it('does not serve expired drafts on read before cleanup runs', async () => {
    // Read expiry must not depend on cleanup alarms or subsequent writes.
    vi.useFakeTimers()
    const s = await start()
    vi.setSystemTime(Date.now() + drafts.RECOVERY_DRAFT_TTL_MS + 1000)
    expect(await drafts.getRecoveryDraft(s.draftId!)).toBeNull()
  })

  it('bounds total recovery bytes even when cleanup keeps failing', async () => {
    // Indexed obsolete bodies count against the same cap during deletion failures.
    const big = (tag: number) => snapshot('x'.repeat(700_000) + tag)
    const s = await drafts.startRecoveryProtection('gemini:1', big(0))
    failRemove = true
    for (let i = 1; i <= 6; i++) await drafts.writeRecoveryCheckpoint('gemini:1', s.token!, big(i))
    expect(totalRecoveryBytes()).toBeLessThanOrEqual(drafts.RECOVERY_TOTAL_MAX_BYTES)
  })

  it('strips unknown raw fields before persisting a validated snapshot', async () => {
    // isPageSnapshot rejects a fixed denylist, not an allowlist: extra keys
    // riding on an otherwise valid snapshot are persisted and served back.
    const dirty = snapshot('clean')
    ;(dirty as unknown as Record<string, unknown>).rawProviderPayload = { secret: 'RAW-MARKER-9zq' }
    ;(dirty.conversation as unknown as Record<string, unknown>).rawTranscript = 'RAW-MARKER-9zq'
    const s = await drafts.startRecoveryProtection('gemini:1', dirty)
    expect(s.state).toBe('protected')
    expect(JSON.stringify(store)).not.toContain('RAW-MARKER-9zq')
  })

  it('reconciles an unpublished pause after storage recovers and rejects its old token', async () => {
    const s = await start()
    failSlot = true; failIndex = true
    expect((await drafts.writeRecoveryCheckpoint('gemini:1', s.token!, snapshot('Failed update'))).state).toBe('paused')
    failSlot = false; failIndex = false
    const late = await drafts.writeRecoveryCheckpoint('gemini:1', s.token!, snapshot('Late update'))
    expect(late.state).toBe('paused')
    expect(late.token).toBeUndefined()
    expect((await drafts.getRecoveryDraft(s.draftId!))?.conversation.messages[0].content).toBe('hello')
    expect(storedIndex()?.entries[0].state).toBe('paused')
  })

  it('surfaces persistence failure from stop instead of reporting success', async () => {
    // If the state change cannot be persisted the caller must learn about it;
    // a silent half-applied stop would leave a live token behind.
    await start()
    failIndex = true
    await expect(drafts.stopRecoveryProtection('gemini:1')).rejects.toThrow()
    failIndex = false
    expect((await drafts.getRecoveryStatus('gemini:1')).state).toBe('protected')
    await drafts.stopRecoveryProtection('gemini:1')
    expect((await drafts.getRecoveryStatus('gemini:1')).state).toBe('off')
  })
})
