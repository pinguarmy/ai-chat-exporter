import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'
import { conversationToHtml } from '../src/lib/export-html'
import { conversationToMarkdown } from '../src/lib/export-markdown'
import { buildArchive } from '../src/lib/export-archive'
import { exportConversationFile, finalizeExport } from '../src/lib/export-download'
import { isConversationExportable } from '../src/lib/conversation-integrity'
import { selectConversationMessages } from '../src/lib/message-selection'
import { buildPageSnapshot } from '../src/lib/page-snapshot'
import { downloadPageSnapshot } from '../src/lib/snapshot-download'
import { exportCoverage } from '../src/lib/export-coverage'
import type { Conversation, ExportOptions } from '../src/lib/types'

const source: Conversation = {
  id: 'synthetic', title: 'Selected copy', platform: 'chatgpt', url: 'https://example.invalid/chat', sourceCompleteness: 'verified',
  messages: [
    { id: 'same', role: 'user', content: 'Question not selected' },
    { id: 'same', role: 'assistant', content: 'Selected answer', references: [{ type: 'web', title: 'Reference', url: 'https://example.invalid/source', private: false }] },
    { id: 'later', role: 'user', content: 'Later not selected' },
  ],
}
const options: ExportOptions = { format: 'markdown', includeMetadata: false, includeCodeBlocks: true, includeImages: true }
let downloaded: string[]
const sendMessage = vi.fn(async () => ({ data: true }))

beforeEach(() => {
  downloaded = []
  vi.stubGlobal('Blob', NodeBlob)
  sendMessage.mockClear()
  vi.stubGlobal('chrome', { runtime: { sendMessage, getManifest: () => ({ version: 'test' }) }, downloads: {
    download: vi.fn(async () => 1), search: vi.fn(async () => [{ id: 1, state: 'complete' }]),
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() }, cancel: vi.fn(),
  } })
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob) => {
    void blob.text().then(text => downloaded.push(text))
    return 'blob:synthetic'
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('partial export contract', () => {
  it('keeps an unavoidable scope notice in Markdown and HTML with metadata off', () => {
    const partial = selectConversationMessages(source, 'selected', [1])!
    const markdown = conversationToMarkdown(partial, options)
    const html = conversationToHtml(partial, { ...options, format: 'pdf' })
    expect(markdown).toContain('Partial export: 1 of 3 messages')
    expect(html).toContain('partial-export-notice')
    expect(html).toContain('not a complete conversation archive')
    expect(markdown).not.toContain('Question not selected')
    expect(markdown).not.toContain('Later not selected')
    expect(isConversationExportable(partial)).toBe(false)
  })
  it('blocks archive construction and registration, but downloads a labelled reading copy without history', async () => {
    const partial = selectConversationMessages(source, 'last-answer', [])!
    await expect(buildArchive(partial, options, 'test')).rejects.toThrow('Selected messages')
    await expect(finalizeExport(partial, 'markdown', 'x.md')).rejects.toThrow('Selected messages')
    await expect(exportConversationFile(partial, { ...options, archiveBundle: true })).rejects.toThrow('Selected messages')
    const filename = await exportConversationFile(partial, options, undefined, { markdown: 'stale text without notice' })
    expect(filename).toBe('Selected-copy-last-answer.md')
    expect(sendMessage).not.toHaveBeenCalled()
    expect(downloaded.join('')).toContain('Selected answer')
    expect(downloaded.join('')).toContain('Partial export')
    expect(downloaded.join('')).not.toContain('stale text without notice')
  })
  it('does not trust cached Markdown when safe share is requested, while retaining history ID', async () => {
    const secret = 'sk-1234567890abcdefghijklmnop'
    await exportConversationFile({ ...source, messages: [{ ...source.messages[1], content: secret }] }, { ...options, safeShare: true }, undefined, { markdown: `stale ${secret}` })
    expect(downloaded.join('')).not.toContain(secret)
    expect(downloaded.join('')).toContain('[REDACTED]')
    expect(sendMessage.mock.calls[0][0].data.conversation.id).toBe(source.id)
  })
  it('does not send raw provider data to background history after a full export', async () => {
    await exportConversationFile({ ...source, rawProviderPayload: '{"private":"provider-only"}' }, options)
    expect(sendMessage).toHaveBeenCalledOnce()
    expect(sendMessage.mock.calls[0][0].data.conversation.rawProviderPayload).toBeUndefined()
    expect(JSON.stringify(sendMessage.mock.calls)).not.toContain('provider-only')
  })
  it('selects snapshot positions after safe-share and preserves both scope notices', async () => {
    const snapshot = buildPageSnapshot({ ...source, platform: 'gemini', messages: source.messages.map((m, i) => ({ ...m, content: `${m.content} ${i === 1 ? 'sk-1234567890abcdefghijklmnop' : ''}` })) }, 'idle', 1700000000000, 'capture-test')
    await downloadPageSnapshot(snapshot, 'markdown', { safeShare: true, includeMetadata: false }, { selection: { mode: 'selected', selectedIndexes: [1] } })
    const body = downloaded.join('')
    expect(body).toContain('Page snapshot')
    expect(body).toContain('Partial export: 1 of 3 messages')
    expect(body).toContain('Selected answer')
    expect(body).not.toContain('Question not selected')
    expect(body).not.toContain('sk-1234567890abcdefghijklmnop')
    expect(sendMessage).not.toHaveBeenCalled()
  })
  it('reports only included represented resources, not a complete provider inventory', () => {
    const rich = { ...source, artifacts: [{ type: 'code' as const, content: 'code' }], messages: [{ ...source.messages[1], attachments: [{ type: 'image' as const, url: '', name: 'Unavailable' }, { type: 'file' as const, name: 'Upload', url: '', uploaded: true }] }] }
    expect(exportCoverage(rich, { ...options, exportArtifacts: true, includeImages: false, includeUploadedFiles: false, includeCodeBlocks: false })).toMatchObject({ references: 1, attachmentLabels: 0, artifactBodies: 0, unavailableImages: 0 })
  })
})
