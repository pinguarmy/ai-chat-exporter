import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installRecoveryMonitor } from '../src/lib/recovery-monitor'
import { buildPageSnapshot } from '../src/lib/page-snapshot'

let listener: (message: any, sender: any, response: (value: any) => void) => void
let context: { documentId: string; sessionId: string; sessionEpoch: number }
let sendMessage: ReturnType<typeof vi.fn>
let dispose: (() => void) | undefined
beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = '<main>Initial</main>'
  context = { documentId: 'document', sessionId: 'session', sessionEpoch: 0 }
  sendMessage = vi.fn(async () => ({ data: { state: 'protected' } }))
  vi.stubGlobal('chrome', { runtime: { id: 'extension', sendMessage, onMessage: { addListener: vi.fn(next => { listener = next }), removeListener: vi.fn() } } })
})
afterEach(() => { dispose?.(); dispose = undefined; vi.useRealTimers() })
function install() {
  const capture = vi.fn(async () => buildPageSnapshot({ id: 'session', title: 'Synthetic', url: '', platform: 'gemini', messages: [{ id: 'u', role: 'user', content: 'Text' }] }))
  dispose = installRecoveryMonitor({ getContext: () => context, capture })
  return capture
}
function activate() {
  const response = vi.fn()
  listener({ type: 'ACTIVATE_RECOVERY_MONITOR', data: { context: { ...context }, sessionKey: 'key', token: 'token' } }, { id: 'extension' }, response)
  expect(response).toHaveBeenCalledWith({ data: true })
}
async function mutate() { document.querySelector('main')!.textContent += 'x'; await Promise.resolve() }

describe('explicit recovery observation', () => {
  it('does not capture before explicit activation', async () => {
    const capture = install()
    await mutate(); await vi.advanceTimersByTimeAsync(20000)
    expect(capture).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })
  it('saves after quiet changes and caps delay during continuous streaming', async () => {
    const capture = install(); activate()
    for (let i = 0; i < 15; i++) { await mutate(); await vi.advanceTimersByTimeAsync(1000) }
    expect(capture).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'WRITE_RECOVERY_CHECKPOINT' }))
  })
  it('pauses at a session boundary without capturing the new conversation', async () => {
    const capture = install(); activate()
    context = { ...context, sessionEpoch: 1 }
    await mutate(); await vi.advanceTimersByTimeAsync(4000)
    expect(capture).not.toHaveBeenCalled()
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'PAUSE_RECOVERY_PROTECTION' }))
  })
  it('stops timers and rejects late captures when protection is stopped', async () => {
    let resolve: (value: any) => void = () => {}
    const capture = vi.fn(() => new Promise<any>(done => { resolve = done }))
    dispose = installRecoveryMonitor({ getContext: () => context, capture })
    activate(); await vi.advanceTimersByTimeAsync(2500)
    listener({ type: 'STOP_RECOVERY_MONITOR' }, { id: 'extension' }, vi.fn())
    resolve(buildPageSnapshot({ id: 'session', title: '', url: '', platform: 'gemini', messages: [{ id: 'u', role: 'user', content: 'Text' }] }))
    await Promise.resolve(); await vi.advanceTimersByTimeAsync(20000)
    expect(sendMessage).not.toHaveBeenCalled()
  })
  it('does not pause a newer activation when an old capture rejects late', async () => {
    let reject!: (error: Error) => void
    const capture = vi.fn().mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail })).mockResolvedValue(buildPageSnapshot({ id: 'session', title: '', url: '', platform: 'gemini', messages: [{ id: 'u', role: 'user', content: 'New text' }] }))
    dispose = installRecoveryMonitor({ getContext: () => context, capture })
    activate(); await vi.advanceTimersByTimeAsync(2500)
    activate()
    reject(new Error('old failed'))
    await Promise.resolve(); await vi.advanceTimersByTimeAsync(2500)
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'PAUSE_RECOVERY_PROTECTION' }))
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'WRITE_RECOVERY_CHECKPOINT' }))
  })

  it('requires the extension sender and the current context for activation', () => {
    install()
    const response = vi.fn()
    listener({ type: 'ACTIVATE_RECOVERY_MONITOR', data: { context, sessionKey: 'key', token: 'token' } }, { id: 'other' }, response)
    expect(response).not.toHaveBeenCalled()
    listener({ type: 'ACTIVATE_RECOVERY_MONITOR', data: { context: { ...context, sessionEpoch: 2 }, sessionKey: 'key', token: 'token' } }, { id: 'extension' }, response)
    expect(response).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }))
  })
})
