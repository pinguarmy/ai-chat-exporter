import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPageSnapshot } from '../src/lib/page-snapshot'
import type { PageSnapshot } from '../src/lib/types'
import * as drafts from '../src/lib/recovery-drafts'

const store: Record<string, unknown> = {}
let failSlot = false
let failIndex = false
const storage = {
  get: vi.fn(async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in store).map(k => [k, store[k]]))),
  set: vi.fn(async (items: Record<string, unknown>) => {
    if (failSlot && Object.keys(items).some(k => k.startsWith('recoveryDraftSlot'))) throw new Error('QUOTA_BYTES')
    if (failIndex && 'recoveryDraftIndexV1' in items) throw new Error('QUOTA_BYTES')
    Object.assign(store, items)
  }),
  remove: vi.fn(async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key] }),
}
function snapshot(text = 'hello', count = 1): PageSnapshot {
  return buildPageSnapshot({ id: 'c', title: 'Conversation', url: 'https://gemini.google.com/app/1', platform: 'gemini', messages: Array.from({ length: count }, (_, i) => ({ id: `m${i}`, role: 'user' as const, content: text })) }, 'idle')
}
const start = () => drafts.startRecoveryProtection('gemini:1', snapshot())
beforeEach(async () => {
  vi.stubGlobal('chrome', { storage: { local: storage } })
  await drafts.clearRecoveryDrafts().catch(() => undefined)
  for (const key of Object.keys(store)) delete store[key]
  failSlot = false; failIndex = false
  vi.clearAllMocks()
})
describe('recovery drafts', () => {
  it('defaults to off', async () => { expect(await drafts.getRecoveryStatus('absent')).toMatchObject({ state: 'off' }) })
  it('stores initial checkpoint and summary', async () => { const s = await start(); expect(s.state).toBe('protected'); expect((await drafts.listRecoveryDrafts())[0]).toMatchObject({ sessionKey: 'gemini:1', messageCount: 1 }); expect((await drafts.getRecoveryDraft(s.draftId!))?.conversation.title).toBe('Conversation') })
  it('does not scan all storage keys', async () => { await start(); expect(storage.get).not.toHaveBeenCalledWith(null) })
  it('ignores old tokens', async () => { const s = await start(); await drafts.writeRecoveryCheckpoint('gemini:1', 'wrong', snapshot('new')); expect((await drafts.getRecoveryDraft(s.draftId!))?.conversation.messages[0].content).toBe('hello') })
  it('does not write identical content with new capture ids', async () => { const s = await start(); storage.set.mockClear(); await drafts.writeRecoveryCheckpoint('gemini:1', s.token!, snapshot()); expect(storage.set).not.toHaveBeenCalled() })
  it('writes changed content', async () => { const s = await start(); await drafts.writeRecoveryCheckpoint('gemini:1', s.token!, snapshot('new')); expect((await drafts.getRecoveryDraft(s.draftId!))?.conversation.messages[0].content).toBe('new') })
  it('pauses when message count decreases', async () => { const s = await drafts.startRecoveryProtection('gemini:1', snapshot('old', 2)); const p = await drafts.writeRecoveryCheckpoint('gemini:1', s.token!, snapshot('new')); expect(p.state).toBe('paused'); expect((await drafts.getRecoveryDraft(s.draftId!))?.conversation.messages).toHaveLength(2) })
  it('stops and rejects stale writes', async () => { const s = await start(); await drafts.stopRecoveryProtection('gemini:1'); await drafts.writeRecoveryCheckpoint('gemini:1', s.token!, snapshot('new')); expect((await drafts.getRecoveryStatus('gemini:1')).state).toBe('off') })
  it('deletes active draft and rejects old token', async () => { const s = await start(); await drafts.deleteRecoveryDraft(s.draftId!); await drafts.writeRecoveryCheckpoint('gemini:1', s.token!, snapshot('new')); expect(await drafts.listRecoveryDrafts()).toEqual([]) })
  it('clears drafts and rejects old token', async () => { const s = await start(); await drafts.clearRecoveryDrafts(); await drafts.writeRecoveryCheckpoint('gemini:1', s.token!, snapshot('new')); expect(await drafts.getRecoveryDraft(s.draftId!)).toBeNull() })
  it('pauses all while retaining content', async () => { const s = await start(); await drafts.pauseAllRecoveryProtection('restart'); expect((await drafts.getRecoveryStatus('gemini:1')).state).toBe('paused'); expect(await drafts.getRecoveryDraft(s.draftId!)).not.toBeNull() })
  it('recovers index across module reset', async () => { const s = await start(); vi.resetModules(); const next = await import('../src/lib/recovery-drafts'); expect((await next.getRecoveryStatus('gemini:1')).draftId).toBe(s.draftId); await next.pauseAllRecoveryProtection('restart'); expect((await drafts.getRecoveryStatus('gemini:1')).state).toBe('paused') })
  it('retains previous slot after failed write', async () => { const s = await start(); failSlot = true; const p = await drafts.writeRecoveryCheckpoint('gemini:1', s.token!, snapshot('new')); expect(p.state).toBe('paused'); expect((await drafts.getRecoveryDraft(s.draftId!))?.conversation.messages[0].content).toBe('hello') })
  it('retains previous slot after failed index publish', async () => { const s = await start(); failIndex = true; const p = await drafts.writeRecoveryCheckpoint('gemini:1', s.token!, snapshot('new')); expect(p.state).toBe('paused'); expect((await drafts.getRecoveryDraft(s.draftId!))?.conversation.messages[0].content).toBe('hello') })
  it('rejects oversized checkpoint without deleting prior', async () => { const s = await start(); const p = await drafts.writeRecoveryCheckpoint('gemini:1', s.token!, snapshot('x'.repeat(1_100_000))); expect(p.state).toBe('paused'); expect(await drafts.getRecoveryDraft(s.draftId!)).not.toBeNull() })
  it('expires drafts after seven days', async () => { const s = await start(); await drafts.cleanupRecoveryDrafts(Date.now() + drafts.RECOVERY_DRAFT_TTL_MS + 1000); expect(await drafts.getRecoveryDraft(s.draftId!)).toBeNull() })
  it('keeps protected drafts rather than silently evicting at count limit', async () => { for (let i = 0; i < drafts.RECOVERY_MAX_DRAFTS; i++) await drafts.startRecoveryProtection(`gemini:${i}`, snapshot()); const result = await drafts.startRecoveryProtection('extra', snapshot()); expect(result.state).toBe('paused'); expect(await drafts.listRecoveryDrafts()).toHaveLength(drafts.RECOVERY_MAX_DRAFTS) })
  it('allows retry after failure', async () => { failSlot = true; expect((await start()).state).toBe('paused'); failSlot = false; expect((await start()).state).toBe('protected') })
})
