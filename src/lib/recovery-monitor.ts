import type { PageSnapshot } from './page-snapshot'

export interface SnapshotContext { documentId: string; sessionId: string; sessionEpoch: number }
interface MonitorConfig {
  getContext(): SnapshotContext
  capture(): Promise<PageSnapshot>
}
const QUIET_MS = 2500
const MAX_WAIT_MS = 15000

/** Per-document, explicitly activated observation. No protection is enabled on load. */
export function installRecoveryMonitor(config: MonitorConfig): () => void {
  let activation: { context: SnapshotContext; sessionKey: string; token: string } | null = null
  let quietTimer: ReturnType<typeof setTimeout> | undefined
  let maxTimer: ReturnType<typeof setTimeout> | undefined
  let inFlight = false
  let pending = false
  const sameContext = (a: SnapshotContext, b: SnapshotContext) => a.documentId === b.documentId && a.sessionId === b.sessionId && a.sessionEpoch === b.sessionEpoch
  const clearTimers = () => {
    clearTimeout(quietTimer)
    clearTimeout(maxTimer)
    quietTimer = maxTimer = undefined
  }
  const stop = () => { activation = null; pending = false; clearTimers() }
  const pause = async (reason: string) => {
    const previous = activation
    stop()
    if (previous) {
      await chrome.runtime.sendMessage({ type: 'PAUSE_RECOVERY_PROTECTION', data: { sessionKey: previous.sessionKey, token: previous.token, reason } }).catch(() => undefined)
    }
  }
  const flush = async () => {
    clearTimers()
    const current = activation
    if (!current) return
    if (!sameContext(current.context, config.getContext())) { await pause('Conversation changed. Protection was paused.'); return }
    if (inFlight) { pending = true; return }
    inFlight = true
    try {
      const snapshot = await config.capture()
      if (activation !== current) return
      if (!sameContext(current.context, config.getContext())) { await pause('Conversation changed. Protection was paused.'); return }
      const response = await chrome.runtime.sendMessage({ type: 'WRITE_RECOVERY_CHECKPOINT', data: { sessionKey: current.sessionKey, token: current.token, context: current.context, snapshot } })
      if (activation !== current) return
      if (response?.error) await pause('Checkpoint save failed. Protection was paused.')
      else if (response?.data?.state !== 'protected') stop()
    } catch {
      if (activation === current) await pause('Checkpoint capture failed. Protection was paused.')
    } finally {
      inFlight = false
      if (pending && activation) { pending = false; schedule() }
    }
  }
  const schedule = () => {
    if (!activation) return
    if (!sameContext(activation.context, config.getContext())) { void pause('Conversation changed. Protection was paused.'); return }
    clearTimeout(quietTimer)
    quietTimer = setTimeout(() => { void flush() }, QUIET_MS)
    if (!maxTimer) maxTimer = setTimeout(() => { void flush() }, MAX_WAIT_MS)
  }
  const observer = new MutationObserver(schedule)
  const attachObserver = () => {
    if (document.documentElement) observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-busy', 'hidden', 'aria-hidden', 'class', 'style'] })
  }
  attachObserver()
  if (!document.documentElement) document.addEventListener('DOMContentLoaded', attachObserver, { once: true })
  const listener = (message: unknown, sender: chrome.runtime.MessageSender, respond: (result: unknown) => void) => {
    if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object') return
    const request = message as { type?: string; data?: { context?: SnapshotContext; sessionKey?: string; token?: string } }
    if (request.type === 'STOP_RECOVERY_MONITOR') { stop(); respond({ data: true }); return }
    if (request.type !== 'ACTIVATE_RECOVERY_MONITOR') return
    const data = request.data
    if (!data?.context || typeof data.sessionKey !== 'string' || typeof data.token !== 'string' || !sameContext(data.context, config.getContext())) {
      respond({ error: 'Conversation changed before protection could start.' }); return
    }
    stop()
    activation = { context: { ...data.context }, sessionKey: data.sessionKey, token: data.token }
    // Catch changes that happened between the initial capture and activation.
    schedule()
    respond({ data: true })
  }
  chrome.runtime.onMessage.addListener(listener)
  const pagehide = () => { void pause('Page closed or reloaded. Protection was paused.') }
  window.addEventListener('pagehide', pagehide)
  window.addEventListener('popstate', schedule)
  return () => {
    stop(); observer.disconnect()
    document.removeEventListener('DOMContentLoaded', attachObserver)
    chrome.runtime.onMessage.removeListener(listener)
    window.removeEventListener('pagehide', pagehide)
    window.removeEventListener('popstate', schedule)
  }
}
