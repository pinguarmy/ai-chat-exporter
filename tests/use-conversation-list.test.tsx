/**
 * useConversationList: Bulk Export history loading (mocked chrome, no UI).
 * Covers completeness metadata, the archive index lookup, reconciliation of a
 * workspace-restored selection, failure state and stale-load protection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ConversationListItem } from '../src/lib/types'
import { useConversationList } from '../src/components/popup/hooks/useConversationList'
import { useHandoffRefs } from '../src/components/popup/hooks/useHandoffRefs'

const TAB_ID = 5
const items = [
  { id: 'a', title: 'Chat A', platform: 'chatgpt' },
  { id: 'b', title: 'Chat B', platform: 'chatgpt' },
] as unknown as ConversationListItem[]

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

let tabSendMessage: ReturnType<typeof vi.fn>
let runtimeSendMessage: ReturnType<typeof vi.fn>

beforeEach(() => {
  tabSendMessage = vi.fn(async (_id: number, message: { type: string }) => {
    if (message.type === 'FETCH_ALL_CONVERSATIONS') return { data: items, meta: { source: 'api', complete: true, pagesFetched: 2 } }
    throw new Error(`Unexpected tab message: ${message.type}`)
  })
  runtimeSendMessage = vi.fn(async (message: { type: string }) => {
    if (message.type === 'GET_EXPORTED_CONVERSATION_IDS') return { data: ['a'] }
    return { data: true }
  })
  vi.stubGlobal('chrome', {
    tabs: { query: vi.fn(async () => [{ id: TAB_ID }]), get: vi.fn(), sendMessage: tabSendMessage },
    runtime: { sendMessage: runtimeSendMessage },
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
})

function mount() {
  const setHandoffNotice = vi.fn()
  const view = renderHook(() => {
    const handoff = useHandoffRefs()
    const list = useConversationList({ locale: 'en', handoff, setHandoffNotice })
    return { handoff, list }
  })
  return { ...view, setHandoffNotice }
}

describe('useConversationList', () => {
  it('loads the account list with its completeness metadata and the archive index', async () => {
    const { result } = mount()

    await act(async () => { await result.current.list.fetchConversationList() })

    expect(result.current.list.conversationList).toEqual(items)
    expect(result.current.list.conversationListMeta).toEqual({ source: 'api', complete: true, pagesFetched: 2 })
    expect(result.current.list.bulkLoading).toBe(false)
    expect(runtimeSendMessage).toHaveBeenCalledWith({ type: 'GET_EXPORTED_CONVERSATION_IDS', data: 'chatgpt' })
    expect(result.current.list.exportedConversationIds).toEqual(['a'])
  })

  it('falls back to the sidebar list and says the history is incomplete', async () => {
    tabSendMessage.mockImplementation(async (_id: number, message: { type: string }) => {
      if (message.type === 'FETCH_ALL_CONVERSATIONS') return { error: 'rate limited' }
      return { data: [items[0]] }
    })
    const { result } = mount()

    await act(async () => { await result.current.list.fetchConversationList() })

    expect(result.current.list.conversationList).toEqual([items[0]])
    expect(result.current.list.conversationListMeta).toMatchObject({ source: 'sidebar', complete: false })
  })

  it('drops selections that are not in the refreshed list and reports restored ones that vanished', async () => {
    const { result, setHandoffNotice } = mount()
    act(() => {
      result.current.list.setSelectedIds(['a', 'gone', 'b'])
      result.current.handoff.restoredSelectionRef.current = ['a', 'gone', 'also-gone']
    })

    await act(async () => { await result.current.list.fetchConversationList() })

    expect(result.current.list.selectedIds).toEqual(['a', 'b'])
    expect(setHandoffNotice).toHaveBeenCalledWith('2 restored selection(s) are not in the refreshed list and were skipped.')
    // The restore is single-use: a later refresh must not re-report it.
    expect(result.current.handoff.restoredSelectionRef.current).toBeNull()
  })

  it('clears the list and explains the failure when history cannot be loaded', async () => {
    tabSendMessage.mockRejectedValue(new Error('no content script'))
    const { result } = mount()
    act(() => { result.current.list.setSelectedIds(['a']) })

    await act(async () => { await result.current.list.fetchConversationList() })

    expect(result.current.list.conversationList).toEqual([])
    expect(result.current.list.selectedIds).toEqual([])
    expect(result.current.list.conversationListNotice).toBe('History could not be loaded. Reload the provider page and refresh the list.')
    expect(result.current.list.bulkLoading).toBe(false)
  })

  it('ignores a slow load that finishes after the tab changed (resetForNewTab)', async () => {
    const slow = deferred<{ data: ConversationListItem[]; meta: Record<string, unknown> }>()
    tabSendMessage.mockImplementation(async (_id: number, message: { type: string }) => {
      if (message.type === 'FETCH_ALL_CONVERSATIONS') return slow.promise
      throw new Error('unexpected')
    })
    const { result } = mount()

    let pending!: Promise<void>
    act(() => { pending = result.current.list.fetchConversationList() })
    expect(result.current.list.bulkLoading).toBe(true)

    act(() => { result.current.list.resetForNewTab() })
    expect(result.current.list.bulkLoading).toBe(false)

    await act(async () => { slow.resolve({ data: items, meta: { source: 'api', complete: true } }); await pending })
    expect(result.current.list.conversationList).toEqual([])
    expect(result.current.list.conversationListMeta).toBeNull()
  })

  it('shows an authentication notice returned by the provider read', async () => {
    tabSendMessage.mockImplementation(async (_id: number, message: { type: string }) => {
      if (message.type === 'FETCH_ALL_CONVERSATIONS') return { data: [], meta: { authRequired: true, source: 'api', complete: false } }
      throw new Error('unexpected')
    })
    const { result } = mount()

    await act(async () => { await result.current.list.fetchConversationList() })

    expect(result.current.list.conversationListNotice).toBe('Sign in to the provider, then refresh the conversation list.')
    expect(runtimeSendMessage).not.toHaveBeenCalled()
    expect(result.current.list.exportedConversationIds).toEqual([])
  })
})
