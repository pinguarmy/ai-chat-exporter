/**
 * Popup workflow regression tests (jsdom, real Popup mount, mocked browser APIs).
 *
 * Covers the 1.5.0 popup UX fixes:
 * - A cancelled current export is a neutral notice (not success), survives
 *   time passing, and the button stays immediately retryable.
 * - A successful export reports the real completed download filename and can
 *   reveal the browser download folder via chrome.downloads.showDefaultFolder.
 * - A background manual job lists its failed items (title + category) and
 *   "Retry failed" starts a job with only those ids, while "Resume remaining"
 *   keeps its resume semantics; a cancelled job is labelled as cancelled.
 * - PageSnapshotPanel recapture failures keep the previous snapshot visible
 *   and name both the failure and the kept capture's time; navigation
 *   invalidation during a recapture is shown the same way.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { buildPageSnapshot } from '../src/lib/page-snapshot'
import { EXPORT_CANCELLED_MESSAGE } from '../src/lib/export-cancel'
import { MANUAL_JOB_KEY, type ManualExportJob } from '../src/lib/manual-export-job'
import { mergeExtensionSettings, type Conversation, type ConversationListItem } from '../src/lib/types'

vi.mock('../src/components/ExportOptionsPanel', () => ({ ExportOptionsPanel: () => null }))
vi.mock('../src/components/ExportDiagnostics', () => ({ ExportDiagnostics: () => null }))
vi.mock('../src/components/ExportCoverage', () => ({ ExportCoverage: () => null }))
vi.mock('../src/lib/use-theme-sync', () => ({ useThemeSync: () => undefined }))
vi.mock('../src/lib/use-locale-sync', () => ({ useLocaleSync: () => undefined }))
vi.mock('../src/lib/preview-snapshots', () => ({ requestPreviewSnapshot: vi.fn(async () => undefined) }))
vi.mock('../src/lib/export-download', () => ({ exportConversationFile: vi.fn() }))
vi.mock('../src/lib/export-markdown', () => ({ conversationToMarkdown: () => 'Synthetic test content' }))
vi.mock('../src/lib/conversation-integrity', () => ({
  analyzeConversationIntegrity: vi.fn(() => ({})),
  conversationIntegrityError: vi.fn(() => 'Integrity error'),
  isConversationExportable: vi.fn(() => true),
  isTranscriptVerified: vi.fn(() => true),
}))

import Popup from '../src/popup'
import { PageSnapshotPanel } from '../src/components/PageSnapshotPanel'
import { exportConversationFile } from '../src/lib/export-download'
import { createWorkspaceSession, resetWorkspaceSessionAreaForTests } from '../src/lib/workspace-session'

const exportMock = vi.mocked(exportConversationFile)

const TAB_ID = 7
const TAB_URL = 'https://chatgpt.com/c/synthetic-chat'
const conversation = {
  id: 'c1',
  title: 'Synthetic chat',
  platform: 'chatgpt',
  url: TAB_URL,
  messages: [
    { id: 'u', role: 'user', content: 'Synthetic question' },
    { id: 'a', role: 'assistant', content: 'Synthetic answer' },
  ],
} as unknown as Conversation
const snapshot = buildPageSnapshot(conversation, 'idle', 1_700_000_000_000, 'capture-fixed-id')

function makeJob(overrides: Partial<ManualExportJob> = {}): ManualExportJob {
  return {
    id: 'job-1',
    status: 'done',
    items: [
      { id: 'a', title: 'Archived chat', platform: 'chatgpt' } as ConversationListItem,
      { id: 'b', title: 'Broken chat', platform: 'chatgpt' } as ConversationListItem,
      { id: 'c', title: 'Pending chat', platform: 'chatgpt' } as ConversationListItem,
    ],
    settings: mergeExtensionSettings({}),
    completedIds: ['a'],
    failed: [{ id: 'b', category: 'network_error' }],
    updatedAt: 1_700_000_000_000,
    ...overrides,
  }
}

type Listener = (...args: unknown[]) => void

type SessionArea = {
  get: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  map: Map<string, unknown>
}

function makeSessionArea(): SessionArea {
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

const historyItems = [
  { id: 'a', title: 'Archived chat', platform: 'chatgpt' },
  { id: 'b', title: 'Broken chat', platform: 'chatgpt' },
] as unknown as ConversationListItem[]

let currentJob: ManualExportJob | null
let sessionArea: SessionArea
let updatedListeners: Listener[]
let removedListeners: Listener[]
let tabsGet: ReturnType<typeof vi.fn>
let tabSendMessage: ReturnType<typeof vi.fn>
let tabsCreate: ReturnType<typeof vi.fn>
let runtimeSendMessage: ReturnType<typeof vi.fn>
let showDefaultFolder: ReturnType<typeof vi.fn>

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function captureResponse(requestId: string) {
  return { data: snapshot, meta: { requestId } }
}
function emitUpdated(tabId: number, changeInfo: Record<string, unknown>) {
  for (const listener of [...updatedListeners]) listener(tabId, changeInfo, { id: tabId })
}

beforeEach(() => {
  vi.resetAllMocks()
  currentJob = null
  sessionArea = makeSessionArea()
  updatedListeners = []
  removedListeners = []
  tabsGet = vi.fn(async () => ({ id: TAB_ID, url: TAB_URL }))
  tabsCreate = vi.fn(async () => ({}))
  showDefaultFolder = vi.fn()
  tabSendMessage = vi.fn(async (_id: number, message: { type: string; data?: { requestId: string } }) => {
    if (message.type === 'PARSE_CONVERSATION') return { data: conversation }
    if (message.type === 'CAPTURE_PAGE_SNAPSHOT') return captureResponse(message.data!.requestId)
    if (message.type === 'FETCH_ALL_CONVERSATIONS') return { data: historyItems, meta: { source: 'api', complete: true } }
    throw new Error(`Unexpected tab message: ${message.type}`)
  })
  runtimeSendMessage = vi.fn(async (message: { type: string }) => {
    if (message.type === 'START_MANUAL_EXPORT') return { data: currentJob ?? makeJob() }
    if (message.type === 'GET_EXPORTED_CONVERSATION_IDS') return { data: ['a'] }
    return { data: true }
  })
  const makeEvent = (list: Listener[]) => ({
    addListener: (fn: Listener) => { list.push(fn) },
    removeListener: (fn: Listener) => {
      const index = list.indexOf(fn)
      if (index >= 0) list.splice(index, 1)
    },
  })
  vi.stubGlobal('chrome', {
    tabs: {
      query: vi.fn(async () => [{ id: TAB_ID, url: TAB_URL }]),
      get: tabsGet,
      sendMessage: tabSendMessage,
      create: tabsCreate,
      onUpdated: makeEvent(updatedListeners),
      onRemoved: makeEvent(removedListeners),
    },
    runtime: { sendMessage: runtimeSendMessage, getURL: (path: string) => `chrome-extension://test/${path}` },
    downloads: { showDefaultFolder },
    storage: {
      local: { get: vi.fn(async () => ({ settings: { locale: 'en', defaultFormat: 'markdown', archiveBundle: false }, [MANUAL_JOB_KEY]: currentJob ?? undefined })) },
      session: sessionArea,
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  })
  resetWorkspaceSessionAreaForTests()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  window.history.pushState({}, '', '/')
})

async function openPopup() {
  render(<Popup />)
  await screen.findByText('Synthetic chat')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Export as Markdown' })).toBeTruthy())
}
function exportButton() {
  return screen.getByRole('button', { name: 'Export as Markdown' })
}

describe('popup current export outcome states', () => {
  it('treats a cancelled export as a neutral, immediately retryable state', async () => {
    exportMock.mockRejectedValueOnce(new Error(EXPORT_CANCELLED_MESSAGE))
    await openPopup()
    fireEvent.click(exportButton())
    await screen.findByText('Export stopped. Completed files were kept.')
    // Cancellation is not a success and must not lock the button.
    expect(screen.queryByText('Export Successful')).toBeNull()
    expect(exportButton()).toHaveProperty('disabled', false)

    // Time passing does not flip the neutral notice or lock the button.
    vi.useFakeTimers()
    act(() => { vi.advanceTimersByTime(60_000) })
    vi.useRealTimers()
    expect(screen.getByText('Export stopped. Completed files were kept.')).toBeTruthy()
    expect(screen.queryByText('Export Successful')).toBeNull()
    expect(exportButton()).toHaveProperty('disabled', false)

    // The user can retry right away; success then reports the real filename.
    exportMock.mockResolvedValueOnce('AI Chat Exports/synthetic-chat.md')
    fireEvent.click(exportButton())
    await screen.findByText('Exported: AI Chat Exports/synthetic-chat.md')
    expect(screen.queryByText('Export stopped. Completed files were kept.')).toBeNull()
  })

  it('shows the completed download filename and opens the browser download folder on demand', async () => {
    exportMock.mockResolvedValueOnce('AI Chat Exports/synthetic-chat.md')
    await openPopup()
    fireEvent.click(exportButton())
    await screen.findByText('Exported: AI Chat Exports/synthetic-chat.md')

    fireEvent.click(screen.getByRole('button', { name: 'Open download folder' }))
    expect(showDefaultFolder).toHaveBeenCalledTimes(1)

    // Success is a confirmation, not a lockout: the button stays usable.
    expect(exportButton()).toHaveProperty('disabled', false)
  })
})

describe('popup background manual job failures', () => {
  it('lists failed items with titles and retries only those, keeping Resume remaining semantics', async () => {
    currentJob = makeJob()
    await openPopup()

    await screen.findByText('Failed items:')
    expect(screen.getByText('Broken chat')).toBeTruthy()
    expect(screen.getByText('Network error')).toBeTruthy()
    // Completed and pending items are not part of the failure list.
    expect(screen.queryByText('Pending chat')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Retry failed (1)' }))
    await waitFor(() => expect(runtimeSendMessage).toHaveBeenCalledWith({
      type: 'START_MANUAL_EXPORT',
      data: { items: [currentJob!.items[1]], settings: currentJob!.settings },
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Resume remaining' }))
    await waitFor(() => expect(runtimeSendMessage).toHaveBeenCalledWith({
      type: 'START_MANUAL_EXPORT',
      data: { resume: true },
    }))
  })

  it('labels a cancelled background job as cancelled, not interrupted', async () => {
    currentJob = makeJob({ status: 'cancelled', failed: [] })
    await openPopup()
    await screen.findByText(/Background export/)
    expect(screen.getByText(/Background export/).textContent).toContain('Cancelled')
    expect(screen.getByText(/Background export/).textContent).not.toContain('Interrupted')
  })
})

describe('current-chat orientation and receipt', () => {
  it('makes message selection discoverable and reports preview failures without losing the source', async () => {
    const { requestPreviewSnapshot } = await import('../src/lib/preview-snapshots')
    await openPopup()
    vi.mocked(requestPreviewSnapshot).mockRejectedValueOnce(new Error('storage full'))
    fireEvent.click(screen.getByRole('button', { name: 'Preview & select messages' }))
    await screen.findByText('Preview is unavailable right now.')
    expect(screen.getByText('Synthetic chat')).toBeTruthy()
    expect(tabsCreate).not.toHaveBeenCalled()
  })
  it('shows a redacted filename receipt and destination before exporting a share copy', async () => {
    const secret = 'sk-SYNTHETICONBOARDINGCREDENTIAL123456'
    tabSendMessage.mockResolvedValue({ data: { ...conversation, title: `Title ${secret}` } })
    vi.mocked(chrome.storage.local.get).mockResolvedValue({ settings: { locale: 'en', safeShare: true, filenamePattern: '{title}-{id}' } })
    render(<Popup />)
    await screen.findByText(`Title ${secret}`)
    expect(screen.getByText(/Will download:/).textContent).not.toContain(secret)
    expect(screen.getByText(/Destination: Browser default download folder/)).toBeTruthy()
    expect(screen.getByText(/Share copy is on/)).toBeTruthy()
    expect(exportMock).not.toHaveBeenCalled()
  })
})

describe('popup workspace handoff restore', () => {
  it('restores mode, format, selection and session options even when detection resolves late', async () => {
    // The provider read is slow: the restore applies first, and the late
    // detection must not wipe the restored selection.
    const baseTabSend = tabSendMessage.getMockImplementation()!
    tabSendMessage.mockImplementation(async (id: number, message: { type: string; data?: { requestId: string } }) => {
      if (message.type === 'PARSE_CONVERSATION') await new Promise(resolve => setTimeout(resolve, 30))
      return baseTabSend(id, message)
    })

    const handoffId = await createWorkspaceSession({
      sourceTabId: TAB_ID,
      tabMode: 'bulk',
      format: 'pdf',
      selectedIds: ['a', 'b'],
      searchQuery: '',
      bulkFromDate: '',
      bulkToDate: '',
      bulkSelectionLimit: '100',
      settingsPatch: {
        skipAlreadyExported: false,
        // Content-shaped sentinels must never cross the hand-off.
        conversationContent: 'PRIVATE CHAT TEXT',
      } as never,
    })
    window.history.pushState({}, '', `/popup.html?sourceTab=${TAB_ID}&ws=${handoffId}`)

    render(<Popup />)

    // Bulk mode, PDF format, and the restored selection survive detection.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Bulk Export' }).getAttribute('aria-pressed')).toBe('true'))
    await screen.findByText('Selected 2 · Will export 2 · Skip 0')
    // Let the delayed provider read resolve; the late detection must not wipe
    // the restored selection.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)) })
    expect(screen.getByText('Selected 2 · Will export 2 · Skip 0')).toBeTruthy()
    // The restored session option is what keeps the archived item 'a' out of
    // the skip count (the duplicate index reports it as exported).
    expect(screen.getByText('Scope: 2 selected conversations · PDF document · saved to Browser default download folder')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reading PDF' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Export 2 Selected' })).toBeTruthy()
    // Both restored ids matched the refreshed list: no reconcile notice, and
    // no handoff error notice.
    expect(screen.queryByText(/restored selection\(s\)/)).toBeNull()
    expect(screen.queryByText(/workspace handoff/)).toBeNull()
    expect(screen.queryByText(/PRIVATE CHAT TEXT/)).toBeNull()
    // Single-use: the record was deleted on consume.
    expect(sessionArea.map.has(`workspaceSession:${handoffId}`)).toBe(false)
  })

  it('shows an explicit notice for an already-used handoff', async () => {
    window.history.pushState({}, '', `/popup.html?sourceTab=${TAB_ID}&ws=used-id`)
    render(<Popup />)
    await screen.findByText('The workspace handoff expired or was already used. Defaults were restored; please reselect conversations.')
  })
})

describe('PageSnapshotPanel recapture failure', () => {
  async function captureOnce() {
    render(<PageSnapshotPanel sourceTabId={TAB_ID} locale="en" recoveryAvailable={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Capture page snapshot' }))
    await screen.findByText(/Captured:/)
  }

  it('keeps the previous snapshot and names the failure plus the kept capture time', async () => {
    await captureOnce()

    tabSendMessage.mockImplementation(async (_id: number, message: { data: { requestId: string } }) =>
      ({ error: 'Synthetic recapture failure', meta: { requestId: message.data.requestId } }))
    fireEvent.click(screen.getByRole('button', { name: 'Recapture' }))

    await screen.findByText('Recapture failed: Synthetic recapture failure')
    expect(screen.getByText(/Showing the previous capture from/)).toBeTruthy()
    // The old capture stays fully visible and usable.
    expect(screen.getByText(/Captured:/)).toBeTruthy()
    expect(screen.getByText('2 messages')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save Markdown' })).toBeTruthy()

    // A later successful recapture clears the failure.
    tabSendMessage.mockImplementation(async (_id: number, message: { data: { requestId: string } }) =>
      captureResponse(message.data.requestId))
    fireEvent.click(screen.getByRole('button', { name: 'Recapture' }))
    await waitFor(() => expect(screen.queryByText(/Recapture failed:/)).toBeNull())
    expect(screen.getByText(/Captured:/)).toBeTruthy()
  })

  it('shows navigation invalidation the same way during a recapture', async () => {
    await captureOnce()

    const secondCapture = deferred<ReturnType<typeof captureResponse>>()
    tabSendMessage.mockImplementation(() => secondCapture.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Recapture' }))
    await waitFor(() => expect(tabSendMessage).toHaveBeenCalledTimes(2))

    act(() => emitUpdated(TAB_ID, { status: 'loading' }))
    await screen.findByText('Recapture failed: The page changed while capturing. Please retry.')
    expect(screen.getByText(/Showing the previous capture from/)).toBeTruthy()
    expect(screen.getByText(/Captured:/)).toBeTruthy()

    // The late response is dropped without touching the kept snapshot.
    await act(async () => secondCapture.resolve(captureResponse('late')))
    expect(screen.getByText(/Captured:/)).toBeTruthy()
    expect(tabSendMessage).toHaveBeenCalledTimes(2)
  })
})
