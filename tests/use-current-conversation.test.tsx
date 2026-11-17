/**
 * useCurrentConversation: active-tab detection (mocked chrome.tabs, no UI).
 * Pins the ordering guarantees the popup relies on: only the latest read may
 * commit, navigation of the bound tab invalidates in-flight reads, and a
 * workspace hand-off restore suppresses the "new tab" list reset.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { Conversation } from '../src/core/types'

vi.mock('../src/platform/preview-snapshots', () => ({ requestPreviewSnapshot: vi.fn(async () => undefined) }))

import { useCurrentConversation } from '../src/components/popup/hooks/useCurrentConversation'
import { useHandoffRefs } from '../src/components/popup/hooks/useHandoffRefs'

type TabListener = (tabId: number, changeInfo: Record<string, unknown>) => void

const TAB_ID = 11
const T = (key: string) => key
const makeConversation = (id: string, title = 'Synthetic chat'): Conversation => ({
  id,
  title,
  platform: 'chatgpt',
  url: 'https://chatgpt.com/c/' + id,
  messages: [{ id: 'm1', role: 'user', content: 'Synthetic question' }],
} as unknown as Conversation)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

let tabUrl: string
let sendMessage: ReturnType<typeof vi.fn>
let listeners: TabListener[]

beforeEach(() => {
  tabUrl = 'https://chatgpt.com/c/one'
  listeners = []
  sendMessage = vi.fn(async () => ({ data: makeConversation('one') }))
  vi.stubGlobal('chrome', {
    tabs: {
      query: vi.fn(async () => [{ id: TAB_ID, url: tabUrl, title: 'Tab title' }]),
      get: vi.fn(),
      sendMessage,
      onUpdated: {
        addListener: (fn: TabListener) => { listeners.push(fn) },
        removeListener: (fn: TabListener) => { listeners.splice(listeners.indexOf(fn), 1) },
      },
    },
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function mount() {
  const resetListForNewTab = vi.fn()
  const setters = { setSuccess: vi.fn(), setExportNotice: vi.fn(), setExportResult: vi.fn() }
  const view = renderHook(() => {
    const handoff = useHandoffRefs()
    const current = useCurrentConversation({ T, handoff, resetListForNewTab, ...setters })
    return { handoff, current }
  })
  return { ...view, resetListForNewTab, setters }
}

describe('useCurrentConversation', () => {
  it('detects the provider, binds the tab and commits the verified conversation', async () => {
    const { result, resetListForNewTab, setters } = mount()

    await waitFor(() => expect(result.current.current.conversation?.id).toBe('one'))
    expect(result.current.current.platform).toBe('chatgpt')
    expect(result.current.current.sourceTabId).toBe(TAB_ID)
    expect(result.current.current.currentReadError).toBeNull()
    expect(sendMessage).toHaveBeenCalledWith(TAB_ID, { type: 'PARSE_CONVERSATION', data: { forceVerify: true } })
    // First sight of a tab resets the previous tab's list and clears stale outcomes.
    expect(resetListForNewTab).toHaveBeenCalledTimes(1)
    expect(setters.setSuccess).toHaveBeenCalledWith(null)
    expect(setters.setExportResult).toHaveBeenCalledWith(null)
  })

  it('does not message the page when the tab is not a supported provider', async () => {
    tabUrl = 'https://example.com/'
    const { result } = mount()

    await waitFor(() => expect(chrome.tabs.query).toHaveBeenCalled())
    await act(async () => { await Promise.resolve() })
    expect(result.current.current.platform).toBeNull()
    expect(result.current.current.conversation).toBeNull()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('reports an unverifiable read without discarding the detected provider', async () => {
    sendMessage.mockResolvedValue({ error: 'Provider API unavailable' })
    const { result } = mount()

    await waitFor(() => expect(result.current.current.currentReadError).toBe('Provider API unavailable'))
    expect(result.current.current.platform).toBe('chatgpt')
    expect(result.current.current.conversation).toBeNull()
  })

  it('flags a page without an open conversation separately from an error', async () => {
    sendMessage.mockResolvedValue({ meta: { noConversation: true } })
    const { result } = mount()

    await waitFor(() => expect(result.current.current.noCurrentConversation).toBe(true))
    expect(result.current.current.currentReadError).toBeNull()
  })

  it('ignores an older read that resolves after a newer one', async () => {
    const slow = deferred<{ data: Conversation }>()
    sendMessage.mockReturnValueOnce(slow.promise)
    const { result } = mount()
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1))

    sendMessage.mockResolvedValueOnce({ data: makeConversation('two') })
    await act(async () => { await result.current.current.detectPlatformAndConversation() })
    expect(result.current.current.conversation?.id).toBe('two')

    await act(async () => { slow.resolve({ data: makeConversation('stale') }); await slow.promise })
    expect(result.current.current.conversation?.id).toBe('two')
  })

  it('invalidates an in-flight read when the bound tab navigates', async () => {
    const slow = deferred<{ data: Conversation }>()
    sendMessage.mockReturnValueOnce(slow.promise)
    const { result } = mount()
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1))

    // Navigation of the bound tab bumps the sequence immediately (no 300ms wait).
    act(() => { listeners.forEach(listener => listener(TAB_ID, { url: 'https://chatgpt.com/c/next' })) })
    await act(async () => { slow.resolve({ data: makeConversation('stale') }); await slow.promise })
    expect(result.current.current.conversation).toBeNull()
  })

  it('leaves detection alone for updates from other tabs and debounces re-detection', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result } = mount()
    await waitFor(() => expect(result.current.current.conversation?.id).toBe('one'))
    sendMessage.mockClear()

    act(() => { listeners.forEach(listener => listener(TAB_ID + 1, { url: 'https://chatgpt.com/c/other' })) })
    expect(sendMessage).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1))
  })

  it('keeps a hand-off restored selection instead of resetting the list for a new tab', async () => {
    const resetListForNewTab = vi.fn()
    const { result } = renderHook(() => {
      const handoff = useHandoffRefs()
      // A restore is in flight before the first detection resolves.
      handoff.handoffInflightRef.current = true
      const current = useCurrentConversation({
        T, handoff, resetListForNewTab,
        setSuccess: vi.fn(), setExportNotice: vi.fn(), setExportResult: vi.fn(),
      })
      return { handoff, current }
    })

    await waitFor(() => expect(result.current.current.conversation?.id).toBe('one'))
    expect(resetListForNewTab).not.toHaveBeenCalled()
  })

  it('consumes the one-shot reset skip so the next new tab does reset', async () => {
    const { result, resetListForNewTab } = mount()
    await waitFor(() => expect(result.current.current.conversation?.id).toBe('one'))
    expect(resetListForNewTab).toHaveBeenCalledTimes(1)

    result.current.handoff.handoffResetSkipRef.current = true
    vi.mocked(chrome.tabs.query).mockResolvedValue([{ id: TAB_ID + 1, url: tabUrl } as chrome.tabs.Tab])
    await act(async () => { await result.current.current.detectPlatformAndConversation() })
    expect(resetListForNewTab).toHaveBeenCalledTimes(1)
    expect(result.current.handoff.handoffResetSkipRef.current).toBe(false)

    vi.mocked(chrome.tabs.query).mockResolvedValue([{ id: TAB_ID + 2, url: tabUrl } as chrome.tabs.Tab])
    await act(async () => { await result.current.current.detectPlatformAndConversation() })
    expect(resetListForNewTab).toHaveBeenCalledTimes(2)
  })
})
