// @vitest-environment jsdom
/**
 * Preview page export-option consistency, asserted by rendering the real
 * Preview page with mocked `chrome.*` and download APIs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { buildExportOptions } from '../src/core/export-options'
import { conversationToMarkdown } from '../src/core/export-markdown'
import { t } from '../src/core/i18n'
import type { Conversation, ExtensionSettings } from '../src/core/types'

const download = vi.hoisted(() => vi.fn())
vi.mock('../src/platform/export-download', () => ({ exportConversationFile: (...args: unknown[]) => download(...args) }))
vi.mock('../src/hooks/use-full-page-scroll', () => ({ useFullPageScroll: () => {} }))
vi.mock('../src/hooks/use-theme-sync', () => ({ useThemeSync: () => {} }))

import Preview from '../src/tabs/preview'

const TIMESTAMP = 1_700_000_000_000
const baseConversation = {
  id: 'test',
  title: 'Synthetic',
  platform: 'chatgpt',
  url: 'https://chatgpt.com/c/test',
  source: 'api',
  sourceCompleteness: 'verified',
  messages: [
    { id: 'u', role: 'user', content: 'Question', timestamp: TIMESTAMP },
    { id: 'a', role: 'assistant', content: 'Answer', timestamp: TIMESTAMP },
  ],
} as unknown as Conversation

function mountPreview(settings: Partial<ExtensionSettings>, conversation: Conversation = baseConversation) {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      storage: { local: { get: vi.fn().mockResolvedValue({ settings, 'conversation-test': conversation }) } },
      runtime: { sendMessage: vi.fn(), getURL: (path: string) => path },
    },
  })
  history.replaceState(null, '', '?id=test')
  return render(createElement(Preview))
}

const clipboard = () => vi.mocked(navigator.clipboard.writeText)

beforeEach(() => {
  vi.clearAllMocks()
  download.mockResolvedValue('saved.md')
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
})

afterEach(() => {
  cleanup()
  history.replaceState(null, '', '/')
})

describe('Preview export-option consistency', () => {
  it('passes the popup-equivalent display and timestamp options to Markdown generation', async () => {
    const settings = { assistantDisplayName: 'Export Bot', showMessageTimestamps: false }
    const options = buildExportOptions('markdown', settings)
    const markdown = conversationToMarkdown({ id: 'test', title: 'Synthetic', platform: 'chatgpt', url: 'https://chatgpt.com/c/test', messages: [{ id: 'a', role: 'assistant', content: 'Answer', timestamp: TIMESTAMP }] }, options)
    expect(markdown).toContain('### 🤖 Export Bot')
    expect(markdown).not.toContain('*2023-11-14T22:13:20.000Z*')

    // The preview must hand the same options to the Markdown generator as the popup.
    mountPreview(settings)
    fireEvent.click(await screen.findByRole('button', { name: 'Copy Markdown' }))
    await waitFor(() => expect(clipboard()).toHaveBeenCalled())
    const copied = clipboard().mock.calls[0][0]
    // Normalize only the wall-clock export instant, which differs between calls.
    const normalize = (text: string) => text.replace(/\d{4}-\d\d-\d\dT[\d:.]+Z(?=\*?$|\n)/gm, (match) => (match === '2023-11-14T22:13:20.000Z' ? match : 'EXPORTED_AT'))
    expect(normalize(copied)).toBe(normalize(conversationToMarkdown(baseConversation, options)))
    expect(copied).toContain('### 🤖 Export Bot')
    expect(copied).not.toContain('*2023-11-14T22:13:20.000Z*')
  })

  it('shows timestamps in the preview only when the setting allows them', async () => {
    mountPreview({ showMessageTimestamps: false })
    await screen.findByText('Answer')
    expect(document.querySelector('time.timestamp')).toBeNull()
    cleanup()

    mountPreview({ showMessageTimestamps: true })
    await screen.findByText('Answer')
    expect(document.querySelectorAll('time.timestamp').length).toBeGreaterThan(0)
  })

  it('gates clipboard copy and download with the same exportability check', async () => {
    // An unverified source is not exportable: neither action may proceed, and
    // the copy path must not touch the clipboard before the gate.
    const unverified = { ...baseConversation, sourceCompleteness: 'unverified' } as Conversation
    mountPreview({}, unverified)
    const copy = await screen.findByRole('button', { name: 'Copy Markdown' })
    fireEvent.click(copy)
    fireEvent.click(screen.getByRole('button', { name: 'Download Markdown' }))
    // Both handlers surface a reason instead of acting.
    await waitFor(() => expect(document.body.textContent).toMatch(/verif|complete|export/i))
    expect(clipboard()).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
    cleanup()

    // The same conversation, once verified, passes both gates.
    mountPreview({})
    fireEvent.click(await screen.findByRole('button', { name: 'Copy Markdown' }))
    await waitFor(() => expect(clipboard()).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Download Markdown' }))
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1))
  })

  it('keeps system messages separate from assistant messages and formats dates by locale', async () => {
    const withSystem = {
      ...baseConversation,
      messages: [
        { id: 's', role: 'system', content: 'System note', timestamp: TIMESTAMP },
        ...(baseConversation.messages as Conversation['messages']),
      ],
    } as Conversation
    mountPreview({ locale: 'ja', showMessageTimestamps: true }, withSystem)
    await screen.findByText('Answer')

    const bubble = (text: string) => screen.getByText(text).closest('.chat-bubble') as HTMLElement
    expect(bubble('System note').classList.contains('system')).toBe(true)
    expect(bubble('System note').classList.contains('ai')).toBe(false)
    expect(bubble('Answer').classList.contains('ai')).toBe(true)
    expect(bubble('Answer').classList.contains('system')).toBe(false)
    expect(bubble('System note').querySelector('.role-label')!.textContent).toBe(t('System', 'ja'))

    // Message times are rendered as ISO-8601 instants, never as an
    // en-US-formatted local date, whatever the interface language.
    const stamps = Array.from(document.querySelectorAll('time.timestamp'))
    expect(stamps.length).toBeGreaterThan(0)
    for (const stamp of stamps) {
      expect(stamp.textContent).toBe(new Date(TIMESTAMP).toISOString())
      expect(stamp.getAttribute('datetime')).toBe(new Date(TIMESTAMP).toISOString())
    }
    expect(document.body.textContent).not.toContain(new Date(TIMESTAMP).toLocaleDateString('en-US'))
  })
})
