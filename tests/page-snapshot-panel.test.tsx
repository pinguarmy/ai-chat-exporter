/**
 * PageSnapshotPanel tests (jsdom + mocked chrome APIs; no live provider).
 *
 * Covers: capture entry independent of API verification state, stable capture
 * result rendering, late-response rejection after navigation, Markdown
 * download cancel not reporting success, and recovery enable/stop flow.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import { buildPageSnapshot } from '../src/lib/page-snapshot'
import { EXPORT_CANCELLED_MESSAGE } from '../src/lib/export-cancel'
import type { Conversation } from '../src/lib/types'

vi.mock('../src/lib/snapshot-download', () => ({
  downloadPageSnapshot: vi.fn(),
}))
vi.mock('../src/lib/page-snapshot-cache', () => ({
  requestPageSnapshotPreview: vi.fn(async () => undefined),
}))

import { downloadPageSnapshot } from '../src/lib/snapshot-download'
import { requestPageSnapshotPreview } from '../src/lib/page-snapshot-cache'
import { PageSnapshotPanel } from '../src/components/PageSnapshotPanel'

const downloadMock = vi.mocked(downloadPageSnapshot)
const previewMock = vi.mocked(requestPageSnapshotPreview)

type Listener = (...args: unknown[]) => void

const TAB_ID = 7
const TAB_URL = 'https://gemini.google.com/app/aaaabbbbcccc'

function makeSnapshot(generationState: 'generating' | 'idle' | 'unknown' = 'idle') {
  const conversation = {
    id: 'gemini-local-1',
    title: 'Snapshot test conversation',
    url: TAB_URL,
    platform: 'gemini',
    messages: [
      { id: 'm1', role: 'user', content: 'Hello there' },
      { id: 'm2', role: 'assistant', content: 'General Kenobi' },
    ],
  } as unknown as Conversation
  return buildPageSnapshot(conversation, generationState, 1_700_000_000_000, 'capture-fixed-id')
}

let updatedListeners: Listener[]
let removedListeners: Listener[]
let storageListeners: Listener[]
let tabSendMessage: ReturnType<typeof vi.fn>
let runtimeSendMessage: ReturnType<typeof vi.fn>
let tabsGet: ReturnType<typeof vi.fn>
let tabsCreate: ReturnType<typeof vi.fn>
let clipboardWrite: ReturnType<typeof vi.fn>

function emitUpdated(tabId: number, changeInfo: Record<string, unknown>) {
  for (const listener of [...updatedListeners]) listener(tabId, changeInfo, { id: tabId })
}
function emitRemoved(tabId: number) {
  for (const listener of [...removedListeners]) listener(tabId)
}

beforeEach(() => {
  updatedListeners = []
  removedListeners = []
  storageListeners = []
  tabSendMessage = vi.fn()
  runtimeSendMessage = vi.fn(async () => ({ data: { sessionKey: 'k', state: 'off' } }))
  tabsGet = vi.fn(async (id: number) => ({ id, url: TAB_URL, title: 'Gemini' }))
  tabsCreate = vi.fn(async () => ({}))
  clipboardWrite = vi.fn(async () => undefined)

  const makeEvent = (list: Listener[]) => ({
    addListener: (fn: Listener) => { list.push(fn) },
    removeListener: (fn: Listener) => {
      const index = list.indexOf(fn)
      if (index >= 0) list.splice(index, 1)
    },
  })

  ;(globalThis as Record<string, unknown>).chrome = {
    tabs: {
      get: tabsGet,
      sendMessage: tabSendMessage,
      create: tabsCreate,
      onUpdated: makeEvent(updatedListeners),
      onRemoved: makeEvent(removedListeners),
    },
    runtime: {
      sendMessage: runtimeSendMessage,
      getURL: (path: string) => `chrome-extension://test/${path}`,
    },
    storage: {
      onChanged: makeEvent(storageListeners),
    },
  }
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText: clipboardWrite },
    configurable: true,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/** Echo the requestId like the real content script does. */
function captureResponse(requestId: string, snapshot = makeSnapshot('generating')) {
  return { data: snapshot, meta: { requestId, documentId: 'doc-1', sessionId: 's-1', sessionEpoch: 3 } }
}

function getRequestId(): string {
  const call = tabSendMessage.mock.calls[0]
  return (call?.[1] as { data: { requestId: string } }).data.requestId
}

describe('PageSnapshotPanel capture', () => {
  it('captures via DOM-only request and shows time, count, scope and notice without any API conversation', async () => {
    tabSendMessage.mockImplementation(async (_tabId: number, message: { data: { requestId: string } }) =>
      captureResponse(message.data.requestId))

    render(<PageSnapshotPanel sourceTabId={TAB_ID} locale="en" />)
    fireEvent.click(screen.getByRole('button', { name: 'Capture page snapshot' }))

    await waitFor(() => expect(screen.getByText(/Captured:/)).toBeTruthy())
    expect(tabSendMessage).toHaveBeenCalledWith(TAB_ID, {
      type: 'CAPTURE_PAGE_SNAPSHOT',
      data: { requestId: expect.any(String) },
    })
    // No PARSE_CONVERSATION / provider API request is involved at all.
    expect(tabSendMessage).toHaveBeenCalledTimes(1)
    expect(screen.getByText('2 messages')).toBeTruthy()
    expect(screen.getByText('Still generating')).toBeTruthy()
    expect(screen.getByText('Scope: content observed on this page (DOM only)')).toBeTruthy()
    expect(screen.getByText(/Page snapshot · captured at/)).toBeTruthy()
    expect(screen.getByText(/still generating at capture time/)).toBeTruthy()
  })

  it('keeps a stable snapshot exportable after the source tab closes', async () => {
    tabSendMessage.mockImplementation(async (_tabId: number, message: { data: { requestId: string } }) =>
      captureResponse(message.data.requestId))
    downloadMock.mockResolvedValue('AI Chat Exports/gemini/snap.md')

    render(<PageSnapshotPanel sourceTabId={TAB_ID} locale="en" />)
    fireEvent.click(screen.getByRole('button', { name: 'Capture page snapshot' }))
    await waitFor(() => expect(screen.getByText(/Captured:/)).toBeTruthy())

    act(() => emitRemoved(TAB_ID))
    await waitFor(() => expect(screen.getByText(/source tab was closed/i)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Save Markdown' }))
    await waitFor(() => expect(screen.getByText('Saved AI Chat Exports/gemini/snap.md')).toBeTruthy())
    expect(downloadMock).toHaveBeenCalledTimes(1)
    expect(downloadMock.mock.calls[0][0].captureId).toBe('capture-fixed-id')
  })

  it('rejects a late capture response after navigation invalidates it', async () => {
    let resolveCapture: ((value: unknown) => void) | null = null
    tabSendMessage.mockImplementation(() => new Promise(resolve => { resolveCapture = resolve }))

    render(<PageSnapshotPanel sourceTabId={TAB_ID} locale="en" />)
    fireEvent.click(screen.getByRole('button', { name: 'Capture page snapshot' }))
    await waitFor(() => expect(tabSendMessage).toHaveBeenCalledTimes(1))
    const requestId = getRequestId()

    // Navigation on the source tab invalidates the in-flight request.
    act(() => emitUpdated(TAB_ID, { url: 'https://gemini.google.com/app/other' }))
    await waitFor(() => expect(screen.getByText('The page changed while capturing. Please retry.')).toBeTruthy())

    // The late response arrives afterwards and must be dropped silently.
    await act(async () => { resolveCapture?.(captureResponse(requestId)) })
    expect(screen.queryByText(/Captured:/)).toBeNull()
    expect(screen.getByText('The page changed while capturing. Please retry.')).toBeTruthy()
  })

  it('rejects a response whose requestId was not echoed back', async () => {
    tabSendMessage.mockImplementation(async () => ({ data: makeSnapshot(), meta: { requestId: 'forged' } }))

    render(<PageSnapshotPanel sourceTabId={TAB_ID} locale="en" />)
    fireEvent.click(screen.getByRole('button', { name: 'Capture page snapshot' }))

    await waitFor(() => expect(screen.getByText('The capture response was not recognized. Please retry.')).toBeTruthy())
    expect(screen.queryByText(/Captured:/)).toBeNull()
  })

  it('surfaces content-script capture errors (e.g. unsupported page)', async () => {
    tabSendMessage.mockImplementation(async (_tabId: number, message: { data: { requestId: string } }) =>
      ({ error: 'Page snapshot capture is not supported by this provider.', meta: { requestId: message.data.requestId } }))

    render(<PageSnapshotPanel sourceTabId={TAB_ID} locale="en" />)
    fireEvent.click(screen.getByRole('button', { name: 'Capture page snapshot' }))

    await waitFor(() => expect(screen.getByText(/not supported/)).toBeTruthy())
  })
})

describe('PageSnapshotPanel snapshot actions', () => {
  async function captureStable() {
    tabSendMessage.mockImplementation(async (_tabId: number, message: { data: { requestId: string } }) =>
      captureResponse(message.data.requestId, makeSnapshot('idle')))
    render(<PageSnapshotPanel sourceTabId={TAB_ID} locale="en" settings={{ safeShare: true }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Capture page snapshot' }))
    await waitFor(() => expect(screen.getByText(/Captured:/)).toBeTruthy())
  }

  it('saves Markdown quickly without requiring a preview-cache write', async () => {
    downloadMock.mockResolvedValue('AI Chat Exports/gemini/snap.md')
    await captureStable()

    fireEvent.click(screen.getByRole('button', { name: 'Save Markdown' }))
    await waitFor(() => expect(screen.getByText('Saved AI Chat Exports/gemini/snap.md')).toBeTruthy())
    expect(previewMock).not.toHaveBeenCalled()
  })

  it('does not report success when the download is cancelled', async () => {
    downloadMock.mockRejectedValue(new Error(EXPORT_CANCELLED_MESSAGE))
    await captureStable()

    fireEvent.click(screen.getByRole('button', { name: 'Save Markdown' }))
    await waitFor(() => expect(screen.getByText('Download cancelled. Nothing was saved.')).toBeTruthy())
    expect(screen.queryByText(/^Saved /)).toBeNull()
  })

  it('copies Markdown through the shared output/privacy policy', async () => {
    await captureStable()

    fireEvent.click(screen.getByRole('button', { name: 'Copy Markdown' }))
    await waitFor(() => expect(screen.getByText('Copied Markdown!')).toBeTruthy())
    expect(clipboardWrite).toHaveBeenCalledTimes(1)
    const markdown = clipboardWrite.mock.calls[0][0] as string
    expect(markdown).toContain('Hello there')
    expect(markdown).toContain('Page snapshot')
  })

  it('stores the preview before opening the preview tab, and surfaces storage failure', async () => {
    await captureStable()

    fireEvent.click(screen.getByRole('button', { name: 'Preview ↗' }))
    await waitFor(() => expect(tabsCreate).toHaveBeenCalledWith({
      url: 'chrome-extension://test/tabs/preview.html?snapshot=capture-fixed-id',
    }))
    expect(previewMock).toHaveBeenCalledTimes(1)
    expect(previewMock.mock.calls[0][0].captureId).toBe('capture-fixed-id')

    previewMock.mockRejectedValueOnce(new Error('Snapshot is too large for temporary preview. Save Markdown directly instead.'))
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF ↗' }))
    await waitFor(() => expect(screen.getByText(/too large for temporary preview/)).toBeTruthy())
    // No tab was opened for the failed write.
    expect(tabsCreate).toHaveBeenCalledTimes(1)
  })

  it('does not open a preview when the immutable capture options no longer match', async () => {
    await captureStable()
    previewMock.mockRejectedValueOnce(new Error('Preview settings changed. Recapture the page before opening a new preview or PDF.'))
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF ↗' }))
    await waitFor(() => expect(screen.getByText(/Preview settings changed/)).toBeTruthy())
    expect(tabsCreate).not.toHaveBeenCalled()
  })

  it('opens PDF through the preview page with format=pdf instead of rendering in the popup', async () => {
    await captureStable()

    fireEvent.click(screen.getByRole('button', { name: 'Export PDF ↗' }))
    await waitFor(() => expect(tabsCreate).toHaveBeenCalledWith({
      url: 'chrome-extension://test/tabs/preview.html?snapshot=capture-fixed-id&format=pdf',
    }))
    expect(downloadMock).not.toHaveBeenCalled()
  })
})

describe('PageSnapshotPanel local recovery', () => {
  /** Recovery settings live in a collapsed details; open it like a user would. */
  function openRecoveryDetails() {
    const summary = screen.getByText('Local recovery')
    const details = summary.closest('details') as HTMLDetailsElement
    fireEvent.click(summary)
    expect(details.open).toBe(true)
  }

  it('keeps recovery collapsed by default while the summary shows the protection state', async () => {
    runtimeSendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'GET_RECOVERY_STATUS') return { data: { sessionKey: 'k', state: 'protected', lastSavedAt: 1_700_000_100_000 } }
      return { data: true }
    })

    render(<PageSnapshotPanel sourceTabId={TAB_ID} locale="en" />)
    await waitFor(() => expect(screen.getByText('Protection on')).toBeTruthy())
    const details = screen.getByText('Local recovery').closest('details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    // Last successful save is visible without expanding.
    expect(screen.getByText(/Last saved:/)).toBeTruthy()
  })

  it('is off by default, enables protection with status, and stops it again', async () => {
    const status = { sessionKey: 'gemini:k', state: 'off' as string, lastSavedAt: undefined as number | undefined }
    runtimeSendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'GET_RECOVERY_STATUS') return { data: { ...status } }
      if (message.type === 'START_RECOVERY_PROTECTION') {
        status.state = 'protected'
        status.lastSavedAt = 1_700_000_100_000
        return { data: true }
      }
      if (message.type === 'STOP_RECOVERY_PROTECTION') {
        status.state = 'off'
        return { data: true }
      }
      return { error: 'unexpected' }
    })

    render(<PageSnapshotPanel sourceTabId={TAB_ID} locale="en" />)

    // Default-off explanation is visible after expanding the collapsed details.
    await waitFor(() => expect(screen.getByText('Local recovery')).toBeTruthy())
    openRecoveryDetails()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enable local protection for this conversation' })).toBeTruthy())
    expect(screen.getByText(/stays only in this browser/)).toBeTruthy()
    expect(screen.getByText(/7 days/)).toBeTruthy()
    expect(screen.getByText(/4 MiB/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Enable local protection for this conversation' }))
    await waitFor(() => expect(screen.getByText(/Local protection is on/)).toBeTruthy())
    expect(runtimeSendMessage).toHaveBeenCalledWith({ type: 'START_RECOVERY_PROTECTION', data: { tabId: TAB_ID } })
    expect(screen.getByText(/Last saved:/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Stop protection' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enable local protection for this conversation' })).toBeTruthy())
    expect(runtimeSendMessage).toHaveBeenCalledWith({ type: 'STOP_RECOVERY_PROTECTION', data: { tabId: TAB_ID } })
  })

  it('shows a paused status with its error and opens the recovery page', async () => {
    runtimeSendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'GET_RECOVERY_STATUS') {
        return { data: { sessionKey: 'gemini:k', state: 'paused', error: 'quota exceeded', lastSavedAt: 1_700_000_100_000 } }
      }
      return { data: true }
    })

    render(<PageSnapshotPanel sourceTabId={TAB_ID} locale="en" />)
    // The collapsed summary already flags the paused state and save failure.
    await waitFor(() => expect(screen.getByText('Paused')).toBeTruthy())
    expect(screen.getByText('Save failed')).toBeTruthy()

    openRecoveryDetails()
    await waitFor(() => expect(screen.getByText(/Local protection is paused/)).toBeTruthy())
    expect(screen.getByText(/Save failed: quota exceeded/)).toBeTruthy()

    const openButtons = screen.getAllByRole('button', { name: 'Open recovery page' })
    fireEvent.click(openButtons[0])
    await waitFor(() => expect(tabsCreate).toHaveBeenCalledWith({ url: 'chrome-extension://test/tabs/recovery.html' }))
  })

  it('never stops protection when the component unmounts', async () => {
    runtimeSendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'GET_RECOVERY_STATUS') return { data: { sessionKey: 'k', state: 'protected' } }
      return { data: true }
    })

    const { unmount } = render(<PageSnapshotPanel sourceTabId={TAB_ID} locale="en" />)
    await waitFor(() => expect(screen.getByText(/Local protection is on/)).toBeTruthy())
    unmount()
    expect(runtimeSendMessage).not.toHaveBeenCalledWith({ type: 'STOP_RECOVERY_PROTECTION', data: { tabId: TAB_ID } })
  })
})
