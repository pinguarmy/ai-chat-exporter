// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import Preview from '../../../src/tabs/preview'
import { conversationToMarkdown } from '../../../src/core/export-markdown'
import { buildExportOptions } from '../../../src/core/export-options'
import { multilingualConversation, multilingualEntries } from '../../helpers/multilingual-corpus'

const download = vi.fn().mockResolvedValue('saved')
vi.mock('../../../src/platform/export-download', () => ({
  exportConversationFile: (...args: unknown[]) => download(...args)
}))
vi.mock('../../../src/platform/snapshot-download', () => ({ downloadPageSnapshot: vi.fn() }))
vi.mock('../../../src/platform/page-snapshot-cache', () => ({
  loadPageSnapshotPreview: vi.fn(),
  deletePageSnapshotPreview: vi.fn()
}))
vi.mock('../../../src/hooks/use-full-page-scroll', () => ({ useFullPageScroll: () => {} }))
vi.mock('../../../src/hooks/use-theme-sync', () => ({ useThemeSync: () => {} }))

function stubBrowser(conversation: unknown) {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({ settings: {}, 'conversation-c': conversation })
        }
      },
      runtime: { sendMessage: vi.fn() }
    }
  })
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) }
  })
  history.replaceState(null, '', '?id=c')
}

describe('preview page copies exactly what is exported, in every language', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanup()
    document.body.innerHTML = ''
    // `exported_at` is the only moving part of the Markdown; pin the clock.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-06-01T00:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it.each(multilingualEntries.map(entry => [entry.id, entry] as const))(
    '%s: copied Markdown equals the export and the Markdown panel',
    async (_id, entry) => {
      const conversation = {
        ...multilingualConversation(entry),
        source: 'api' as const,
        sourceCompleteness: 'verified' as const
      }
      stubBrowser(conversation)
      render(<Preview />)

      fireEvent.click(await screen.findByRole('button', { name: 'Markdown' }))
      const panel = await waitFor(() => {
        const element = document.querySelector('.markdown-panel')
        expect(element?.textContent).toBeTruthy()
        return element as HTMLElement
      })
      fireEvent.click(screen.getByRole('button', { name: 'Copy Markdown' }))
      await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
      const copied = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0]

      const exported = conversationToMarkdown(conversation, buildExportOptions('markdown', {}))
      expect(copied).toBe(exported)
      expect(panel.textContent).toBe(exported)
      for (const needle of entry.needles) expect(copied).toContain(needle)
      expect(copied).toContain(entry.title)
    }
  )
})
