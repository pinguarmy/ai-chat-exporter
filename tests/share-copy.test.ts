// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { prepareShareCopy } from '../src/lib/share-copy'
import { selectConversationMessages } from '../src/lib/message-selection'
import { conversationToMarkdown } from '../src/lib/export-markdown'
import { conversationToHtml } from '../src/lib/export-html'
import Preview from '../src/tabs/preview'
import type { Conversation, ExportOptions } from '../src/lib/types'

const { download } = vi.hoisted(() => ({ download: vi.fn().mockResolvedValue('saved') }))
vi.mock('../src/lib/export-download', () => ({ exportConversationFile: download }))
vi.mock('../src/lib/use-full-page-scroll', () => ({ useFullPageScroll: () => {} }))
vi.mock('../src/lib/use-theme-sync', () => ({ useThemeSync: () => {} }))

const secret = 'sk-1234567890abcdefghijklmnop'
const authorization = 'Authorization: Bearer example-private-token'
const referenceUrl = 'https://example.invalid/private-source'
const marker = '[provider-citation]'
const content = `Answer ${secret}\n${authorization}\n${marker}`
const source: Conversation = {
  id: 'synthetic', title: `Title ${secret}`, url: 'https://example.invalid/chat', platform: 'chatgpt', sourceCompleteness: 'verified',
  rawProviderPayload: 'private raw', events: [{ id: 'event', kind: 'tool_result', toolName: 'test', status: 'success', content: 'private event' }],
  messages: [
    { id: 'duplicate', role: 'user', content: 'Not selected' },
    { id: 'duplicate', role: 'assistant', content, references: [{ type: 'web', title: 'Source', url: referenceUrl }], citationSpans: [{ start: content.indexOf(marker), end: content.indexOf(marker) + marker.length, referenceIndexes: [0] }] },
  ],
}
const options: ExportOptions = { format: 'markdown', safeShare: true, includeMetadata: false, includeCodeBlocks: true, includeImages: true, referenceExportMode: 'all-links' }

beforeEach(() => {
  download.mockClear()
  vi.stubGlobal('chrome', { storage: { local: { get: vi.fn().mockResolvedValue({ settings: { safeShare: true, archiveBundle: true, includeMetadata: false }, 'conversation-synthetic': source }) } }, runtime: { sendMessage: vi.fn() } })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
  history.replaceState(null, '', '?id=synthetic')
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('share copy for selected exports', () => {
  it('redacts a separate copy, strips raw and events, and removes citation links', () => {
    const before = structuredClone(source)
    const copy = prepareShareCopy(source)
    expect(source).toEqual(before)
    expect(copy).not.toBe(source)
    expect(copy.rawProviderPayload).toBeUndefined()
    expect(copy.events).toBeUndefined()
    expect(JSON.stringify(copy)).not.toContain(secret)
    expect(JSON.stringify(copy)).not.toContain('example-private-token')
    expect(JSON.stringify(copy)).not.toContain(referenceUrl)
    expect(copy.messages[1].content).toContain('Source')
    expect(copy.messages[1].citationSpans).toBeUndefined()
  })

  it('redacts partial Markdown and HTML even with metadata off and links allowed', () => {
    const partial = selectConversationMessages(source, 'selected', [1])!
    const markdown = conversationToMarkdown(partial, options)
    const html = conversationToHtml(partial, { ...options, format: 'pdf' })
    for (const output of [markdown, html]) {
      expect(output).toContain('Partial export: 1 of 2 messages')
      expect(output).toContain('Source')
      expect(output).not.toContain(secret)
      expect(output).not.toContain('example-private-token')
      expect(output).not.toContain(referenceUrl)
      expect(output).not.toContain('Not selected')
    }
  })

  it('redacts the assistant display override and respects disabled citation titles', () => {
    const safeOptions = { ...options, assistantDisplayName: secret, referenceExportMode: 'off' as const }
    for (const output of [conversationToMarkdown(source, safeOptions), conversationToHtml(source, safeOptions)]) {
      expect(output).not.toContain(secret)
      expect(output).not.toContain('Source')
      expect(output).not.toContain(marker)
    }
  })

  it('passes the original ID for full downloads and a selected redacted copy for partial downloads', async () => {
    render(createElement(Preview))
    fireEvent.click(await screen.findByRole('button', { name: 'Download ZIP' }))
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    expect(download.mock.calls[0][0]).toBe(source)
    expect(download.mock.calls[0][0].id).toBe('synthetic')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download ZIP' })).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByRole('button', { name: 'Select messages' }))
    fireEvent.click(screen.getByLabelText('Select message 2'))
    fireEvent.click(screen.getByRole('button', { name: 'Download Markdown' }))
    await waitFor(() => expect(download).toHaveBeenCalledTimes(2))
    const [partial, partialOptions] = download.mock.calls[1]
    expect(partial.id).toBe('[REDACTED]')
    expect(partial.selection).toBeTruthy()
    expect(partial.messages).toHaveLength(1)
    expect(partialOptions.archiveBundle).toBe(false)
    expect(JSON.stringify(partial)).not.toContain(secret)
  })

  it('hides disabled citations and redacts the custom assistant label in preview', async () => {
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn().mockResolvedValue({ settings: { safeShare: true, referenceExportMode: 'off', assistantDisplayName: secret }, 'conversation-synthetic': source }) } }, runtime: { sendMessage: vi.fn() } })
    render(createElement(Preview))
    await screen.findByRole('button', { name: 'Copy Markdown' })
    expect(document.body.textContent).not.toContain(secret)
    expect(document.body.textContent).not.toContain('Source')
    fireEvent.click(screen.getByRole('button', { name: 'Copy Markdown' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    expect(vi.mocked(navigator.clipboard.writeText).mock.calls[0][0]).not.toContain('[Source]')
  })

  it('renders and copies the prepared selected share copy in preview', async () => {
    render(createElement(Preview))
    fireEvent.click(await screen.findByRole('button', { name: 'Select messages' }))
    fireEvent.click(screen.getByLabelText('Select message 2'))
    expect(document.body.textContent).not.toContain(secret)
    expect(document.body.textContent).not.toContain('example-private-token')
    expect(document.body.innerHTML).not.toContain(referenceUrl)
    fireEvent.click(screen.getByRole('button', { name: 'Copy Markdown' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    const copied = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0]
    expect(copied).toContain('Partial export: 1 of 2 messages')
    expect(copied).not.toContain(secret)
    expect(copied).not.toContain('example-private-token')
    expect(copied).not.toContain(referenceUrl)
    expect(copied).not.toContain('Not selected')
  })
})
