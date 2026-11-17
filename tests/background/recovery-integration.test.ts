import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPageSnapshot } from '../../src/core/page-snapshot'
import {
  createStorageArea,
  must,
  type RuntimeMessageListener,
  type StorageData
} from '../helpers/chrome-mock'
let data: StorageData
let listener: RuntimeMessageListener
let onStartup: () => void
const context = { documentId: 'doc', sessionId: 'session', sessionEpoch: 0 }
const snapshot = (text: string) =>
  buildPageSnapshot({
    id: 'local',
    title: 'Synthetic',
    url: 'https://gemini.google.com/app',
    platform: 'gemini',
    messages: [{ id: 'u', role: 'user', content: text }]
  })
const sender = { id: 'extension', url: 'chrome-extension://extension/popup.html' }
const contentSender = { id: 'extension', url: 'https://gemini.google.com/app', tab: { id: 4 } }
interface RecoveryData {
  state?: string
  token?: string
  sessionKey?: string
  draftId?: string
  conversation?: { messages: Array<{ content: string }> }
}
const dataOf = <T>(response: { data?: T }): T => must(response.data, 'response data')
interface RecoveryResponse {
  data?: RecoveryData
  error?: string
}
const request = (
  type: string,
  value?: unknown,
  from: unknown = sender
): Promise<RecoveryResponse> =>
  new Promise(resolve =>
    listener({ type, data: value }, from, resolve as (response: unknown) => void)
  )
async function loadBackground() {
  const makeArea = (stored: StorageData) => createStorageArea(stored, { clone: true })
  const event = () => ({ addListener: vi.fn() })
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'extension',
      getURL: (path: string) => 'chrome-extension://extension/' + path,
      onInstalled: event(),
      onStartup: {
        addListener: (fn: typeof onStartup) => {
          onStartup = fn
        }
      },
      onMessage: {
        addListener: (next: typeof listener) => {
          listener = next
        }
      }
    },
    storage: {
      local: makeArea(data),
      session: makeArea({ recoveryBrowserSessionInitialized: true }),
      onChanged: event()
    },
    alarms: {
      get: vi.fn((_name, callback) => callback?.({ periodInMinutes: 15 })),
      create: vi.fn(),
      clear: vi.fn(),
      onAlarm: event()
    },
    downloads: { onChanged: event() },
    tabs: {
      onRemoved: event(),
      get: vi.fn(async (id: number) => ({ id, url: 'https://gemini.google.com/app' })),
      sendMessage: vi.fn(async (_id, message) =>
        message.type === 'CAPTURE_PAGE_SNAPSHOT'
          ? { data: snapshot('Initial'), meta: { ...context, requestId: message.data.requestId } }
          : { data: true }
      )
    }
  })
  await import('../../src/background')
}
beforeEach(async () => {
  vi.resetModules()
  data = {}
  await loadBackground()
})
describe('background and real recovery persistence integration', () => {
  it('keeps checkpoints across worker reload, retrieves without source tab and never registers an archive', async () => {
    const start = await request('START_RECOVERY_PROTECTION', { tabId: 4 })
    expect(dataOf(start).state).toBe('protected')
    const { sessionKey, token, draftId } = dataOf(start)
    const saved = await request(
      'WRITE_RECOVERY_CHECKPOINT',
      { sessionKey, token, context, snapshot: snapshot('Updated') },
      contentSender
    )
    expect(dataOf(saved).state).toBe('protected')
    vi.resetModules()
    await loadBackground()
    const recovered = await request('GET_RECOVERY_DRAFT', { id: draftId })
    expect(must(dataOf(recovered).conversation).messages[0].content).toBe('Updated')
    expect(dataOf(await request('GET_RECOVERY_STATUS', { tabId: 4 })).state).toBe('protected')
    expect(data['exportedIds-gemini']).toBeUndefined()
    await request('DELETE_RECOVERY_DRAFT', { id: draftId })
    expect(
      (
        await request(
          'WRITE_RECOVERY_CHECKPOINT',
          { sessionKey, token, context, snapshot: snapshot('Late') },
          contentSender
        )
      ).error
    ).toBeTruthy()
    expect((await request('LIST_RECOVERY_DRAFTS')).data).toHaveLength(0)
  })
  it('clear cancels an initial capture that has not returned yet', async () => {
    let completeCapture!: (response?: unknown) => void
    Object.assign(chrome.tabs, {
      sendMessage: vi.fn(
        async (_id: number, message: { type: string; data: { requestId: string } }) =>
          message.type === 'CAPTURE_PAGE_SNAPSHOT'
            ? new Promise(resolve => {
                completeCapture = () =>
                  resolve({
                    data: snapshot('Late initial'),
                    meta: { ...context, requestId: message.data.requestId }
                  })
              })
            : { data: true }
      )
    })
    const started = request('START_RECOVERY_PROTECTION', { tabId: 4 })
    await vi.waitFor(() => expect(completeCapture).toBeTypeOf('function'))
    await request('CLEAR_RECOVERY_DRAFTS')
    completeCapture(undefined)
    expect((await started).error).toContain('superseded')
    expect((await request('LIST_RECOVERY_DRAFTS')).data).toHaveLength(0)
  })

  it('clear supersedes start while its initial monitor stop is still pending', async () => {
    let completeStop!: (response?: unknown) => void
    vi.mocked(chrome.tabs.sendMessage).mockImplementationOnce(
      async () =>
        new Promise(resolve => {
          completeStop = resolve
        })
    )
    const started = request('START_RECOVERY_PROTECTION', { tabId: 4 })
    await vi.waitFor(() => expect(completeStop).toBeTypeOf('function'))
    await request('CLEAR_RECOVERY_DRAFTS')
    completeStop({ data: true })
    expect((await started).error).toContain('superseded')
    expect((await request('LIST_RECOVERY_DRAFTS')).data).toHaveLength(0)
  })

  it('browser startup pauses protection but retains last saved content', async () => {
    const initial = dataOf(await request('START_RECOVERY_PROTECTION', { tabId: 4 }))
    onStartup()
    const status = await request('GET_RECOVERY_STATUS', { tabId: 4 })
    expect(dataOf(status).state).toBe('paused')
    expect(dataOf(status).token).toBeUndefined()
    expect(
      must(dataOf(await request('GET_RECOVERY_DRAFT', { id: initial.draftId })).conversation)
        .messages[0].content
    ).toBe('Initial')
  })
  it('pauses and retains content at page boundaries', async () => {
    const initial = dataOf(await request('START_RECOVERY_PROTECTION', { tabId: 4 }))
    await request(
      'PAUSE_RECOVERY_PROTECTION',
      { sessionKey: initial.sessionKey, token: initial.token },
      contentSender
    )
    expect(dataOf(await request('GET_RECOVERY_STATUS', { tabId: 4 })).state).toBe('paused')
    expect(
      must(dataOf(await request('GET_RECOVERY_DRAFT', { id: initial.draftId })).conversation)
        .messages[0].content
    ).toBe('Initial')
  })
})
