import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPageSnapshot } from '../src/core/page-snapshot'
import { mergeExtensionSettings } from '../src/core/types'
import * as drafts from '../src/platform/recovery-drafts'

// chrome.storage returns independent copies; an unpublished index mutation must
// not silently change durable storage in these quota/retention regressions.
const store: Record<string, unknown> = {}
let failSettingsRead = false
const contains = vi.fn()
const storage = {
  get: vi.fn(async (keys: string | string[]) => {
    const requested = Array.isArray(keys) ? keys : [keys]
    if (failSettingsRead && requested.includes('settings')) throw new Error('Settings unavailable')
    return structuredClone(Object.fromEntries(requested.filter(key => key in store).map(key => [key, store[key]])))
  }),
  set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(store, structuredClone(items)) }),
  remove: vi.fn(async (keys: string | string[]) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key]
  }),
}
const snapshot = (content = 'original') => buildPageSnapshot({
  id: 'conversation', title: 'Saved conversation', url: '', platform: 'gemini',
  messages: [{ id: 'message', role: 'user', content }],
}, 'idle')
const recoveryBytes = () => Object.entries(store)
  .filter(([key]) => key.startsWith('recoveryDraft'))
  .reduce((sum, [, value]) => sum + new TextEncoder().encode(JSON.stringify(value)).length, 0)
const settings = (expanded: unknown) => { store.settings = { recoveryExpandedStorage: expanded, recoveryRetentionDays: 0 } }

beforeEach(async () => {
  failSettingsRead = false
  vi.stubGlobal('chrome', { storage: { local: storage }, permissions: { contains } })
  await drafts.clearRecoveryDrafts()
  for (const key of Object.keys(store)) delete store[key]
  vi.clearAllMocks()
  contains.mockResolvedValue(true)
  settings(false)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('expanded recovery storage', () => {
  it('accepts and reads a draft larger than 1 MiB only with opt-in and permission', async () => {
    settings(true)
    const large = snapshot('x'.repeat(drafts.RECOVERY_DRAFT_MAX_BYTES + 1))
    const result = await drafts.startRecoveryProtection('large', large)
    expect(result.state).toBe('protected')
    expect(contains).toHaveBeenCalledWith({ permissions: ['unlimitedStorage'] })
    expect(await drafts.getRecoveryDraft(result.draftId!)).toEqual(large)
    expect(recoveryBytes()).toBeGreaterThan(drafts.RECOVERY_DRAFT_MAX_BYTES)
  })

  it('allows aggregate storage above 4 MiB when expanded storage is authorized', async () => {
    settings(true)
    for (let i = 0; i < 5; i++) {
      expect((await drafts.startRecoveryProtection(`draft:${i}`, snapshot('x'.repeat(900_000) + i))).state).toBe('protected')
    }
    expect(recoveryBytes()).toBeGreaterThan(drafts.RECOVERY_TOTAL_MAX_BYTES)
    expect(await drafts.listRecoveryDrafts()).toHaveLength(5)
  })

  it.each([undefined, false, 'true', 1, {}])('keeps byte limits for non-boolean opt-in %j despite granted permission', async value => {
    settings(value)
    expect(mergeExtensionSettings({ recoveryExpandedStorage: value } as never).recoveryExpandedStorage).toBe(false)
    const original = await drafts.startRecoveryProtection('strict', snapshot())
    const result = await drafts.writeRecoveryCheckpoint('strict', original.token!, snapshot('x'.repeat(drafts.RECOVERY_DRAFT_MAX_BYTES + 1)))
    expect(result.state).toBe('paused')
    expect((await drafts.getRecoveryStatus('strict')).state).toBe('paused')
    expect(await drafts.getRecoveryDraft(original.draftId!)).toEqual(expect.objectContaining({ conversation: expect.objectContaining({ messages: [expect.objectContaining({ content: 'original' })] }) }))
    expect(contains).not.toHaveBeenCalled()
  })

  it('retains a previous draft when opt-in exists but permission was never granted', async () => {
    settings(true)
    contains.mockResolvedValue(false)
    const original = await drafts.startRecoveryProtection('ungranted', snapshot())
    const result = await drafts.writeRecoveryCheckpoint('ungranted', original.token!, snapshot('x'.repeat(drafts.RECOVERY_DRAFT_MAX_BYTES + 1)))
    expect(result.state).toBe('paused')
    expect((await drafts.getRecoveryDraft(original.draftId!))?.conversation.messages[0].content).toBe('original')
    expect(storage.remove).not.toHaveBeenCalled()
  })

  it.each(['revoked', 'default'] as const)('rechecks authorization on each changed write and retains an oversized draft after %s', async mode => {
    settings(true)
    const large = snapshot('x'.repeat(drafts.RECOVERY_DRAFT_MAX_BYTES + 1))
    const original = await drafts.startRecoveryProtection('large', large)
    expect(original.state).toBe('protected')
    contains.mockClear()
    if (mode === 'revoked') contains.mockResolvedValue(false)
    else settings(false)
    const result = await drafts.writeRecoveryCheckpoint('large', original.token!, snapshot('y'.repeat(drafts.RECOVERY_DRAFT_MAX_BYTES + 1)))
    expect(result.state).toBe('paused')
    expect((await drafts.getRecoveryStatus('large')).state).toBe('paused')
    expect(await drafts.getRecoveryDraft(original.draftId!)).toEqual(large)
    expect(storage.remove).not.toHaveBeenCalled()
    if (mode === 'revoked') expect(contains).toHaveBeenCalledWith({ permissions: ['unlimitedStorage'] })
  })

  it.each([false, true])('does not evict off or paused drafts under the 4 MiB cap (opt-in %s without permission)', async expanded => {
    settings(expanded)
    contains.mockResolvedValue(false)
    const originals = []
    for (let i = 0; i < 4; i++) {
      const result = await drafts.startRecoveryProtection(`saved:${i}`, snapshot('x'.repeat(900_000) + i))
      expect(result.state).toBe('protected')
      originals.push(result)
      if (i % 2) await drafts.pauseRecoveryProtection(`saved:${i}`)
      else await drafts.stopRecoveryProtection(`saved:${i}`)
    }
    expect((await drafts.startRecoveryProtection('over-total', snapshot('y'.repeat(900_000)))).state).toBe('paused')
    expect(recoveryBytes()).toBeLessThan(drafts.RECOVERY_TOTAL_MAX_BYTES)
    expect(await drafts.listRecoveryDrafts()).toHaveLength(4)
    for (let i = 0; i < originals.length; i++) {
      expect((await drafts.getRecoveryDraft(originals[i].draftId!))?.conversation.messages[0].content).toBe('x'.repeat(900_000) + i)
      expect((await drafts.getRecoveryStatus(`saved:${i}`)).state).toBe(i % 2 ? 'paused' : 'off')
    }
    expect(storage.remove).not.toHaveBeenCalled()
  })

  it('keeps the 20-draft limit in expanded mode without evicting stopped drafts', async () => {
    settings(true)
    const ids = []
    for (let i = 0; i < drafts.RECOVERY_MAX_DRAFTS; i++) {
      const result = await drafts.startRecoveryProtection(`saved:${i}`, snapshot())
      expect(result.state).toBe('protected')
      ids.push(result.draftId)
      await drafts.stopRecoveryProtection(`saved:${i}`)
    }
    const rejected = await drafts.startRecoveryProtection('twenty-first', snapshot())
    expect(rejected.state).toBe('paused')
    const retained = await drafts.listRecoveryDrafts()
    expect(retained.map(draft => draft.id)).toEqual(ids)
    expect(retained.every(draft => draft.state === 'off')).toBe(true)
    expect(storage.remove).not.toHaveBeenCalled()
  })

  it('does not expire keep-until-deleted drafts when settings reads fail on cleanup, reads, or writes', async () => {
    vi.useFakeTimers()
    const original = await drafts.startRecoveryProtection('keep', snapshot())
    await drafts.stopRecoveryProtection('keep')
    vi.setSystemTime(Date.now() + 90 * 24 * 60 * 60 * 1000)
    failSettingsRead = true
    expect(await drafts.recoveryRetentionMs()).toBeNull()
    await drafts.cleanupRecoveryDrafts()
    expect((await drafts.listRecoveryDrafts()).map(draft => draft.id)).toEqual([original.draftId])
    expect((await drafts.getRecoveryStatus('keep')).state).toBe('off')
    expect((await drafts.getRecoveryDraft(original.draftId!))?.conversation.messages[0].content).toBe('original')
    expect((await drafts.startRecoveryProtection('new', snapshot('new content'))).state).toBe('protected')
    expect(await drafts.getRecoveryDraft(original.draftId!)).not.toBeNull()
    expect(storage.remove).not.toHaveBeenCalled()
  })
})
