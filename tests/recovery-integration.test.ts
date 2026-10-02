import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPageSnapshot } from '../src/lib/page-snapshot'
let data: Record<string, any>
let listener: (message: any, sender: any, response: (value: any) => void) => void
let onStartup: () => void
const context = { documentId: 'doc', sessionId: 'session', sessionEpoch: 0 }
const snapshot = (text: string) => buildPageSnapshot({ id: 'local', title: 'Synthetic', url: 'https://gemini.google.com/app', platform: 'gemini', messages: [{ id: 'u', role: 'user', content: text }] })
const sender = { id: 'extension', url: 'chrome-extension://extension/popup.html' }
const contentSender = { id: 'extension', url: 'https://gemini.google.com/app', tab: { id: 4 } }
const request = (type: string, value?: any, from: any = sender): Promise<any> => new Promise(resolve => listener({ type, data: value }, from, resolve))
async function loadBackground() {
  const makeArea = (stored: Record<string, any>) => ({ get: vi.fn(async (keys: string | string[] | null) => keys === null ? { ...stored } : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in stored).map(key => [key, structuredClone(stored[key])]))), set: vi.fn(async (items: any) => { Object.assign(stored, structuredClone(items)) }), remove: vi.fn(async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key] }) })
  const event = () => ({ addListener: vi.fn() })
  vi.stubGlobal('chrome', {
    runtime: { id: 'extension', getURL: (path: string) => 'chrome-extension://extension/' + path, onInstalled: event(), onStartup: { addListener: (fn: typeof onStartup) => { onStartup = fn } }, onMessage: { addListener: (next: typeof listener) => { listener = next } } },
    storage: { local: makeArea(data), session: makeArea({ recoveryBrowserSessionInitialized: true }), onChanged: event() },
    alarms: { get: vi.fn((_name, callback) => callback?.({ periodInMinutes: 15 })), create: vi.fn(), clear: vi.fn(), onAlarm: event() }, downloads: { onChanged: event() },
    tabs: { onRemoved: event(), get: vi.fn(async (id: number) => ({ id, url: 'https://gemini.google.com/app' })), sendMessage: vi.fn(async (_id, message) => message.type === 'CAPTURE_PAGE_SNAPSHOT' ? { data: snapshot('Initial'), meta: { ...context, requestId: message.data.requestId } } : { data: true }) },
  })
  await import('../src/background')
}
beforeEach(async () => { vi.resetModules(); data = {}; await loadBackground() })
describe('background and real recovery persistence integration', () => {
  it('keeps checkpoints across worker reload, retrieves without source tab and never registers an archive', async () => {
    const start = await request('START_RECOVERY_PROTECTION', { tabId: 4 })
    expect(start.data.state).toBe('protected')
    const { sessionKey, token, draftId } = start.data
    const saved = await request('WRITE_RECOVERY_CHECKPOINT', { sessionKey, token, context, snapshot: snapshot('Updated') }, contentSender)
    expect(saved.data.state).toBe('protected')
    vi.resetModules(); await loadBackground()
    const recovered = await request('GET_RECOVERY_DRAFT', { id: draftId })
    expect(recovered.data.conversation.messages[0].content).toBe('Updated')
    expect((await request('GET_RECOVERY_STATUS', { tabId: 4 })).data.state).toBe('protected')
    expect(data['exportedIds-gemini']).toBeUndefined()
    await request('DELETE_RECOVERY_DRAFT', { id: draftId })
    expect((await request('WRITE_RECOVERY_CHECKPOINT', { sessionKey, token, context, snapshot: snapshot('Late') }, contentSender)).error).toBeTruthy()
    expect((await request('LIST_RECOVERY_DRAFTS')).data).toHaveLength(0)
  })
  it('clear cancels an initial capture that has not returned yet', async () => {
    let completeCapture!: (response: any) => void
    chrome.tabs.sendMessage = vi.fn(async (_id, message) => message.type === 'CAPTURE_PAGE_SNAPSHOT'
      ? new Promise(resolve => { completeCapture = () => resolve({ data: snapshot('Late initial'), meta: { ...context, requestId: message.data.requestId } }) })
      : { data: true }) as any
    const started = request('START_RECOVERY_PROTECTION', { tabId: 4 })
    await vi.waitFor(() => expect(completeCapture).toBeTypeOf('function'))
    await request('CLEAR_RECOVERY_DRAFTS')
    completeCapture(undefined)
    expect((await started).error).toContain('superseded')
    expect((await request('LIST_RECOVERY_DRAFTS')).data).toHaveLength(0)
  })

  it('clear supersedes start while its initial monitor stop is still pending', async () => {
    let completeStop!: (response: any) => void
    vi.mocked(chrome.tabs.sendMessage).mockImplementationOnce(async () => new Promise(resolve => { completeStop = resolve }))
    const started = request('START_RECOVERY_PROTECTION', { tabId: 4 })
    await vi.waitFor(() => expect(completeStop).toBeTypeOf('function'))
    await request('CLEAR_RECOVERY_DRAFTS')
    completeStop({ data: true })
    expect((await started).error).toContain('superseded')
    expect((await request('LIST_RECOVERY_DRAFTS')).data).toHaveLength(0)
  })

  it('browser startup pauses protection but retains last saved content', async () => {
    const initial = (await request('START_RECOVERY_PROTECTION', { tabId: 4 })).data
    onStartup()
    const status = await request('GET_RECOVERY_STATUS', { tabId: 4 })
    expect(status.data.state).toBe('paused')
    expect(status.data.token).toBeUndefined()
    expect((await request('GET_RECOVERY_DRAFT', { id: initial.draftId })).data.conversation.messages[0].content).toBe('Initial')
  })
  it('pauses and retains content at page boundaries', async () => {
    const initial = (await request('START_RECOVERY_PROTECTION', { tabId: 4 })).data
    await request('PAUSE_RECOVERY_PROTECTION', { sessionKey: initial.sessionKey, token: initial.token }, contentSender)
    expect((await request('GET_RECOVERY_STATUS', { tabId: 4 })).data.state).toBe('paused')
    expect((await request('GET_RECOVERY_DRAFT', { id: initial.draftId })).data.conversation.messages[0].content).toBe('Initial')
  })
})
