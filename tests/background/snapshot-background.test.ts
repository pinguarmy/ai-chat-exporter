import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPageSnapshot } from '../../src/core/page-snapshot'
import { createStorageArea, type RuntimeMessageListener, type StorageData } from '../helpers/chrome-mock'

const recovery = vi.hoisted(() => ({ startRecoveryProtection: vi.fn(), writeRecoveryCheckpoint: vi.fn(), stopRecoveryProtection: vi.fn(async () => ({ state: 'off' })), pauseRecoveryProtection: vi.fn(async () => ({ state: 'paused' })), listRecoveryDrafts: vi.fn(async () => [] as unknown[]), getRecoveryDraft: vi.fn(async () => null), deleteRecoveryDraft: vi.fn(), clearRecoveryDrafts: vi.fn(), cleanupRecoveryDrafts: vi.fn(async () => {}), getRecoveryStatus: vi.fn(), pauseAllRecoveryProtection: vi.fn(async () => {}) }))
vi.mock('../../src/platform/recovery-drafts', () => recovery)
vi.mock('../../src/platform/manual-export-job', () => ({ initializeManualJobs: vi.fn(async () => {}), startManualJob: vi.fn(), stopManualJob: vi.fn() }))
let listener: RuntimeMessageListener
let data: StorageData
let sendTab: ReturnType<typeof vi.fn>
const extensionSender = { id: 'test-extension', url: 'chrome-extension://test-extension/popup.html' }
interface SnapshotResponse { data?: { state?: string; snapshot?: { captureId: string } }; error?: string }
async function request(type: string, payload?: unknown, sender: unknown = extensionSender): Promise<SnapshotResponse> {
  return new Promise(resolve => listener({ type, data: payload }, sender, resolve as (response: unknown) => void))
}
const synthetic = () => buildPageSnapshot({ id: 'provider-id', title: 'Synthetic', url: 'https://gemini.google.com/app', platform: 'gemini', messages: [{ id: 'u', role: 'user', content: 'Hello' }] }, 'unknown', Date.now(), 'capture')
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); data = {}
  sendTab = vi.fn()
  const area = createStorageArea(data)
  const event = () => ({ addListener: vi.fn() })
  vi.stubGlobal('chrome', {
    runtime: { id: 'test-extension', getURL: (path: string) => 'chrome-extension://test-extension/' + path, onInstalled: event(), onStartup: event(), onMessage: { addListener: (next: typeof listener) => { listener = next } } },
    storage: { local: area, onChanged: event() },
    alarms: { get: vi.fn((_name, callback) => callback?.({ periodInMinutes: 15 })), create: vi.fn(), clear: vi.fn(), onAlarm: event() },
    downloads: { onChanged: event() },
    tabs: { sendMessage: sendTab, get: vi.fn(async (id: number) => ({ id, url: 'https://gemini.google.com/app' })), onRemoved: event() },
  })
  recovery.listRecoveryDrafts.mockResolvedValue([])
  await import('../../src/background')
})

describe('snapshot background isolation', () => {
  it('stores and reads exact capture previews only for extension pages', async () => {
    const snapshot = synthetic()
    expect(await request('STORE_PAGE_SNAPSHOT_PREVIEW', { snapshot })).toEqual({ data: true })
    expect((await request('GET_PAGE_SNAPSHOT_PREVIEW', { captureId: 'capture' })).data.snapshot.captureId).toBe('capture')
    expect((await request('GET_PAGE_SNAPSHOT_PREVIEW', { captureId: 'capture' }, { id: 'test-extension', url: 'https://gemini.google.com/app' })).error).toContain('extension page')
    expect(data['exportedIds-gemini']).toBeUndefined()
  })
  it('rejects snapshots passed to archive registration without changing the dedup index', async () => {
    expect((await request('EXPORT_REQUEST', { conversation: synthetic().conversation, format: 'markdown' })).error).toBeTruthy()
    expect(data['exportedIds-gemini']).toBeUndefined()
  })
  it('starts only after fresh DOM capture and content monitor acknowledgment', async () => {
    const context = { documentId: 'document', sessionId: 'session', sessionEpoch: 0 }
    sendTab.mockImplementation(async (_id, message) => message.type === 'CAPTURE_PAGE_SNAPSHOT' ? { data: synthetic(), meta: { ...context, requestId: message.data.requestId } } : { data: true })
    recovery.startRecoveryProtection.mockResolvedValue({ state: 'protected', sessionKey: 'gemini:7:document:session:0', token: 'token', lastSavedAt: 123 })
    expect((await request('START_RECOVERY_PROTECTION', { tabId: 7 })).data.state).toBe('protected')
    expect(sendTab).toHaveBeenCalledWith(7, expect.objectContaining({ type: 'ACTIVATE_RECOVERY_MONITOR' }))
    expect(recovery.startRecoveryProtection).toHaveBeenCalledWith('gemini:7:document:session:0', expect.objectContaining({ kind: 'page-snapshot' }))
  })
  it('retains initial draft but stops protection if activation fails', async () => {
    const context = { documentId: 'document', sessionId: 'session', sessionEpoch: 0 }
    sendTab.mockImplementation(async (_id, message) => message.type === 'CAPTURE_PAGE_SNAPSHOT' ? { data: synthetic(), meta: { ...context, requestId: message.data.requestId } } : { error: 'changed' })
    recovery.startRecoveryProtection.mockResolvedValue({ state: 'protected', sessionKey: 'gemini:7:document:session:0', token: 'token' })
    expect((await request('START_RECOVERY_PROTECTION', { tabId: 7 })).error).toContain('initial draft was retained')
    expect(recovery.stopRecoveryProtection).toHaveBeenCalledWith('gemini:7:document:session:0')
    expect(recovery.deleteRecoveryDraft).not.toHaveBeenCalled()
  })
  it('rejects checkpoint requests without a matching sender, context or active token', async () => {
    const payload = { sessionKey: 'gemini:7:document:session:0', token: 'token', context: { documentId: 'document', sessionId: 'session', sessionEpoch: 0 }, snapshot: synthetic() }
    expect((await request('WRITE_RECOVERY_CHECKPOINT', payload)).error).toBeTruthy()
    recovery.getRecoveryStatus.mockResolvedValue({ state: 'protected', token: 'different' })
    expect((await request('WRITE_RECOVERY_CHECKPOINT', payload, { id: 'test-extension', url: 'https://gemini.google.com/app', tab: { id: 7 } })).error).toContain('no longer active')
    expect(recovery.writeRecoveryCheckpoint).not.toHaveBeenCalled()
  })
})
