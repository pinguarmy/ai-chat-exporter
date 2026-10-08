import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPageSnapshot } from '../src/lib/page-snapshot'
import type { PageSnapshot } from '../src/lib/types'

const DAY = 24 * 60 * 60 * 1000
const store: Record<string, unknown> = {}
const local = {
  get: vi.fn(async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in store).map(k => [k, store[k]]))),
  set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(store, items) }),
  remove: vi.fn(async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key] }),
}

function snapshot(platform: 'gemini' | 'claude' = 'gemini'): PageSnapshot {
  return buildPageSnapshot({
    id: 'c', title: 'Conversation', url: `https://${platform}.example/app/1`, platform,
    messages: [{ id: 'm1', role: 'user', content: 'hello' }, { id: 'm2', role: 'assistant', content: 'hi' }],
  }, 'idle')
}

describe('recovery draft retention setting', () => {
  let drafts: typeof import('../src/lib/recovery-drafts')

  beforeEach(async () => {
    for (const key of Object.keys(store)) delete store[key]
    vi.stubGlobal('chrome', { storage: { local } })
    vi.resetModules()
    drafts = await import('../src/lib/recovery-drafts')
  })

  const startDraft = async () => (await drafts.startRecoveryProtection('gemini:1', snapshot())).draftId!

  it('defaults to seven days when no setting is stored', async () => {
    expect(await drafts.recoveryRetentionMs()).toBe(7 * DAY)
    const id = await startDraft()
    await drafts.cleanupRecoveryDrafts(Date.now() + 8 * DAY)
    expect(await drafts.getRecoveryDraft(id)).toBeNull()
  })

  it('keeps drafts for the chosen longer period', async () => {
    store.settings = { recoveryRetentionDays: 30 }
    const id = await startDraft()
    await drafts.cleanupRecoveryDrafts(Date.now() + 8 * DAY)
    expect(await drafts.getRecoveryDraft(id)).not.toBeNull()
    await drafts.cleanupRecoveryDrafts(Date.now() + 31 * DAY)
    expect(await drafts.getRecoveryDraft(id)).toBeNull()
  })

  it('never expires drafts when set to keep until deleted', async () => {
    store.settings = { recoveryRetentionDays: 0 }
    expect(await drafts.recoveryRetentionMs()).toBeNull()
    const id = await startDraft()
    await drafts.cleanupRecoveryDrafts(Date.now() + 3650 * DAY)
    expect(await drafts.getRecoveryDraft(id)).not.toBeNull()
  })

  it('falls back to seven days for an unexpected stored value', async () => {
    store.settings = { recoveryRetentionDays: 12345 }
    expect(await drafts.recoveryRetentionMs()).toBe(7 * DAY)
  })
})

describe('requestPageSnapshotFromTab', () => {
  let capture: typeof import('../src/lib/page-snapshot-capture')
  const tabs = { get: vi.fn(), sendMessage: vi.fn() }

  beforeEach(async () => {
    tabs.get.mockReset(); tabs.sendMessage.mockReset()
    vi.stubGlobal('chrome', { tabs })
    vi.resetModules()
    capture = await import('../src/lib/page-snapshot-capture')
  })

  it('returns the snapshot when the response matches and the page did not move', async () => {
    const captured = snapshot('claude')
    tabs.get.mockResolvedValue({ url: 'https://claude.ai/chat/1' })
    tabs.sendMessage.mockResolvedValue({ data: captured, meta: { requestId: 'r1' } })
    await expect(capture.requestPageSnapshotFromTab(7, 'r1')).resolves.toEqual(captured)
    expect(tabs.sendMessage).toHaveBeenCalledWith(7, { type: 'CAPTURE_PAGE_SNAPSHOT', data: { requestId: 'r1' } })
  })

  it('rejects a response for another request', async () => {
    tabs.get.mockResolvedValue({ url: 'https://claude.ai/chat/1' })
    tabs.sendMessage.mockResolvedValue({ data: snapshot('claude'), meta: { requestId: 'other' } })
    await expect(capture.requestPageSnapshotFromTab(7, 'r1')).rejects.toThrow(capture.CAPTURE_NOT_RECOGNIZED)
  })

  it('rejects a capture when the page navigated meanwhile', async () => {
    tabs.get.mockResolvedValueOnce({ url: 'https://claude.ai/chat/1' }).mockResolvedValueOnce({ url: 'https://claude.ai/chat/2' })
    tabs.sendMessage.mockResolvedValue({ data: snapshot('claude'), meta: { requestId: 'r1' } })
    await expect(capture.requestPageSnapshotFromTab(7, 'r1')).rejects.toThrow(capture.PAGE_CHANGED)
  })

  it('passes through the content-script error', async () => {
    tabs.get.mockResolvedValue({ url: 'https://claude.ai/chat/1' })
    tabs.sendMessage.mockResolvedValue({ error: 'No capturable conversation content is currently visible on this page.', meta: { requestId: 'r1' } })
    await expect(capture.requestPageSnapshotFromTab(7, 'r1')).rejects.toThrow('No capturable conversation content')
  })

  it('drops a superseded request silently', async () => {
    tabs.get.mockResolvedValue({ url: 'https://claude.ai/chat/1' })
    tabs.sendMessage.mockResolvedValue({ data: snapshot('claude'), meta: { requestId: 'r1' } })
    await expect(capture.requestPageSnapshotFromTab(7, 'r1', () => false)).resolves.toBeNull()
  })
})
