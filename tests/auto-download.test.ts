/**
 * Auto-Download Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { downloadMarkdownFile } from '../src/lib/export-download'
import { buildDownloadFilename } from '../src/lib/download-path'

const mockChrome = {
  downloads: {
    download: vi.fn().mockResolvedValue(1)
  },
  runtime: {
    sendMessage: vi.fn().mockResolvedValue({})
  }
}

vi.stubGlobal('chrome', mockChrome)

const mockUrls = new Map<string, Blob>()
vi.stubGlobal('URL', {
  ...globalThis.URL,
  createObjectURL: (blob: Blob) => {
    const url = `blob:http://localhost/${Math.random().toString(36).substring(2)}`
    mockUrls.set(url, blob)
    return url
  },
  revokeObjectURL: (url: string) => {
    mockUrls.delete(url)
  }
})

describe('Auto-Download', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUrls.clear()
    mockChrome.downloads.download = vi.fn().mockResolvedValue(1)
  })

  it('passes saveAs through the real Markdown download path and revokes its URL', async () => {
    const filename = buildDownloadFilename('my-conversation', 'chatgpt', '.md', 'default', '')
    expect(filename).toBe('my-conversation.md')
    await downloadMarkdownFile('# Test', { filename, saveAs: false })
    expect(mockChrome.downloads.download).toHaveBeenCalledWith({
      url: expect.stringMatching(/^blob:/),
      filename: 'my-conversation.md',
      saveAs: false,
    })
    expect(mockUrls.size).toBe(0)
  })

  it('uses production path logic to add a PDF extension only once', () => {
    expect(buildDownloadFilename('my-conversation', 'chatgpt', '.pdf', 'default', '')).toBe('my-conversation.pdf')
    expect(buildDownloadFilename('my-conversation.pdf', 'chatgpt', '.pdf', 'default', '')).toBe('my-conversation.pdf')
  })
})
