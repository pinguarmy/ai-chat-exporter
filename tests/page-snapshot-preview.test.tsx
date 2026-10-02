// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { buildPageSnapshot } from '../src/lib/page-snapshot'
import { EXPORT_CANCELLED_MESSAGE } from '../src/lib/export-cancel'
import Preview from '../src/tabs/preview'

const load = vi.fn()
const remove = vi.fn()
const download = vi.fn()
vi.mock('../src/lib/page-snapshot-cache', () => ({ loadPageSnapshotPreview: (...args: unknown[]) => load(...args), deletePageSnapshotPreview: (...args: unknown[]) => remove(...args) }))
vi.mock('../src/lib/snapshot-download', () => ({ downloadPageSnapshot: (...args: unknown[]) => download(...args) }))
vi.mock('../src/lib/use-full-page-scroll', () => ({ useFullPageScroll: () => {} }))
vi.mock('../src/lib/use-theme-sync', () => ({ useThemeSync: () => {} }))
const snapshot = buildPageSnapshot({ id: 'conversation-1', title: 'Fixed title', url: 'https://gemini.google.com/app', platform: 'gemini', messages: [{ id: 'm1', role: 'user', content: 'Fixed content' }] }, 'idle', 1760000000000, 'capture-1')
beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { storage: { local: { get: vi.fn().mockResolvedValue({ settings: { includeMetadata: false } }) } }, runtime: { sendMessage: vi.fn() } } })
  load.mockResolvedValue({ snapshot, settings: { includeMetadata: false } })
  remove.mockResolvedValue(undefined)
  download.mockResolvedValue('saved.md')
})
describe('snapshot preview', () => {
  it('loads only the exact capture ID, displays notice without metadata and offers two formats', async () => {
    history.replaceState(null, '', '?snapshot=capture-1')
    render(<Preview />)
    expect(await screen.findByText('Fixed title')).toBeTruthy()
    expect(load).toHaveBeenCalledWith('capture-1')
    expect(screen.getByRole('note').textContent).toContain('complete history has not been verified')
    fireEvent.click(screen.getByText('Download PDF'))
    await waitFor(() => expect(download).toHaveBeenCalledWith(snapshot, 'pdf', expect.anything(), expect.anything()))
  })
  it('does not substitute another capture or scan storage when missing', async () => {
    history.replaceState(null, '', '?snapshot=missing')
    render(<Preview />)
    expect(await screen.findByText('Page snapshot is unavailable for preview')).toBeTruthy()
    expect(load).toHaveBeenCalledWith('missing')
    expect(chrome.storage.local.get).not.toHaveBeenCalled()
  })
  it('deletes temporary snapshot without fallback conversation', async () => {
    history.replaceState(null, '', '?snapshot=capture-1')
    render(<Preview />)
    fireEvent.click(await screen.findByText('Delete temporary snapshot'))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('capture-1'))
    expect(await screen.findByText('Page snapshot is unavailable for preview')).toBeTruthy()
  })
  it('shows an output error instead of crashing when settings filter out all content', async () => {
    const imageOnly = buildPageSnapshot({ id: 'conversation-1', title: 'Image only', url: '', platform: 'gemini', messages: [{ id: 'm1', role: 'user', content: '![chart](https://example.com/chart.png)' }] }, 'idle', 1760000000000, 'capture-img')
    load.mockResolvedValue({ snapshot: imageOnly, settings: { includeMetadata: false, includeImages: false } })
    history.replaceState(null, '', '?snapshot=capture-img')
    render(<Preview />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('no output content')
    // Copy/download are disabled; the raw capture stays available for delete.
    expect(screen.getByRole('button', { name: 'Copy' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: /Download Markdown/ })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Delete temporary snapshot' })).toHaveProperty('disabled', false)
    expect(download).not.toHaveBeenCalled()
  })
  it('never shows the raw title or key in a safe-share preview', async () => {
    const leaked = buildPageSnapshot({ id: 'conversation-1', title: 'Leaked sk-abcdefghijklmnop1234 chat', url: '', platform: 'gemini', messages: [{ id: 'm1', role: 'user', content: 'token is sk-abcdefghijklmnop1234 ok' }] }, 'idle', 1760000000000, 'capture-share')
    load.mockResolvedValue({ snapshot: leaked, settings: { includeMetadata: false, safeShare: true } })
    history.replaceState(null, '', '?snapshot=capture-share')
    render(<Preview />)
    expect((await screen.findAllByText(/\[REDACTED\]/)).length).toBeGreaterThan(0)
    expect(screen.queryByText(/sk-abcdefghijklmnop1234/)).toBeNull()
    // The share notice with the redaction count comes from the prepared copy.
    expect(screen.getByRole('note').textContent).toContain('redaction')
  })
  it('reports a cancelled download without claiming success', async () => {
    download.mockImplementation((_snapshot: unknown, _format: unknown, _settings: unknown, control: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        control.signal.addEventListener('abort', () => reject(new Error(EXPORT_CANCELLED_MESSAGE)))
      }))
    history.replaceState(null, '', '?snapshot=capture-1')
    render(<Preview />)
    fireEvent.click(await screen.findByText('Download Markdown'))
    fireEvent.click(await screen.findByText('Cancel download'))
    expect(await screen.findByText('Download cancelled')).toBeTruthy()
    expect(screen.queryByText('Downloaded!')).toBeNull()
  })
  it('prompts instead of auto-downloading for ?format=pdf and focuses the PDF button', async () => {
    history.replaceState(null, '', '?snapshot=capture-1&format=pdf')
    render(<Preview />)
    expect(await screen.findByText(/Choose Download PDF below/)).toBeTruthy()
    expect(download).not.toHaveBeenCalled()
    const pdfButton = screen.getByRole('button', { name: 'Download PDF' })
    expect(document.activeElement).toBe(pdfButton)
    expect(pdfButton.className).toContain('btn-primary')
  })
  it('renders duplicate message ids without a React key warning', async () => {
    const duplicated = buildPageSnapshot({ id: 'conversation-1', title: 'Dup ids', url: '', platform: 'gemini', messages: [{ id: 'dup', role: 'user', content: 'first copy' }, { id: 'dup', role: 'assistant', content: 'second copy' }] }, 'idle', 1760000000000, 'capture-dup')
    load.mockResolvedValue({ snapshot: duplicated, settings: { includeMetadata: false } })
    const errors: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(' ')) })
    try {
      history.replaceState(null, '', '?snapshot=capture-dup')
      render(<Preview />)
      expect(await screen.findByText('second copy')).toBeTruthy()
      expect(errors.join('\n')).not.toContain('unique "key"')
    } finally {
      spy.mockRestore()
    }
  })
  it('blocks copying a normal unverified conversation through the strict gate', async () => {
    const clipboardWrite = vi.fn(async () => undefined)
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: clipboardWrite } })
    const unverified = {
      id: 'conv-1',
      title: 'Normal chat',
      url: 'https://gemini.google.com/app/xyz',
      platform: 'gemini',
      source: 'dom',
      sourceCompleteness: 'unverified',
      messages: [
        { id: 'm1', role: 'user', content: 'hi there' },
        { id: 'm2', role: 'assistant', content: 'hello' },
      ],
    }
    ;(chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ settings: { includeMetadata: false }, 'conversation-conv-1': unverified })
    history.replaceState(null, '', '?id=conv-1')
    render(<Preview />)
    fireEvent.click(await screen.findByRole('button', { name: 'Copy' }))
    expect((await screen.findAllByText(/could not be verified/)).length).toBeGreaterThan(0)
    expect(clipboardWrite).not.toHaveBeenCalled()
  })
})
