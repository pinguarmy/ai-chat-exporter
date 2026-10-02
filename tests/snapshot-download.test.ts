import { describe, expect, it, vi } from 'vitest'
import { buildPageSnapshot } from '../src/lib/page-snapshot'
import { downloadPageSnapshot } from '../src/lib/snapshot-download'
import { exportConversationFile, downloadArchiveFile, finalizeExport } from '../src/lib/export-download'
import type { Conversation } from '../src/lib/types'

vi.mock('../src/lib/export-download', async importOriginal => {
  const original = await importOriginal<typeof import('../src/lib/export-download')>()
  return { ...original, downloadMarkdownFile: vi.fn(async () => {}) }
})

const source: Conversation = { id: 'local', platform: 'gemini', title: 'A'.repeat(300), url: 'https://gemini.google.com/app', messages: [{ id: 'm', role: 'user', content: 'Hello' }] }

describe('snapshot download isolation', () => {
  it('uses a bounded capture filename and never calls finalization', async () => {
    const { downloadMarkdownFile } = await import('../src/lib/export-download')
    const snapshot = buildPageSnapshot(source, 'idle', 1_700_000_000_000, 'abcdef12-9999')
    const filename = await downloadPageSnapshot(snapshot, 'markdown', { archiveBundle: true, filenamePattern: '{title}', includeMetadata: false })
    expect(filename).toContain('snapshot-20231114T221320Z-abcdef12-999')
    expect(filename).toMatch(/\.md$/)
    expect(filename.length).toBeLessThan(170)
    expect(downloadMarkdownFile).toHaveBeenCalledOnce()
    const [body] = vi.mocked(downloadMarkdownFile).mock.calls[0]
    expect(body).toContain('Page snapshot')
    expect(body).not.toContain('## Metadata')
  })

  it('guards legacy download, archive and registration before writing files', async () => {
    const snapshot = buildPageSnapshot(source)
    await expect(exportConversationFile(snapshot.conversation, { format: 'markdown', includeMetadata: true, includeCodeBlocks: true, includeImages: true })).rejects.toThrow('snapshot')
    await expect(downloadArchiveFile(snapshot.conversation, { format: 'markdown', includeMetadata: true, includeCodeBlocks: true, includeImages: true }, { filename: 'x.zip', saveAs: false })).rejects.toThrow('snapshots')
    await expect(finalizeExport(snapshot.conversation, 'markdown', 'x.md')).rejects.toThrow('snapshots')
  })
})
