import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BACKGROUND_REQUEST_TYPES,
  isBackgroundRequest,
  isBackgroundRequestType,
  sendBackgroundMessage,
  type BackgroundRequest,
  type BackgroundRequestOf,
  type BackgroundRequestType,
} from '../../src/platform/background-messages'
import { buildPageSnapshot } from '../../src/core/page-snapshot'
import { DEFAULT_SETTINGS, type ConversationListItem } from '../../src/core/types'
import { createStorageArea, type RuntimeMessageListener, type RuntimeResponse, type StorageData } from '../helpers/chrome-mock'

const item: ConversationListItem = { id: 'c1', title: 'Synthetic', url: 'https://chatgpt.com/c/c1', platform: 'chatgpt' }
const snapshot = buildPageSnapshot({
  id: 'provider-id', title: 'Synthetic', url: 'https://gemini.google.com/app', platform: 'gemini',
  messages: [{ id: 'u', role: 'user', content: 'Hello' }],
}, 'unknown', Date.now(), 'capture')
const context = { documentId: 'doc', sessionId: 'session', sessionEpoch: 0 }
const conversation = { id: 'c1', platform: 'chatgpt', title: 'Synthetic', url: item.url, messages: [{ id: 'u', role: 'user', content: 'Hi' }] } as BackgroundRequestOf<'STORE_PREVIEW_SNAPSHOT'>['data']

/** One valid request per message type. The mapped type makes a missing entry a compile error. */
const VALID: { [T in BackgroundRequestType]: BackgroundRequestOf<T> } = {
  START_MANUAL_EXPORT: { type: 'START_MANUAL_EXPORT', data: { items: [item], settings: DEFAULT_SETTINGS } },
  STOP_MANUAL_EXPORT: { type: 'STOP_MANUAL_EXPORT' },
  PATCH_SETTINGS: { type: 'PATCH_SETTINGS', data: { locale: 'en' } },
  STORE_PREVIEW_SNAPSHOT: { type: 'STORE_PREVIEW_SNAPSHOT', data: conversation },
  STORE_PAGE_SNAPSHOT_PREVIEW: { type: 'STORE_PAGE_SNAPSHOT_PREVIEW', data: { snapshot } },
  GET_PAGE_SNAPSHOT_PREVIEW: { type: 'GET_PAGE_SNAPSHOT_PREVIEW', data: { captureId: 'capture' } },
  DELETE_PAGE_SNAPSHOT_PREVIEW: { type: 'DELETE_PAGE_SNAPSHOT_PREVIEW', data: { captureId: 'capture' } },
  START_RECOVERY_PROTECTION: { type: 'START_RECOVERY_PROTECTION', data: { tabId: 1 } },
  STOP_RECOVERY_PROTECTION: { type: 'STOP_RECOVERY_PROTECTION', data: { tabId: 1 } },
  PAUSE_RECOVERY_PROTECTION: { type: 'PAUSE_RECOVERY_PROTECTION', data: { sessionKey: 'gemini:1:doc:session:0', token: 't', reason: 'r' } },
  GET_RECOVERY_STATUS: { type: 'GET_RECOVERY_STATUS', data: { tabId: 1 } },
  WRITE_RECOVERY_CHECKPOINT: { type: 'WRITE_RECOVERY_CHECKPOINT', data: { sessionKey: 'gemini:1:doc:session:0', token: 't', context, snapshot } },
  LIST_RECOVERY_DRAFTS: { type: 'LIST_RECOVERY_DRAFTS' },
  GET_RECOVERY_DRAFT: { type: 'GET_RECOVERY_DRAFT', data: { id: 'd' } },
  DELETE_RECOVERY_DRAFT: { type: 'DELETE_RECOVERY_DRAFT', data: { id: 'd' } },
  CLEAR_RECOVERY_DRAFTS: { type: 'CLEAR_RECOVERY_DRAFTS' },
  STOP_RECOVERY_DRAFT: { type: 'STOP_RECOVERY_DRAFT', data: { id: 'd' } },
  EXPORT_REQUEST: { type: 'EXPORT_REQUEST', data: { conversation, format: 'markdown', filename: 'a.md' } },
  FETCH_CONVERSATION_DETAIL_IN_BACKGROUND_TAB: { type: 'FETCH_CONVERSATION_DETAIL_IN_BACKGROUND_TAB', data: { item, requestId: 'r' } },
  CANCEL_BACKGROUND_CONVERSATION_FETCH: { type: 'CANCEL_BACKGROUND_CONVERSATION_FETCH', data: { requestId: 'r' } },
  SCHEDULED_EXPORT_RUN: { type: 'SCHEDULED_EXPORT_RUN' },
  SCHEDULED_EXPORT_CLEAR_HISTORY: { type: 'SCHEDULED_EXPORT_CLEAR_HISTORY' },
  SCHEDULED_EXPORT_STOP: { type: 'SCHEDULED_EXPORT_STOP' },
  GET_EXPORTED_CONVERSATION_IDS: { type: 'GET_EXPORTED_CONVERSATION_IDS', data: 'chatgpt' },
}

describe('isBackgroundRequest', () => {
  it('lists exactly the 24 message types the worker handles', () => {
    expect([...BACKGROUND_REQUEST_TYPES].sort()).toEqual(Object.keys(VALID).sort())
    expect(BACKGROUND_REQUEST_TYPES).toHaveLength(24)
  })

  it.each(Object.entries(VALID))('accepts a valid %s request', (_type, request) => {
    expect(isBackgroundRequest(request)).toBe(true)
    // The same request survives a structured-clone round trip, like a real runtime message.
    expect(isBackgroundRequest(JSON.parse(JSON.stringify(request)))).toBe(true)
  })

  it.each([
    ['null', null], ['undefined', undefined], ['a string', 'START_MANUAL_EXPORT'], ['a number', 5],
    ['an array', [{ type: 'STOP_MANUAL_EXPORT' }]], ['an empty object', {}],
    ['a missing type', { data: {} }], ['a numeric type', { type: 1 }], ['a null type', { type: null }],
    ['an object type', { type: { toString: () => 'STOP_MANUAL_EXPORT' } }],
    ['an unknown type', { type: 'NOT_A_MESSAGE' }], ['a lowercase type', { type: 'stop_manual_export' }],
    ['a padded type', { type: ' STOP_MANUAL_EXPORT' }],
    ['an inherited property name', { type: 'toString' }], ['__proto__', { type: '__proto__' }],
    ['constructor', { type: 'constructor' }], ['hasOwnProperty', { type: 'hasOwnProperty' }],
    ['the content-script-only CAPTURE_PAGE_SNAPSHOT', { type: 'CAPTURE_PAGE_SNAPSHOT' }],
  ])('rejects %s', (_label, message) => {
    expect(isBackgroundRequest(message)).toBe(false)
  })

  it('exposes the type guard for bare type strings', () => {
    expect(isBackgroundRequestType('EXPORT_REQUEST')).toBe(true)
    expect(isBackgroundRequestType('toString')).toBe(false)
    expect(isBackgroundRequestType(undefined)).toBe(false)
  })
})

describe('sendBackgroundMessage', () => {
  it('forwards the request unchanged and returns the worker response', async () => {
    const sendMessage = vi.fn(async () => ({ data: ['a', 'b'] }))
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const request: BackgroundRequest = VALID.GET_EXPORTED_CONVERSATION_IDS

    const response = await sendBackgroundMessage(VALID.GET_EXPORTED_CONVERSATION_IDS)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledWith(request)
    expect(response).toEqual({ data: ['a', 'b'] })
    vi.unstubAllGlobals()
  })

  it('ties the response type to the request type', async () => {
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async () => ({ data: true })) } })
    const response = await sendBackgroundMessage({ type: 'STOP_MANUAL_EXPORT' })
    // Compile-time: a STOP_MANUAL_EXPORT response carries `true`, not a string list.
    const ok: true | undefined = response?.data
    // @ts-expect-error GET_EXPORTED_CONVERSATION_IDS answers with string[]
    const wrong: boolean | undefined = (await sendBackgroundMessage(VALID.GET_EXPORTED_CONVERSATION_IDS))?.data
    expect(ok).toBe(true)
    expect(wrong).toBe(true)
    vi.unstubAllGlobals()
  })
})

// ───────────────────────── router behavior ─────────────────────────

let listener: RuntimeMessageListener
let data: StorageData
let tabs: { get: ReturnType<typeof vi.fn>; sendMessage: ReturnType<typeof vi.fn> }
const page = { id: 'ext', url: 'chrome-extension://ext/popup.html' }
const contentScript = { id: 'ext', url: 'https://gemini.google.com/app', tab: { id: 4 } }
const foreign = { id: 'someone-else', url: 'chrome-extension://someone-else/page.html' }

function send(message: unknown, sender: unknown = page): Promise<RuntimeResponse> {
  return new Promise(resolve => { listener(message, sender, resolve as (response: unknown) => void) })
}

beforeEach(async () => {
  vi.resetModules()
  vi.unstubAllGlobals()
  data = {}
  const area = createStorageArea(data, { clone: true })
  const event = () => ({ addListener: vi.fn(), removeListener: vi.fn() })
  tabs = { get: vi.fn(async (id: number) => ({ id, url: 'https://gemini.google.com/app' })), sendMessage: vi.fn(async () => ({ data: true })) }
  vi.stubGlobal('chrome', {
    runtime: { id: 'ext', getURL: (path: string) => `chrome-extension://ext/${path}`, onInstalled: event(), onStartup: event(), onMessage: { addListener: (next: typeof listener) => { listener = next } } },
    storage: { local: area, session: { ...area, get: vi.fn(async () => ({ recoveryBrowserSessionInitialized: true })) }, onChanged: event() },
    alarms: { get: vi.fn((_name: string, cb: (alarm?: unknown) => void) => cb({ periodInMinutes: 15 })), create: vi.fn(), clear: vi.fn(), onAlarm: event() },
    downloads: { onChanged: event() },
    tabs: { ...tabs, onRemoved: event(), onUpdated: event(), create: vi.fn(), remove: vi.fn() },
  })
  await import('../../src/background')
})

describe('background router', () => {
  it('registers a listener that keeps the response channel open', () => {
    expect(listener({ type: 'SCHEDULED_EXPORT_STOP' }, page, () => undefined)).toBe(true)
  })

  it('has a handler for every contract type and no others', async () => {
    const { HANDLERS } = await import('../../src/background/router')
    expect(Object.keys(HANDLERS).sort()).toEqual([...BACKGROUND_REQUEST_TYPES].sort())
    for (const handler of Object.values(HANDLERS)) expect(handler).toBeTypeOf('function')
  })

  it('refuses a dispatch table with a missing handler at compile time', async () => {
    const { HANDLERS } = await import('../../src/background/router')
    type Table = typeof HANDLERS
    const incomplete = Object.fromEntries(Object.entries(HANDLERS).filter(([type]) => type !== 'SCHEDULED_EXPORT_STOP'))
    // @ts-expect-error a table without every message type must not satisfy BackgroundHandlerTable
    const rejected: Table = incomplete
    expect(rejected).toBeDefined()
  })

  it('rejects foreign senders before looking at the message', async () => {
    for (const message of [VALID.STOP_MANUAL_EXPORT, { type: 'NOT_A_MESSAGE' }]) {
      expect(await send(message, foreign)).toEqual({ error: 'Unauthorized message sender' })
    }
    expect(await send(VALID.LIST_RECOVERY_DRAFTS, { url: page.url })).toEqual({ error: 'Unauthorized message sender' })
  })

  it('answers unknown message types with the legacy error', async () => {
    expect(await send({ type: 'NOT_A_MESSAGE' })).toEqual({ error: 'Unknown message type: NOT_A_MESSAGE' })
    expect(await send({ type: 'toString' })).toEqual({ error: 'Unknown message type: toString' })
    expect(await send({})).toEqual({ error: 'Unknown message type: undefined' })
  })

  it('keeps payload validation inside the handlers with their specific errors', async () => {
    const bad = { error: 'Invalid conversation list' }
    expect(await send({ type: 'START_MANUAL_EXPORT' })).toEqual(bad)
    expect(await send({ type: 'START_MANUAL_EXPORT', data: { items: 'nope' } })).toEqual(bad)
    expect(await send({ type: 'START_MANUAL_EXPORT', data: { items: [{ ...item, url: 'https://evil.example/c/1' }], settings: DEFAULT_SETTINGS } })).toEqual(bad)
    expect(await send({ type: 'START_MANUAL_EXPORT', data: { items: [{ ...item, url: 'http://chatgpt.com/c/1' }], settings: DEFAULT_SETTINGS } })).toEqual(bad)

    expect(await send({ type: 'STORE_PAGE_SNAPSHOT_PREVIEW', data: { snapshot: { nope: true } } })).toEqual({ error: 'Invalid page snapshot' })
    expect(await send({ type: 'STORE_PAGE_SNAPSHOT_PREVIEW' })).toEqual({ error: 'Invalid page snapshot' })
    expect(await send({ type: 'GET_EXPORTED_CONVERSATION_IDS', data: 'bogus' })).toEqual({ error: 'Unsupported platform' })
    expect(await send({ type: 'GET_EXPORTED_CONVERSATION_IDS' })).toEqual({ error: 'Unsupported platform' })
    expect(await send({ type: 'EXPORT_REQUEST', data: {} })).toEqual({ error: 'No conversation data provided' })
    expect(await send({ type: 'EXPORT_REQUEST' })).toEqual({ error: 'No conversation data provided' })
    expect(await send({ type: 'CANCEL_BACKGROUND_CONVERSATION_FETCH' })).toEqual({ data: false })
    expect(await send({ type: 'CANCEL_BACKGROUND_CONVERSATION_FETCH', data: { requestId: 'unknown' } })).toEqual({ data: false })
    expect(await send({ type: 'PATCH_SETTINGS', data: 'nope' })).toEqual({ error: 'Invalid settings patch' })
    expect(await send({ type: 'PATCH_SETTINGS', data: { notASetting: 1 } })).toEqual({ error: 'Unknown settings field' })
  })

  it('only navigates to known provider URLs for background-tab fetches', async () => {
    expect(await send({ type: 'FETCH_CONVERSATION_DETAIL_IN_BACKGROUND_TAB', data: { item: { ...item, url: 'https://evil.example/c/1' } } }))
      .toEqual({ error: 'Conversation URL is not a supported provider page' })
    expect(await send({ type: 'FETCH_CONVERSATION_DETAIL_IN_BACKGROUND_TAB', data: { item: { ...item, url: 'javascript:alert(1)' } } }))
      .toEqual({ error: 'Conversation URL is not a supported provider page' })
    expect(await send({ type: 'FETCH_CONVERSATION_DETAIL_IN_BACKGROUND_TAB', data: { item: { id: '', url: '' } } }))
      .toEqual({ error: 'Conversation URL is unavailable' })
    expect(chrome.tabs.create).not.toHaveBeenCalled()
  })

  it('restricts preview and recovery controls to extension pages', async () => {
    expect(await send(VALID.STORE_PAGE_SNAPSHOT_PREVIEW, contentScript)).toEqual({ error: 'Preview storage requires an extension page' })
    expect(await send(VALID.GET_PAGE_SNAPSHOT_PREVIEW, contentScript)).toEqual({ error: 'Preview access requires an extension page' })
    expect(await send(VALID.DELETE_PAGE_SNAPSHOT_PREVIEW, contentScript)).toEqual({ error: 'Preview access requires an extension page' })
    for (const type of ['LIST_RECOVERY_DRAFTS', 'GET_RECOVERY_DRAFT', 'DELETE_RECOVERY_DRAFT', 'CLEAR_RECOVERY_DRAFTS', 'STOP_RECOVERY_DRAFT', 'START_RECOVERY_PROTECTION', 'STOP_RECOVERY_PROTECTION', 'GET_RECOVERY_STATUS'] as const) {
      expect(await send(VALID[type], contentScript), type).toEqual({ error: 'Recovery controls require an extension page' })
    }
  })

  it('validates the recovery source tab id and checkpoint sender', async () => {
    for (const tabId of [-1, 1.5, '4', null, undefined, Number.MAX_SAFE_INTEGER + 2]) {
      expect(await send({ type: 'GET_RECOVERY_STATUS', data: { tabId } })).toEqual({ error: 'Invalid source tab' })
    }
    expect(await send({ type: 'START_RECOVERY_PROTECTION' })).toEqual({ error: 'Invalid source tab' })
    expect(await send({ type: 'STOP_RECOVERY_PROTECTION', data: { tabId: 'x' } })).toEqual({ error: 'Invalid source tab' })

    const bad = { error: 'Invalid recovery checkpoint sender' }
    expect(await send(VALID.WRITE_RECOVERY_CHECKPOINT, page)).toEqual(bad)
    expect(await send(VALID.PAUSE_RECOVERY_PROTECTION, page)).toEqual(bad)
    expect(await send(VALID.WRITE_RECOVERY_CHECKPOINT, { ...contentScript, url: 'https://chatgpt.com/' })).toEqual(bad)
    // The session key must name the sending tab.
    expect(await send(VALID.WRITE_RECOVERY_CHECKPOINT, contentScript)).toEqual(bad)
    expect(await send({ type: 'WRITE_RECOVERY_CHECKPOINT', data: { sessionKey: 'gemini:4:doc:session:0', token: 7 } }, contentScript)).toEqual(bad)
    // A correctly addressed checkpoint still needs an active protected session.
    expect(await send({ type: 'WRITE_RECOVERY_CHECKPOINT', data: { ...VALID.WRITE_RECOVERY_CHECKPOINT.data, sessionKey: 'gemini:4:doc:session:0' } }, contentScript))
      .toEqual({ error: 'Local protection is no longer active' })
  })

  it('answers snapshot and recovery failures with the non-leaky message', async () => {
    tabs.get.mockRejectedValue(new Error('private detail from a tab'))
    const failure = await send(VALID.START_RECOVERY_PROTECTION)
    expect(failure.error).toBe('Local save operation failed. Existing saved content was retained; retry or save Markdown directly.')
    expect(JSON.stringify(failure)).not.toContain('private detail')
  })

  it('passes other handler failures through as their error message', async () => {
    Object.assign(chrome.storage.local, { get: vi.fn(async () => { throw new Error('storage unavailable') }) })
    expect(await send(VALID.GET_EXPORTED_CONVERSATION_IDS)).toEqual({ error: 'Could not read export history' })
    expect(await send(VALID.PATCH_SETTINGS)).toEqual({ error: 'storage unavailable' })
  })
})
