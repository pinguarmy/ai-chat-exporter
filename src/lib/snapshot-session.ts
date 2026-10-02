/**
 * Page-session context for snapshot capture and the future local-recovery
 * monitor.
 *
 * A page snapshot is only meaningful when the page kept showing the SAME
 * conversation while it was captured. This module tracks a runtime-only
 * identity for the current document and conversation session:
 *
 * - `documentId`: random id for this content-script document lifetime. It is
 *   NOT a browser/webNavigation documentId and never leaves the page except
 *   as opaque capture metadata.
 * - `sessionId`: random id for the current conversation session. It is never
 *   derived from the URL: a URL is a hint that identity may have changed, not
 *   proof of identity. Sessions without a provider id get the same treatment.
 * - `sessionEpoch`: monotonically increasing counter advanced at every
 *   conversation boundary (navigation, conversation-root replacement,
 *   new-chat reset, regeneration that removes rendered messages).
 *
 * Streaming appends only ADD message nodes and therefore never advance the
 * epoch; removals and replacements do, so an in-flight capture that straddles
 * a boundary can be rejected by comparing a before/after context.
 */
export interface SnapshotSessionContext {
  documentId: string
  sessionId: string
  sessionEpoch: number
}

/**
 * Snapshot-capture failure whose message is guaranteed non-private (a fixed
 * English string with no page content), safe to surface to the caller.
 * Unexpected errors are replaced with a generic message by the runtime.
 */
export class PageSnapshotCaptureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PageSnapshotCaptureError'
  }
}

export interface SnapshotSessionOptions {
  /** Resolve the current main conversation container, or null when absent. */
  resolveRoot: () => Element | null
  /** Selector counting rendered message containers inside the root. */
  messageSelector: string
  /** Injectable id source for tests. Defaults to crypto.randomUUID(). */
  randomId?: () => string
}

function defaultRandomId(): string {
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID()
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** True when two contexts describe the same page session at the same epoch. */
export function sameSnapshotSessionContext(
  a: SnapshotSessionContext,
  b: SnapshotSessionContext
): boolean {
  return a.documentId === b.documentId
    && a.sessionId === b.sessionId
    && a.sessionEpoch === b.sessionEpoch
}

export class PageSnapshotSession {
  private readonly resolveRoot: () => Element | null
  private readonly messageSelector: string
  private readonly randomId: () => string

  private readonly documentId: string
  private sessionId: string
  private sessionEpoch = 0

  private lastHref: string
  private observedRoot: Element | null = null
  private observedMessages: Element[] = []
  private observer: MutationObserver | null = null
  private readonly onNavigationEvent = () => this.evaluate()
  private readonly onConversationControl = (event: Event) => {
    const target = event.target instanceof Element ? event.target.closest('button, a, [role="button"]') : null
    if (!target) return
    const signal = `${target.getAttribute('aria-label') || ''} ${target.getAttribute('data-test-id') || ''} ${target.textContent || ''}`.trim()
    if (/new\s+chat|regenerate|重新生成|新建对话|新对话|新聊天|再生成|新しいチャット|새\s*채팅|neu(er|en)?\s+chat/i.test(signal)) this.advanceBoundary()
  }

  constructor(options: SnapshotSessionOptions) {
    this.resolveRoot = options.resolveRoot
    this.messageSelector = options.messageSelector
    this.randomId = options.randomId ?? defaultRandomId

    this.documentId = this.randomId()
    this.sessionId = this.randomId()
    this.lastHref = typeof window !== 'undefined' ? window.location.href : ''

    // Establish the baseline without counting it as a boundary.
    this.evaluate()

    if (typeof window !== 'undefined') {
      // popstate/hashchange fire in every script world; history.pushState does
      // not, so SPA navigations are additionally caught by the mutation
      // observer and by the synchronous check inside getSnapshotContext().
      window.addEventListener('popstate', this.onNavigationEvent)
      window.addEventListener('hashchange', this.onNavigationEvent)
      document.addEventListener('click', this.onConversationControl, true)
      if (typeof MutationObserver !== 'undefined') {
        // Gemini parsers run at document_start; the root element can be absent
        // for a moment, so attach lazily instead of never observing.
        const attach = () => {
          if (this.observer || typeof document === 'undefined' || !document.documentElement) return
          this.observer = new MutationObserver(() => this.evaluate())
          this.observer.observe(document.documentElement, { childList: true, subtree: true })
        }
        attach()
        if (!this.observer) document.addEventListener('DOMContentLoaded', attach, { once: true })
      }
    }
  }

  /** Stop observing; used by tests and teardown. */
  dispose(): void {
    this.observer?.disconnect()
    this.observer = null
    if (typeof window !== 'undefined') {
      window.removeEventListener('popstate', this.onNavigationEvent)
      window.removeEventListener('hashchange', this.onNavigationEvent)
      document.removeEventListener('click', this.onConversationControl, true)
    }
  }

  /**
   * Current context. Synchronously re-checks boundaries first so a capture can
   * compare contexts taken immediately before and after the DOM read.
   */
  getSnapshotContext(): SnapshotSessionContext {
    this.evaluate()
    return {
      documentId: this.documentId,
      sessionId: this.sessionId,
      sessionEpoch: this.sessionEpoch
    }
  }

  /**
   * Advance the epoch when the observed conversation crosses an identity
   * boundary. Pure appends (streaming) only raise the message count and keep
   * the epoch stable.
   */
  private evaluate(): void {
    // Mutation callbacks can arrive after the document is gone (content-script
    // unload, test teardown); treat that as "no observable change".
    if (typeof document === 'undefined' || typeof window === 'undefined') return
    const href = window.location.href
    if (href !== this.lastHref) {
      // Any navigation may carry a different conversation. The new session
      // gets a fresh random id because the URL is not an identity.
      this.lastHref = href
      this.advanceBoundary()
      // Fall through so the root/count baseline is refreshed below.
    }

    const root = this.resolveRoot()
    if (root !== this.observedRoot) {
      // Conversation container replaced (new chat, account switch, full
      // re-render). Adopting the first root after a null baseline is initial
      // attachment, not a boundary.
      if (this.observedRoot !== null) this.advanceBoundary()
      this.observedRoot = root
      this.observedMessages = this.messageNodes(root)
      return
    }

    const nodes = this.messageNodes(root)
    // Same-count replacement is also a boundary (temporary new chat or a regenerated turn).
    if (this.observedMessages.some((node, index) => nodes[index] !== node)) {
      // Rendered messages disappeared: regeneration rewrote a turn, a new
      // chat cleared the view, or virtualization dropped nodes. All of these
      // make a straddling capture unsafe, so advance the epoch.
      this.advanceBoundary()
    }
    this.observedMessages = nodes
  }

  private advanceBoundary(): void {
    this.sessionEpoch += 1
    this.sessionId = this.randomId()
  }

  private messageNodes(root: Element | null): Element[] {
    if (!root) return []
    try {
      return Array.from(root.querySelectorAll(this.messageSelector))
    } catch {
      return []
    }
  }
}

/** Gemini wiring: main chat container and message-container selectors. */
export function createGeminiSnapshotSession(options?: {
  randomId?: () => string
}): PageSnapshotSession {
  return new PageSnapshotSession({
    randomId: options?.randomId,
    resolveRoot: () => {
      if (typeof document === 'undefined') return null
      return document.querySelector('chat-window-content') ||
        document.querySelector('chat-window') ||
        document.querySelector('main') ||
        document.querySelector('[role="main"]')
    },
    messageSelector:
      'user-query, .user-query, [class*="user-message"], model-response, .model-response, [class*="model-message"], ' +
      '[data-message-author-role="user"], [data-message-author-role="model"]'
  })
}
