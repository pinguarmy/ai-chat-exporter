import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'
import { resolveDownloadedFilename } from '../src/lib/download-completion'
import type { Conversation, ExportOptions } from '../src/lib/types'

vi.mock('html2canvas', () => ({
  default: vi.fn(async () => ({
    width: 800,
    height: 1000,
    toDataURL: vi.fn(() => 'data:image/jpeg;base64,mock')
  }))
}))

vi.mock('jspdf', () => ({
  jsPDF: class MockJsPdf {
    addImage = vi.fn()
    addPage = vi.fn()
    output = vi.fn(() => new Blob(['mock pdf'], { type: 'application/pdf' }))
  }
}))

describe('resolveDownloadedFilename', () => {
  it('keeps the expected subfolder and adopts the browser duplicate rename', async () => {
    const api = { search: vi.fn(async () => [{ filename: '/Users/me/Downloads/exports/foo (1).md' }]) } as unknown as typeof chrome.downloads
    await expect(resolveDownloadedFilename(7, 'exports/foo.md', api)).resolves.toBe('exports/foo (1).md')
  })

  it('handles Windows-style native paths', async () => {
    const api = { search: vi.fn(async () => [{ filename: 'C:\\Users\\me\\Downloads\\exports\\foo (2).md' }]) } as unknown as typeof chrome.downloads
    await expect(resolveDownloadedFilename(7, 'exports/foo.md', api)).resolves.toBe('exports/foo (2).md')
  })

  it('returns only the leaf when Save As moved the file outside the expected folder', async () => {
    const api = { search: vi.fn(async () => [{ filename: '/Users/me/Documents/custom/bar.md' }]) } as unknown as typeof chrome.downloads
    await expect(resolveDownloadedFilename(7, 'exports/foo.md', api)).resolves.toBe('bar.md')
  })

  it('adopts a duplicate rename without a subfolder', async () => {
    const api = { search: vi.fn(async () => [{ filename: '/Users/me/Downloads/foo (1).pdf' }]) } as unknown as typeof chrome.downloads
    await expect(resolveDownloadedFilename(7, 'foo.pdf', api)).resolves.toBe('foo (1).pdf')
  })

  it('falls back to the expected name for shims without search', async () => {
    const api = {} as unknown as typeof chrome.downloads
    await expect(resolveDownloadedFilename(7, 'exports/foo.md', api)).resolves.toBe('exports/foo.md')
  })

  it('falls back to the expected name when the item exposes no filename', async () => {
    const api = { search: vi.fn(async () => [{ state: 'complete' }]) } as unknown as typeof chrome.downloads
    await expect(resolveDownloadedFilename(7, 'exports/foo.md', api)).resolves.toBe('exports/foo.md')
  })

  it('falls back to the expected name when search rejects', async () => {
    const api = { search: vi.fn(async () => { throw new Error('unsupported') }) } as unknown as typeof chrome.downloads
    await expect(resolveDownloadedFilename(7, 'exports/foo.md', api)).resolves.toBe('exports/foo.md')
  })
})

describe('browser-confirmed filenames in export flows', () => {
  const source: Conversation = {
    id: 'synthetic', title: 'Chat title', platform: 'chatgpt', url: 'https://chatgpt.com/c/synthetic',
    messages: [{ id: 'a', role: 'assistant', content: 'Answer' }]
  }
  const markdownOptions: ExportOptions = { format: 'markdown', includeMetadata: false, includeCodeBlocks: true, includeImages: true }
  let sendMessage: ReturnType<typeof vi.fn>

  const stubChrome = (nativeFilename: string) => {
    sendMessage = vi.fn(async () => ({}))
    vi.stubGlobal('chrome', {
      runtime: { sendMessage, getManifest: () => ({ version: 'test' }) },
      downloads: {
        download: vi.fn(async () => 9),
        search: vi.fn(async () => [{ id: 9, state: 'complete', filename: nativeFilename }]),
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
        cancel: vi.fn()
      }
    })
    vi.stubGlobal('Blob', NodeBlob)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  }

  beforeEach(() => stubChrome('/Users/me/Downloads/Chat-title (1).md'))
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('markdown export returns and records the browser-confirmed duplicate filename', async () => {
    const { exportConversationFile } = await import('../src/lib/export-download')
    const filename = await exportConversationFile(source, markdownOptions)
    expect(filename).toBe('Chat-title (1).md')
    expect(sendMessage).toHaveBeenCalledOnce()
    expect(sendMessage.mock.calls[0][0].data.filename).toBe('Chat-title (1).md')
  })

  it('archive export returns and records the browser-confirmed duplicate filename', async () => {
    stubChrome('/Users/me/Downloads/Chat-title (1).zip')
    const { exportConversationFile } = await import('../src/lib/export-download')
    const filename = await exportConversationFile(source, { ...markdownOptions, archiveBundle: true })
    expect(filename).toBe('Chat-title (1).zip')
    expect(sendMessage.mock.calls[0][0].data.filename).toBe('Chat-title (1).zip')
  })

  it('PDF export returns and records the browser-confirmed duplicate filename', async () => {
    stubChrome('/Users/me/Downloads/Chat-title (1).pdf')
    const { exportConversationFile } = await import('../src/lib/export-download')
    const filename = await exportConversationFile(source, { ...markdownOptions, format: 'pdf' })
    expect(filename).toBe('Chat-title (1).pdf')
    expect(sendMessage.mock.calls[0][0].data.filename).toBe('Chat-title (1).pdf')
  })

  it('snapshot download returns the browser-confirmed leaf without leaking the native path', async () => {
    stubChrome('/Users/me/Elsewhere/custom-name.md')
    const { buildPageSnapshot } = await import('../src/lib/page-snapshot')
    const { downloadPageSnapshot } = await import('../src/lib/snapshot-download')
    const snapshot = buildPageSnapshot({ ...source, platform: 'gemini' }, 'idle', 1_700_000_000_000, 'capture-id')
    const filename = await downloadPageSnapshot(snapshot, 'markdown', { filenamePattern: '{title}' })
    expect(filename).toBe('custom-name.md')
    expect(filename).not.toContain('/Users/')
  })
})
