// @vitest-environment jsdom
/**
 * Bulk PDF performance contract, asserted through behavior instead of source text:
 * - bulk PDF exports render in the bounded `bulk` mode (single exports do not)
 * - the large PDF renderer is only loaded when a PDF export actually starts
 * - only the next conversation is prefetched while rendering stays sequential
 * - a prefetch that fails early settles instead of becoming an unhandled rejection
 * - stale active-tab parsing results that resolve out of order are ignored
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import type { Conversation, ConversationListItem, ExportOptions } from '../../../src/core/types'

const pdfModule = vi.hoisted(() => ({ evaluations: 0 }))

vi.mock('../../../src/platform/export-pdf-download', () => {
  pdfModule.evaluations++
  return {
    exportToPdf: async (_conversation: unknown, _options: unknown, filename: string) => filename
  }
})
vi.mock('../../../src/components/ExportOptionsPanel', () => ({ ExportOptionsPanel: () => null }))
vi.mock('../../../src/components/ExportDiagnostics', () => ({ ExportDiagnostics: () => null }))
vi.mock('../../../src/components/ExportCoverage', () => ({ ExportCoverage: () => null }))
vi.mock('../../../src/hooks/use-theme-sync', () => ({ useThemeSync: () => undefined }))
vi.mock('../../../src/hooks/use-locale-sync', () => ({ useLocaleSync: () => undefined }))
vi.mock('../../../src/platform/preview-snapshots', () => ({
  requestPreviewSnapshot: vi.fn(async () => undefined)
}))
vi.mock('../../../src/platform/export-download', () => ({ exportConversationFile: vi.fn() }))
vi.mock('../../../src/core/export-markdown', () => ({
  conversationToMarkdown: () => 'Synthetic test content'
}))
vi.mock('../../../src/core/conversation-integrity', () => ({
  analyzeConversationIntegrity: vi.fn(() => ({})),
  conversationIntegrityError: vi.fn(() => 'Integrity error'),
  isConversationExportable: vi.fn(() => true),
  isTranscriptVerified: vi.fn(() => true)
}))

import Popup from '../../../src/popup'
import { exportConversationFile } from '../../../src/platform/export-download'
import { resetWorkspaceSessionAreaForTests } from '../../../src/platform/workspace-session'

// Captured before any test runs: merely importing the popup (and everything it
// statically imports) must not evaluate the large PDF renderer.
const pdfEvaluationsAfterPopupImport = pdfModule.evaluations

const exportMock = vi.mocked(exportConversationFile)
const TAB_ID = 7
const TAB_URL = 'https://chatgpt.com/c/synthetic-chat'

const makeConversation = (id: string, title = `Chat ${id}`) =>
  ({
    id,
    title,
    platform: 'chatgpt',
    url: `https://chatgpt.com/c/${id}`,
    messages: [
      { id: `${id}-u`, role: 'user', content: 'Synthetic question' },
      { id: `${id}-a`, role: 'assistant', content: 'Synthetic answer' }
    ]
  }) as unknown as Conversation

const listItems = ['i1', 'i2', 'i3', 'i4'].map(id => ({
  id,
  title: `Chat ${id}`,
  platform: 'chatgpt'
})) as unknown as ConversationListItem[]

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}
const settle = (ms = 25) =>
  act(async () => {
    await new Promise(resolve => setTimeout(resolve, ms))
  })

let updatedListeners: Array<(...args: unknown[]) => void>
let detailRequests: string[]
let detailHandler: (id: string) => unknown
let parseHandler: () => Promise<unknown>

beforeEach(() => {
  vi.resetAllMocks()
  updatedListeners = []
  detailRequests = []
  detailHandler = id => ({ data: makeConversation(id) })
  parseHandler = async () => ({ data: makeConversation('current', 'Current chat') })
  const sessionMap = new Map<string, unknown>()
  vi.stubGlobal('chrome', {
    tabs: {
      query: vi.fn(async () => [{ id: TAB_ID, url: TAB_URL }]),
      get: vi.fn(async () => ({ id: TAB_ID, url: TAB_URL })),
      create: vi.fn(async () => ({})),
      sendMessage: vi.fn(async (_tab: number, message: { type: string; data?: { id: string } }) => {
        if (message.type === 'PARSE_CONVERSATION') return parseHandler()
        if (message.type === 'FETCH_ALL_CONVERSATIONS')
          return { data: listItems, meta: { source: 'api', complete: true } }
        if (message.type === 'FETCH_CONVERSATION_DETAIL') {
          detailRequests.push(message.data!.id)
          const response = await detailHandler(message.data!.id)
          if (response instanceof Error) throw response
          return response
        }
        throw new Error(`Unexpected tab message: ${message.type}`)
      }),
      onUpdated: {
        addListener: (fn: (...args: unknown[]) => void) => {
          updatedListeners.push(fn)
        },
        removeListener: (fn: (...args: unknown[]) => void) => {
          updatedListeners = updatedListeners.filter(entry => entry !== fn)
        }
      },
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() }
    },
    runtime: {
      sendMessage: vi.fn(async (message: { type: string }) =>
        message.type === 'GET_EXPORTED_CONVERSATION_IDS' ? { data: [] } : { data: true }
      ),
      getURL: (path: string) => `chrome-extension://test/${path}`
    },
    downloads: { showDefaultFolder: vi.fn() },
    storage: {
      local: {
        get: vi.fn(async () => ({
          settings: { locale: 'en', defaultFormat: 'pdf', archiveBundle: false }
        }))
      },
      session: {
        get: vi.fn(async (key?: string) =>
          key == null ? Object.fromEntries(sessionMap) : { [key]: sessionMap.get(key) }
        ),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) sessionMap.set(key, value)
        }),
        remove: vi.fn(async (key: string) => {
          sessionMap.delete(key)
        })
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() }
    }
  })
  resetWorkspaceSessionAreaForTests()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function selectBulk(ids: string[]) {
  render(createElement(Popup))
  await screen.findByText('Current chat')
  fireEvent.click(screen.getByRole('button', { name: 'Bulk Export' }))
  for (const id of ids) fireEvent.click(await screen.findByRole('checkbox', { name: `Chat ${id}` }))
  await screen.findByText(`Selected ${ids.length} · Will export ${ids.length} · Skip 0`)
  return () =>
    fireEvent.click(screen.getByRole('button', { name: `Export ${ids.length} Selected` }))
}

describe('bulk PDF performance contract', () => {
  it('uses the bounded bulk render mode for bulk PDF exports only', async () => {
    exportMock.mockResolvedValue('AI Chat Exports/chat.pdf')
    const start = await selectBulk(['i1', 'i2'])
    start()
    await waitFor(() => expect(exportMock).toHaveBeenCalledTimes(2))
    for (const call of exportMock.mock.calls) {
      const options = call[1] as ExportOptions
      expect(options.format).toBe('pdf')
      expect(options.pdfRenderMode).toBe('bulk')
    }

    // The same format from the single-conversation flow keeps the normal renderer.
    exportMock.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Current Chat' }))
    fireEvent.click(await screen.findByRole('button', { name: /Export as PDF|Export Successful/ }))
    await waitFor(() => expect(exportMock).toHaveBeenCalledTimes(1))
    expect((exportMock.mock.calls[0][1] as ExportOptions).pdfRenderMode).not.toBe('bulk')
  })

  describe('lazy PDF renderer', () => {
    it('is not evaluated by importing the popup', () => {
      expect(pdfEvaluationsAfterPopupImport).toBe(0)
    })

    it('loads the renderer on the first PDF export only, never for Markdown', async () => {
      vi.resetModules()
      pdfModule.evaluations = 0
      const real = await vi.importActual<typeof import('../../../src/platform/export-download')>(
        '../../../src/platform/export-download'
      )
      expect(pdfModule.evaluations).toBe(0)

      // A cancelled Markdown export exits before any download pipeline work;
      // what matters is that the PDF module stays unloaded.
      await real
        .exportConversationFile(
          makeConversation('m'),
          { format: 'markdown' } as ExportOptions,
          undefined,
          { signal: AbortSignal.abort() }
        )
        .catch(() => undefined)
      expect(pdfModule.evaluations).toBe(0)

      const send = vi.fn(async () => ({}))
      ;(chrome.runtime as unknown as { sendMessage: unknown }).sendMessage = send
      const pdfFile = await real.exportConversationFile(makeConversation('p'), {
        format: 'pdf'
      } as ExportOptions)
      expect(pdfFile).toMatch(/\.pdf$/)
      expect(pdfModule.evaluations).toBe(1)
      await real.exportConversationFile(makeConversation('p2'), { format: 'pdf' } as ExportOptions)
      expect(pdfModule.evaluations).toBe(1)
    })
  })

  it('prefetches only the next conversation while rendering stays sequential', async () => {
    const renders: Array<ReturnType<typeof deferred<string>>> = []
    let active = 0
    let maxActive = 0
    const exportedIds: string[] = []
    exportMock.mockImplementation(async conversation => {
      active++
      maxActive = Math.max(maxActive, active)
      exportedIds.push(conversation.id)
      const gate = deferred<string>()
      renders.push(gate)
      try {
        return await gate.promise
      } finally {
        active--
      }
    })

    const start = await selectBulk(['i1', 'i2', 'i3', 'i4'])
    start()
    await waitFor(() => expect(exportMock).toHaveBeenCalledTimes(1))
    await settle()
    // While conversation 1 renders, only conversation 2 is prefetched.
    expect(detailRequests).toEqual(['i1', 'i2'])

    for (let n = 1; n <= 3; n++) {
      renders[n - 1].resolve(`AI Chat Exports/${n}.pdf`)
      await waitFor(() => expect(exportMock).toHaveBeenCalledTimes(n + 1))
      await settle()
      expect(detailRequests).toEqual(['i1', 'i2', 'i3', 'i4'].slice(0, Math.min(n + 2, 4)))
    }
    renders[3].resolve('AI Chat Exports/4.pdf')
    await screen.findByText('Bulk export completed!')
    expect(exportedIds).toEqual(['i1', 'i2', 'i3', 'i4'])
    expect(maxActive).toBe(1)
    expect(detailRequests).toEqual(['i1', 'i2', 'i3', 'i4'])
  })

  it('settles a prefetch that fails while the previous render runs, without an unhandled rejection', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      detailHandler = id =>
        id === 'i2' ? new Error('Synthetic provider outage') : { data: makeConversation(id) }
      const first = deferred<string>()
      exportMock
        .mockImplementationOnce(async () => first.promise)
        .mockResolvedValue('AI Chat Exports/other.pdf')

      const start = await selectBulk(['i1', 'i2', 'i3'])
      start()
      await waitFor(() => expect(detailRequests).toContain('i2'))
      // i2 has failed long before anyone awaits it.
      await settle(50)
      expect(unhandled).toEqual([])

      first.resolve('AI Chat Exports/first.pdf')
      await screen.findByText('Bulk export completed with some failures.')
      expect(unhandled).toEqual([])
      // The failure is attributed to i2 only; i1 and i3 still exported.
      expect(exportMock.mock.calls.map(call => (call[0] as Conversation).id)).toEqual(['i1', 'i3'])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('ignores a stale active-tab parse that resolves after a newer one', async () => {
    const stale = deferred<unknown>()
    let calls = 0
    parseHandler = async () => {
      calls++
      return calls === 1 ? stale.promise : { data: makeConversation('new', 'Newest chat') }
    }
    render(createElement(Popup))
    await waitFor(() => expect(calls).toBe(1))

    // A tab update triggers a second detection (debounced); it resolves first.
    act(() => {
      for (const listener of [...updatedListeners])
        listener(TAB_ID, { status: 'complete' }, { id: TAB_ID })
    })
    await screen.findByText('Newest chat')
    expect(calls).toBe(2)

    // The slower first parse now resolves out of order and must not win.
    stale.resolve({ data: makeConversation('old', 'Stale chat') })
    await settle(50)
    expect(screen.queryByText('Stale chat')).toBeNull()
    expect(screen.getByText('Newest chat')).toBeTruthy()
  })
})
