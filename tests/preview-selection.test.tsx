// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { buildPageSnapshot } from '../src/lib/page-snapshot'
import Preview from '../src/tabs/preview'

const download = vi.fn().mockResolvedValue('saved')
const snapshotDownload = vi.fn().mockResolvedValue('saved')
const load = vi.fn()
vi.mock('../src/lib/export-download', () => ({ exportConversationFile: (...args: unknown[]) => download(...args) }))
vi.mock('../src/lib/snapshot-download', () => ({ downloadPageSnapshot: (...args: unknown[]) => snapshotDownload(...args) }))
vi.mock('../src/lib/page-snapshot-cache', () => ({ loadPageSnapshotPreview: (...args: unknown[]) => load(...args), deletePageSnapshotPreview: vi.fn() }))
vi.mock('../src/lib/use-full-page-scroll', () => ({ useFullPageScroll: () => {} }))
vi.mock('../src/lib/use-theme-sync', () => ({ useThemeSync: () => {} }))
const messages = [
  { id: 'dup', role: 'user' as const, content: 'First question' },
  { id: 'dup', role: 'assistant' as const, content: 'The answer' },
  { id: 'last', role: 'user' as const, content: 'Final question' },
]
const conversation = { id: 'c', title: 'Test chat', url: '', platform: 'gemini' as const, source: 'api' as const, sourceCompleteness: 'verified' as const, messages }

beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { storage: { local: { get: vi.fn().mockResolvedValue({ settings: { archiveBundle: true }, 'conversation-c': conversation }) } }, runtime: { sendMessage: vi.fn() } } })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
  history.replaceState(null, '', '?id=c')
})

describe('preview message selection', () => {
  it('reports the confirmed filename and offers cancellation for normal previews', async () => {
    let rejectDownload!: (error: Error) => void
    download.mockImplementationOnce((_conversation, _options, _settings, control) => new Promise((_resolve, reject) => {
      rejectDownload = reject
      control.signal.addEventListener('abort', () => reject(new Error('Export cancelled')))
    }))
    render(<Preview />)
    fireEvent.click(await screen.findByRole('button', { name: 'Download ZIP', exact: true }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel download', exact: true }))
    await screen.findByText('Download cancelled')
    expect(rejectDownload).toBeTruthy()
    download.mockResolvedValueOnce('Test-chat (1).zip')
    fireEvent.click(screen.getByRole('button', { name: 'Download ZIP', exact: true }))
    await screen.findByText('Exported: Test-chat (1).zip')
    expect(screen.getByRole('button', { name: 'Open download folder', exact: true })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copy Markdown', exact: true }))
    await screen.findByText('Copied!')
    expect(screen.queryByText('Exported: Test-chat (1).zip')).toBeNull()
  })
  it('names the actual output format for full archives and partial Markdown', async () => {
    render(<Preview />)
    expect(await screen.findByRole('button', { name: 'Download ZIP', exact: true })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy Markdown', exact: true })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Select messages' }))
    fireEvent.click(screen.getByLabelText('Select message 2'))
    expect(screen.getByRole('button', { name: 'Download Markdown', exact: true })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Download ZIP', exact: true })).toBeNull()
  })
  it('keeps duplicate-id checkboxes independent and exports the selected message only', async () => {
    render(<Preview />)
    fireEvent.click(await screen.findByRole('button', { name: 'Select messages' }))
    expect(screen.getByRole('button', { name: 'Copy Markdown' })).toHaveProperty('disabled', true)
    expect(screen.getByText('Select at least one message to copy or download.')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Select message 2'))
    expect(screen.getByLabelText('Select message 1')).toHaveProperty('checked', false)
    expect(screen.getByText('1 of 3 selected')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copy Markdown' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    const copied = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0]
    expect(copied).toContain('The answer')
    expect(copied).not.toContain('First question')
    fireEvent.click(screen.getByRole('button', { name: 'Download Markdown' }))
    await waitFor(() => expect(download).toHaveBeenCalled())
    expect(download.mock.calls[0][0].messages).toEqual([messages[1]])
    expect(download.mock.calls[0][1].archiveBundle).toBe(false)
    expect(download.mock.calls[0][3].markdown).toContain('The answer')
    expect(download.mock.calls[0][3].markdown).not.toContain('First question')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download PDF' })).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }))
    await waitFor(() => expect(download).toHaveBeenCalledTimes(2))
    expect(download.mock.calls[1][0].messages).toEqual([messages[1]])
    expect(download.mock.calls[1][1].format).toBe('pdf')
    expect(download.mock.calls[1][1].archiveBundle).toBe(false)
  })
  it('last answer selects the last assistant, not the final user message', async () => {
    render(<Preview />)
    fireEvent.click(await screen.findByRole('button', { name: 'Last answer' }))
    expect(screen.getByText('The answer')).toBeTruthy()
    expect(screen.queryByText('Final question')).toBeNull()
    expect(screen.getByText(/Partial export:/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Rendered' }).getAttribute('aria-pressed')).toBe('true')
  })
  it('does not allow partial export to bypass unverified original source', async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue({ settings: {}, 'conversation-c': { ...conversation, sourceCompleteness: 'unverified' } })
    render(<Preview />)
    fireEvent.click(await screen.findByRole('button', { name: 'Last answer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy Markdown' }))
    fireEvent.click(screen.getByRole('button', { name: 'Download Markdown' }))
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
  })
  it('disables actions when no assistant answer exists', async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue({ settings: {}, 'conversation-c': { ...conversation, messages: [messages[0]] } })
    render(<Preview />)
    fireEvent.click(await screen.findByRole('button', { name: 'Last answer' }))
    expect(screen.getByText('No assistant answer is available to export.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy Markdown' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Download Markdown' })).toHaveProperty('disabled', true)
  })
  it('uses the snapshot flow with original capture and prepared message indexes', async () => {
    const snapshot = buildPageSnapshot(conversation, 'idle', 1760000000000, 'capture')
    load.mockResolvedValue({ snapshot, settings: { safeShare: true } })
    history.replaceState(null, '', '?snapshot=capture')
    render(<Preview />)
    fireEvent.click(await screen.findByRole('button', { name: 'Select messages' }))
    fireEvent.click(screen.getByLabelText('Select message 1'))
    fireEvent.click(screen.getByRole('button', { name: 'Copy Markdown' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    expect(vi.mocked(navigator.clipboard.writeText).mock.calls[0][0]).toContain('First question')
    fireEvent.click(screen.getByRole('button', { name: 'Download Markdown' }))
    await waitFor(() => expect(snapshotDownload).toHaveBeenCalledTimes(1))
    expect(snapshotDownload.mock.calls[0][0]).toBe(snapshot)
    expect(snapshotDownload.mock.calls[0][3].selection).toEqual({ mode: 'selected', selectedIndexes: [0] })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download PDF' })).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByRole('button', { name: 'Last answer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy Markdown' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(2))
    const lastCopy = vi.mocked(navigator.clipboard.writeText).mock.calls[1][0]
    expect(lastCopy).toContain('The answer')
    expect(lastCopy).not.toContain('First question')
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }))
    await waitFor(() => expect(snapshotDownload).toHaveBeenCalledTimes(2))
    expect(snapshotDownload.mock.calls[1][0]).toBe(snapshot)
    expect(snapshotDownload.mock.calls[1][3].selection).toEqual({ mode: 'last-answer', selectedIndexes: [0] })
    expect(screen.getByText(/complete history has not been verified/)).toBeTruthy()
  })
})
