/** Popup UI regression tests with synthetic content and mocked browser/download APIs. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { buildPageSnapshot } from '../src/lib/page-snapshot'
import { EXPORT_CANCELLED_MESSAGE } from '../src/lib/export-cancel'
import { requestPageSnapshotFromTab } from '../src/lib/page-snapshot-capture'
import type { Conversation } from '../src/lib/types'

vi.mock('../src/components/PageSnapshotPanel', () => ({ PageSnapshotPanel: () => null }))
vi.mock('../src/components/ExportOptionsPanel', () => ({ ExportOptionsPanel: () => null }))
vi.mock('../src/components/ExportDiagnostics', () => ({ ExportDiagnostics: () => null }))
vi.mock('../src/lib/use-theme-sync', () => ({ useThemeSync: () => undefined }))
vi.mock('../src/lib/use-locale-sync', () => ({ useLocaleSync: () => undefined }))
vi.mock('../src/lib/preview-snapshots', () => ({ requestPreviewSnapshot: vi.fn(async () => undefined) }))
vi.mock('../src/lib/page-snapshot-cache', () => ({ requestPageSnapshotPreview: vi.fn(async () => undefined) }))
vi.mock('../src/lib/snapshot-download', () => ({ downloadPageSnapshot: vi.fn() }))
vi.mock('../src/lib/export-download', () => ({ exportConversationFile: vi.fn() }))
vi.mock('../src/lib/export-markdown', () => ({ conversationToMarkdown: () => 'Synthetic test content' }))

import Popup from '../src/popup'
import { requestPageSnapshotPreview } from '../src/lib/page-snapshot-cache'
import { downloadPageSnapshot } from '../src/lib/snapshot-download'
import { exportConversationFile } from '../src/lib/export-download'

const TAB_ID = 7
const TAB_URL = 'https://gemini.google.com/app/synthetic-test'
const conversation: Conversation = {
  id: 'synthetic-conversation', title: 'Synthetic fallback chat', platform: 'gemini', url: TAB_URL,
  source: 'dom', sourceCompleteness: 'unverified',
  messages: [{ id: 'u', role: 'user', content: 'Synthetic question' }, { id: 'a', role: 'assistant', content: 'Synthetic response' }],
}
const snapshot = buildPageSnapshot(conversation, 'idle', 1_700_000_000_000, 'capture/fixed id')
const downloadMock = vi.mocked(downloadPageSnapshot)
const previewMock = vi.mocked(requestPageSnapshotPreview)
let updatedListeners: Array<(tabId: number, change: chrome.tabs.TabChangeInfo) => void>
let tabsGet: ReturnType<typeof vi.fn>
let tabSendMessage: ReturnType<typeof vi.fn>
let tabsCreate: ReturnType<typeof vi.fn>
let runtimeSendMessage: ReturnType<typeof vi.fn>

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function captureResponse(requestId: string) {
  return { data: snapshot, meta: { requestId } }
}
function assertNotArchived() {
  expect(exportConversationFile).not.toHaveBeenCalled()
  expect(runtimeSendMessage.mock.calls.some(([message]) => /REGISTER|EXPORTED|ARCHIVE/.test(message.type))).toBe(false)
}
function assertNoSavedSuccess() {
  expect(screen.queryByText(/page snapshot was saved instead/)).toBeNull()
  expect(screen.queryByText('Export Successful')).toBeNull()
}
async function openPopup() {
  render(<Popup />)
  await screen.findByText('Synthetic fallback chat')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save page snapshot Markdown' })).toBeTruthy())
}
function exportMarkdown() {
  fireEvent.click(screen.getByRole('button', { name: 'Save page snapshot Markdown' }))
}

beforeEach(() => {
  vi.resetAllMocks()
  updatedListeners = []
  tabsGet = vi.fn(async () => ({ id: TAB_ID, url: TAB_URL }))
  tabsCreate = vi.fn(async () => ({}))
  runtimeSendMessage = vi.fn(async () => ({ data: true }))
  tabSendMessage = vi.fn(async (_id: number, message: { type: string; data?: { requestId: string } }) => {
    if (message.type === 'PARSE_CONVERSATION') return { data: conversation }
    if (message.type === 'CAPTURE_PAGE_SNAPSHOT') return captureResponse(message.data!.requestId)
    throw new Error(`Unexpected message: ${message.type}`)
  })
  downloadMock.mockResolvedValue('snapshots/synthetic-page-snapshot.md')
  previewMock.mockResolvedValue(undefined)
  vi.stubGlobal('chrome', {
    tabs: {
      query: vi.fn(async () => [{ id: TAB_ID, url: TAB_URL }]),
      get: tabsGet, sendMessage: tabSendMessage, create: tabsCreate,
      onUpdated: {
        addListener: (listener: (typeof updatedListeners)[number]) => updatedListeners.push(listener),
        removeListener: (listener: (typeof updatedListeners)[number]) => {
          updatedListeners = updatedListeners.filter(item => item !== listener)
        },
      },
    },
    runtime: { sendMessage: runtimeSendMessage, getURL: (path: string) => `chrome-extension://test/${path}` },
    storage: {
      local: { get: vi.fn(async () => ({ settings: { locale: 'en', defaultFormat: 'markdown', archiveBundle: false } })) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Popup unverified-source snapshot fallback', () => {
  it('offers only snapshot formats when the current source is unverified', async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue({ settings: { locale: 'en', archiveBundle: true } })
    await openPopup()
    expect(screen.queryByRole('button', { name: 'Archive ZIP', exact: true })).toBeNull()
    expect(screen.getByRole('button', { name: 'Editable Markdown', exact: true }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText(/Markdown and PDF only/)).toBeTruthy()
    expect(downloadMock).not.toHaveBeenCalled()
  })

  it('downloads Markdown as a labelled snapshot without archiving an unverified transcript', async () => {
    await openPopup()
    expect(screen.getByText(/Complete history could not be verified. This action saves only/)).toBeTruthy()
    expect(downloadMock).not.toHaveBeenCalled()
    exportMarkdown()
    await screen.findByText(/page snapshot was saved instead: snapshots\/synthetic-page-snapshot.md/)
    expect(downloadMock).toHaveBeenCalledWith(snapshot, 'markdown', expect.objectContaining({ locale: 'en' }), { signal: expect.any(AbortSignal) })
    expect(tabSendMessage).toHaveBeenCalledWith(TAB_ID, { type: 'CAPTURE_PAGE_SNAPSHOT', data: { requestId: expect.any(String) } })
    expect(previewMock).not.toHaveBeenCalled()
    expect(tabsCreate).not.toHaveBeenCalled()
    assertNotArchived()
  })

  it.each([
    ['navigation', { url: 'https://gemini.google.com/app/another-synthetic-chat' }],
    ['same-URL reload', { status: 'loading' as const }],
  ])('drops a capture after source %s before the detection debounce', async (_name, change) => {
    const capture = deferred<ReturnType<typeof captureResponse>>()
    let requestId = ''
    tabSendMessage.mockImplementation(async (_id, message) => {
      if (message.type === 'PARSE_CONVERSATION') return { data: conversation }
      requestId = message.data.requestId
      return capture.promise
    })
    await openPopup()
    exportMarkdown()
    await waitFor(() => expect(requestId).not.toBe(''))
    await act(async () => {
      for (const listener of updatedListeners) listener(TAB_ID, change)
      capture.resolve(captureResponse(requestId))
    })
    expect(downloadMock).not.toHaveBeenCalled()
    expect(previewMock).not.toHaveBeenCalled()
    assertNoSavedSuccess()
    assertNotArchived()
  })

  it('does not invalidate capture for an unrelated tab update', async () => {
    const capture = deferred<ReturnType<typeof captureResponse>>()
    let requestId = ''
    tabSendMessage.mockImplementation(async (_id, message) => {
      if (message.type === 'PARSE_CONVERSATION') return { data: conversation }
      requestId = message.data.requestId
      return capture.promise
    })
    await openPopup()
    exportMarkdown()
    await waitFor(() => expect(requestId).not.toBe(''))
    await act(async () => {
      for (const listener of updatedListeners) listener(99, { status: 'loading' })
      capture.resolve(captureResponse(requestId))
    })
    await screen.findByText(/page snapshot was saved instead/)
    expect(downloadMock).toHaveBeenCalledTimes(1)
  })

  it('opens PDF in a stable preview tab only after storing the snapshot, without direct download', async () => {
    const stored = deferred<void>()
    previewMock.mockReturnValue(stored.promise)
    await openPopup()
    fireEvent.click(screen.getByRole('button', { name: 'Reading PDF', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview page snapshot PDF' }))
    await waitFor(() => expect(previewMock).toHaveBeenCalledWith(snapshot, expect.objectContaining({ locale: 'en' })))
    expect(tabsCreate).not.toHaveBeenCalled()
    await act(async () => stored.resolve())
    await waitFor(() => expect(tabsCreate).toHaveBeenCalledWith({ url: 'chrome-extension://test/tabs/preview.html?snapshot=capture%2Ffixed%20id&format=pdf' }))
    expect(downloadMock).not.toHaveBeenCalled()
    expect(screen.queryByText(/page snapshot was saved instead/)).toBeNull()
    expect(screen.queryByText('Export Successful')).toBeNull()
    assertNotArchived()
  })

  it('does not open PDF if source reloads while preview storage is pending', async () => {
    const stored = deferred<void>()
    previewMock.mockReturnValue(stored.promise)
    await openPopup()
    fireEvent.click(screen.getByRole('button', { name: 'Reading PDF', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview page snapshot PDF' }))
    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1))
    await act(async () => {
      for (const listener of updatedListeners) listener(TAB_ID, { status: 'loading' })
      stored.resolve()
    })
    expect(tabsCreate).not.toHaveBeenCalled()
    expect(downloadMock).not.toHaveBeenCalled()
    assertNoSavedSuccess()
  })

  it('stops an in-flight capture without downloading or reporting success', async () => {
    const capture = deferred<ReturnType<typeof captureResponse>>()
    let requestId = ''
    tabSendMessage.mockImplementation(async (_id, message) => {
      if (message.type === 'PARSE_CONVERSATION') return { data: conversation }
      requestId = message.data.requestId
      return capture.promise
    })
    await openPopup()
    exportMarkdown()
    await waitFor(() => expect(requestId).not.toBe(''))
    fireEvent.click(screen.getByRole('button', { name: 'Stop Export' }))
    await act(async () => capture.resolve(captureResponse(requestId)))
    expect(downloadMock).not.toHaveBeenCalled()
    assertNoSavedSuccess()
    assertNotArchived()
  })

  it('does not report success after a cancelled save dialog', async () => {
    downloadMock.mockRejectedValue(new Error(EXPORT_CANCELLED_MESSAGE))
    await openPopup()
    exportMarkdown()
    await screen.findByText('Download cancelled. Nothing was saved.')
    assertNoSavedSuccess()
    assertNotArchived()
  })

  it.each(['capture', 'download', 'preview'] as const)('reports %s failure without saved success or archive registration', async stage => {
    if (stage === 'capture') tabSendMessage.mockImplementation(async (_id, message) => message.type === 'PARSE_CONVERSATION'
      ? { data: conversation } : { error: 'Synthetic capture failure', meta: { requestId: message.data.requestId } })
    if (stage === 'download') downloadMock.mockRejectedValue(new Error('Synthetic download failure'))
    if (stage === 'preview') previewMock.mockRejectedValue(new Error('Synthetic preview failure'))
    await openPopup()
    if (stage === 'preview') {
      fireEvent.click(screen.getByRole('button', { name: 'Reading PDF', exact: true }))
      fireEvent.click(screen.getByRole('button', { name: 'Preview page snapshot PDF' }))
    } else exportMarkdown()
    await screen.findByText(new RegExp(`Synthetic ${stage} failure`))
    expect(tabsCreate).not.toHaveBeenCalled()
    assertNoSavedSuccess()
    assertNotArchived()
  })
})

describe('capture final tab-check invalidation', () => {
  it.each([TAB_URL, 'https://gemini.google.com/app/changed'])('silently drops superseded capture during final tabs.get (%s)', async finalUrl => {
    const finalTab = deferred<{ url: string }>()
    let current = true
    tabsGet.mockResolvedValueOnce({ url: TAB_URL }).mockReturnValueOnce(finalTab.promise)
    tabSendMessage.mockResolvedValue(captureResponse('r1'))
    const pending = requestPageSnapshotFromTab(TAB_ID, 'r1', () => current)
    await waitFor(() => expect(tabsGet).toHaveBeenCalledTimes(2))
    current = false
    finalTab.resolve({ url: finalUrl })
    await expect(pending).resolves.toBeNull()
  })
})
