/**
 * Gemini DOM Parser Content Script
 * Parses conversations from gemini.google.com using DOM reading and API-based conversation list
 *
 * Authentication Strategy:
 * - Primary: Hook-script that monkey-patches window.fetch/XHR to intercept `at` (auth token)
 *   and `f.sid` (session ID) from Gemini's batchexecute requests, then posts them via
 *   window.postMessage for the content script to store in chrome.storage.session
 *   (memory-backed; legacy chrome.storage.local copies are migrated and removed).
 * - Fallback: __WIZ_global_data, script tags, hidden inputs, meta tags.
 */
import type { Conversation, ChatMessage, ConversationListItem, PageSnapshot } from '../core/types'
import type { ProviderParser } from '../providers/provider-parser'
import { createVerificationEvidence, syncSourceCompleteness } from '../core/verification'
import type { PlasmoCSConfig } from 'plasmo'
import { cleanDocumentTitle, extractPageCreatedAt, titleFromFirstMatch } from '../providers/page-metadata'
import { collectSidebarConversationList } from '../providers/sidebar-list'
import { createGeminiSnapshotSession } from '../core/snapshot-session'
import { installRecoveryMonitor } from '../platform/recovery-monitor'
import { generateId, extractTextContent } from '../core/dom-utils'
import { mergeRenderedImageAttachments, preferMoreCompleteConversation, shouldUseApiFallback } from '../providers/parser-fallback'
import { registerParserMessageHandler, runParserMain } from '../providers/parser-runtime'
import { isProviderRateLimitError, isRateLimitedResponse, ProviderRateLimitError } from '../core/provider-rate-limit'
import {
  clearStoredGeminiCredentialsForAccount,
  getGeminiAccountSlot,
  readStoredGeminiCredentials,
  selectGeminiCredential,
  storeGeminiCredentialFromPage,
  type GeminiCredential
} from '../providers/gemini/credentials'
import {
  GEMINI_DETAIL_TURN_LIMIT,
  GEMINI_LIST_MAX_PAGES_PER_STREAM,
  GEMINI_LIST_MODES,
  GEMINI_LIST_PAGE_SIZE,
  buildGeminiBatchExecuteBody,
  buildGeminiBatchExecuteUrl,
  buildGeminiRpcRequest,
  extractGeminiListPageToken,
  extractGeminiMessagesFromDetailPayload,
  mergeGeminiConversationListItems,
  parseGeminiConversationListPayload,
  parseGeminiRpcPayload,
  type GeminiConversationListResult,
  type GeminiConversationListStreamResult
} from '../providers/gemini/batchexecute'
import { extractGeminiDomMessages, injectGeminiPlaceCardLabels } from '../providers/gemini/dom-messages'
import { injectGeminiHookScript } from '../providers/gemini/hook-script'
import { captureGeminiDomPageSnapshot } from '../providers/gemini/snapshot-dom'
import { createLogger, errorName } from '../core/logger'

const log = createLogger('Gemini Parser')

// The credential helpers moved to src/providers/gemini/credentials.ts; the
// content script keeps re-exporting them so existing importers and the
// regression tests keep one stable entry point.
export {
  normalizeGeminiSingletonCredential,
  pruneGeminiCredentialMap,
  resetGeminiCredentialMigrationForTests,
  selectGeminiCredential,
  validateGeminiCredentialPayload,
  type GeminiCredential
} from '../providers/gemini/credentials'
export type { GeminiConversationListResult } from '../providers/gemini/batchexecute'

/**
 * Gemini parser implementation
 */
export class GeminiParser implements ProviderParser {
  platform = 'gemini' as const
  private authenticationRequired = false

  /** Safe aggregate signal for the scheduled-export status surface. */
  isAuthenticationRequired(): boolean {
    return this.authenticationRequired
  }

  /**
   * Check if current page is a Gemini conversation
   */
  isConversationPage(): boolean {
    return !!(
      document.querySelector('user-query, model-response') ||
      document.querySelector('[class*="message-content"]') ||
      document.querySelector('[class*="response-container"]') ||
      document.querySelector('[class*="conversation"]') ||
      document.querySelector('.user-query, .model-response')
    )
  }

  /**
   * Get the conversation title from the page
   * Strategy:
   * 1. Parse document.title (most reliable: "Conversation Title - Gemini")
   * 2. Try conversation-title class
   * 3. Try first user message as fallback
   * 4. Last resort: "Untitled Conversation"
   */
  getConversationTitle(): string {
    // Gemini formats titles as "Conversation Title - Gemini"
    const pageTitle = cleanDocumentTitle(document.title, 'Gemini')
    if (pageTitle) return pageTitle

    // Try the in-page conversation-title element
    const titleEl = document.querySelector('[class*="conversation-title"]')
    if (titleEl) {
      const text = extractTextContent(titleEl)
      if (text && text !== 'Gemini' && text.length > 0) {
        return text
      }
    }

    return (
      titleFromFirstMatch('user-query, .user-query, [class*="user-message"], [data-message-author-role="user"]') ||
      'Untitled Conversation'
    )
  }

  /**
   * Parse the current conversation from the DOM
   */
  async parseCurrentConversation(): Promise<Conversation | null> {
    try {
      const messages = this.extractMessages()

      if (messages.length === 0) {
        return null
      }

      // Extract real conversation ID from URL (e.g., /app/abc123)
      const urlMatch = window.location.pathname.match(/\/app\/([a-zA-Z0-9_-]+)/)
      const conversationId = urlMatch?.[1] || generateId()

      return syncSourceCompleteness({
        id: conversationId,
        title: this.getConversationTitle(),
        url: window.location.href,
        messages,
        createdAt: this.extractCreatedAt(),
        platform: 'gemini',
        source: 'dom',
        sourceCompleteness: 'unverified',
        verification: createVerificationEvidence({
          provider: 'gemini',
          source: 'dom',
          transcript: {
            verified: false,
            method: 'dom-unverified',
            reasons: ['source_unverified'],
          },
        }),
      })
    } catch (error) {
      log.debug(`DOM parse failed (${errorName(error)})`)
      return null
    }
  }

  /**
   * Capture a page snapshot from the observed DOM only.
   *
   * Unlike parseCurrentConversation()/fetchConversationDetail(), this never
   * touches the provider detail/list APIs, never merges an API result, and
   * uses a strict message-container selection instead of the legacy broad
   * fallback. The result is a whitelist-built PageSnapshot with fixed
   * dom/unverified evidence. Throws PageSnapshotCaptureError (safe, non-private
   * message) when no capturable conversation content exists.
   */
  async capturePageSnapshot(): Promise<PageSnapshot> {
    return captureGeminiDomPageSnapshot()
  }

  /**
   * Extract the auth token. Priority:
   * 1. Hooked credentials from chrome.storage.local (most reliable)
   * 2. __WIZ_global_data (fallback)
   * 3. Script tags (fallback)
   * 4. Hidden inputs / meta tags (fallback)
   *
   * This is async because it reads from chrome.storage.local.
   */
  private async getAuthToken(): Promise<string | null> {
    // 1. Check hooked credentials in storage (most reliable)
    try {
      const { credentials, credentialsMap } = await this.getStoredCredentials()

      // Try to find credentials for current account slot
      const accountSlot = getGeminiAccountSlot()
      const slotCreds = selectGeminiCredential(credentialsMap, accountSlot, 'at')

      if (slotCreds?.at) {
        this.authenticationRequired = false
        return slotCreds.at
      }
      const hasOtherAccountCreds = Object.values(credentialsMap).some(c => c.accountSlot && c.accountSlot !== accountSlot)
      // The legacy singleton is only a fallback for pages where no mapped
      // account credential exists. A matching account map always wins, and a
      // different slot must not block this page's own DOM token fallbacks.
      if (!hasOtherAccountCreds && credentials?.at) {
        this.authenticationRequired = false
        return credentials.at
      }
    } catch {
      // chrome.storage not available in tests; fall through to the next credential source
    }

    // 2. Fallback: try __WIZ_global_data
    try {
      const wizData = (window as any).__WIZ_global_data || (window as any).WIZ_global_data
      if (wizData && wizData.SNlM0e) {
        this.authenticationRequired = false
        return wizData.SNlM0e
      }
    } catch {
      // Not available
    }

    // 3. Try document.cookie for SNlM0e
    try {
      const cookies = document.cookie.split(';')
      for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=')
        if (name === 'SNlM0e' && value) {
          this.authenticationRequired = false
          return value
        }
      }
    } catch {
      // Cookies not accessible
    }

    // 4. Try to find the token in page scripts
    const scripts = document.querySelectorAll('script')
    for (const script of scripts) {
      const text = script.textContent || ''
      // Look for SNlM0e pattern
      const match = text.match(/"SNlM0e"\s*:\s*"([^"]+)"/)
      if (match) {
        this.authenticationRequired = false
        return match[1]
      }
    }

    // 5. Fallback: try to find a hidden input with the token
    const input = document.querySelector('input[name="at"], input[name="SNlM0e"]') as HTMLInputElement
    if (input?.value) {
      this.authenticationRequired = false
      return input.value
    }

    // 6. Fallback: try meta tag
    const meta = document.querySelector('meta[name="at"], meta[name="SNlM0e"]')
    if (meta?.getAttribute('content')) {
      this.authenticationRequired = false
      return meta.getAttribute('content')
    }

    this.authenticationRequired = true
    return null
  }

  /**
   * Get session ID from stored hooked credentials.
   */
  private async getSessionId(): Promise<string> {
    try {
      const { credentials, credentialsMap } = await this.getStoredCredentials()
      const accountSlot = getGeminiAccountSlot()
      const slotCreds = selectGeminiCredential(credentialsMap, accountSlot, 'sid')

      if (slotCreds?.sid) return slotCreds.sid
      if (Object.values(credentialsMap).some(c => c.accountSlot && c.accountSlot !== accountSlot)) return ''
      return credentials?.sid || ''
    } catch {
      return ''
    }
  }

  /** Read bridge credentials while removing expired or malformed map entries. */
  private async getStoredCredentials(): Promise<{
    credentials?: GeminiCredential
    credentialsMap: Record<string, GeminiCredential>
  }> {
    return readStoredGeminiCredentials()
  }

  /**
   * Make a batchexecute API call with proper auth and request format.
   */
  private async makeBatchExecuteCall(
    rpcids: string,
    sourcePath: string,
    requestPayload: string,
    authToken: string,
    sessionId: string
  ): Promise<string | null> {
    const url = buildGeminiBatchExecuteUrl(rpcids, sourcePath, sessionId)
    const body = buildGeminiBatchExecuteBody(requestPayload, authToken)

    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'X-Same-Domain': '1',
      },
      body
    })

    if (isRateLimitedResponse(response)) {
      throw new ProviderRateLimitError()
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        this.authenticationRequired = true
        await clearStoredGeminiCredentialsForAccount(getGeminiAccountSlot())
      }
      log.error('API error', { status: response.status })
      return null
    }

    this.authenticationRequired = false

    return response.text()
  }

  /**
   * Fetch Gemini history from both list streams. `MaZiqc` is not a sidebar
   * scrape: the two streams mirror the live app's own requests and each stream
   * follows its cursor serially. This keeps the list complete without asking a
   * user to scroll through virtualized DOM rows.
   */
  async fetchAllConversationsWithStatus(): Promise<GeminiConversationListResult> {
    try {
      const authToken = await this.getAuthToken()
      if (!authToken) {
        log.error('Could not find auth token')
        return { conversations: this.getConversationList(), source: 'sidebar', complete: false }
      }

      const sessionId = await this.getSessionId()
      const streams = await Promise.all(
        GEMINI_LIST_MODES.map(mode => this.fetchGeminiConversationListStream(authToken, sessionId, mode))
      )
      const conversations = mergeGeminiConversationListItems(
        streams.flatMap(stream => stream.conversations)
      )

      // An empty, successfully parsed account list is a valid result. Only use
      // the sidebar when neither RPC stream returned a parseable payload.
      if (!streams.some(stream => stream.receivedPayload)) {
        return { conversations: this.getConversationList(), source: 'sidebar', complete: false }
      }

      return {
        conversations,
        source: 'api',
        complete: streams.every(stream => stream.complete)
      }
    } catch (error) {
      if (isProviderRateLimitError(error)) throw error
      log.error(`Error fetching account history (${errorName(error)})`)
      return { conversations: this.getConversationList(), source: 'sidebar', complete: false }
    }
  }

  /** Fetch one Gemini history stream, following only its own continuation tokens. */
  private async fetchGeminiConversationListStream(
    authToken: string,
    sessionId: string,
    mode: (typeof GEMINI_LIST_MODES)[number]
  ): Promise<GeminiConversationListStreamResult> {
    const conversations: ConversationListItem[] = []
    const seenPageTokens = new Set<string>()
    let pageToken: string | null = null
    let receivedPayload = false

    for (let page = 0; page < GEMINI_LIST_MAX_PAGES_PER_STREAM; page++) {
      let text: string | null = null
      for (let attempt = 0; attempt <= 2; attempt++) {
        text = await this.makeBatchExecuteCall(
          'MaZiqc',
          '/app',
          buildGeminiRpcRequest('MaZiqc', [
            GEMINI_LIST_PAGE_SIZE,
            pageToken,
            [mode, null, 1]
          ]),
          authToken,
          sessionId
        )
        if (text) break
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1_000))
      }

      if (!text) return { conversations, complete: false, receivedPayload }

      const payload = parseGeminiRpcPayload(text, 'MaZiqc')
      if (!Array.isArray(payload)) return { conversations, complete: false, receivedPayload }
      receivedPayload = true
      conversations.push(...parseGeminiConversationListPayload(payload))

      const nextPageToken = extractGeminiListPageToken(payload)
      if (!nextPageToken) return { conversations, complete: true, receivedPayload }
      if (seenPageTokens.has(nextPageToken)) {
        return { conversations, complete: false, receivedPayload }
      }

      seenPageTokens.add(nextPageToken)
      pageToken = nextPageToken
    }

    return { conversations, complete: false, receivedPayload }
  }

  /**
   * Fetch full conversation detail from the Gemini API.
   * Uses batchexecute to get the full conversation content.
   */
  async fetchConversationDetail(id: string, requestedTitle?: string): Promise<Conversation | null> {
    try {
      const normalizedId = id.replace(/^c_/, '')
      if (!normalizedId) return null
      const authToken = await this.getAuthToken()
      if (!authToken) {
        log.error('Could not find auth token for detail fetch')
        return null
      }

      const sessionId = await this.getSessionId()

      // Gemini's current conversation-detail RPC. The response contains a
      // reverse-chronological array of turns; each turn has a stable user-text
      // and assistant-Markdown field. Do not recursively collect arbitrary
      // strings from the response: it also contains citations, source pages,
      // internal reasoning and unrelated navigation data.
      const wireId = `c_${normalizedId}`
      // Fetch one complete conversation in one provider request. The list
      // stream never opens individual conversations; this detail call is only
      // made after the user has selected a conversation to export.
      const requestPayload = buildGeminiRpcRequest('hNvQHb', [
        wireId,
        GEMINI_DETAIL_TURN_LIMIT,
        null,
        1,
        [1],
        [4],
        null,
        1
      ])

      const text = await this.makeBatchExecuteCall(
        'hNvQHb',
        `/app/${normalizedId}`,
        requestPayload,
        authToken,
        sessionId
      )

      if (!text) {
        log.error('Failed to fetch conversation')
        return null
      }

      const payload = parseGeminiRpcPayload(text, 'hNvQHb')
      const messages = extractGeminiMessagesFromDetailPayload(payload)
      if (messages.length === 0) return null

      // Try to extract title from the response
      let title = requestedTitle?.trim() || 'Untitled Conversation'
      const currentUrlId = window.location.pathname.match(/\/app\/([a-zA-Z0-9_-]+)/)?.[1]
      const pageTitle = currentUrlId === normalizedId ? document.title : ''
      if (!requestedTitle && pageTitle) {
        title = cleanDocumentTitle(pageTitle, 'Gemini') || title
      }

      return syncSourceCompleteness({
        id: normalizedId,
        title,
        url: `https://gemini.google.com/app/${normalizedId}`,
        messages,
        createdAt: messages[0]?.timestamp,
        platform: 'gemini',
        source: 'api',
        sourceCompleteness: 'verified',
        verification: createVerificationEvidence({
          provider: 'gemini',
          source: 'api',
          transcript: {
            verified: true,
            method: 'provider-api-complete',
            reasons: ['source_verified'],
          },
        }),
      })
    } catch (error) {
      if (isProviderRateLimitError(error)) throw error
      log.error(`Error fetching conversation detail (${errorName(error)})`)
      return null
    }
  }

  /**
   * Extract all messages from the conversation DOM
   * Uses a single pass with deduplication to avoid counting messages twice
   */
  private extractMessages(): ChatMessage[] {
    return extractGeminiDomMessages()
  }

  /**
   * Some Gemini Maps cards expose their name/rating only as an accessible link
   * label. Keep it in the transcript before text extraction; ordinary cards
   * whose visible text already contains the label are left untouched. Public
   * (logic lives in providers/gemini/dom-messages.ts) so DOM regression tests
   * can exercise it directly.
   */
  injectPlaceCardLabels(root: Element): void {
    injectGeminiPlaceCardLabels(root)
  }

  // getElementPosition removed — querySelectorAll already returns DOM order

  /**
   * Extract conversation creation timestamp
   */
  private extractCreatedAt(): number | undefined {
    return extractPageCreatedAt()
  }

  /**
   * Get list of conversations from the sidebar (DOM-based, limited to visible items)
   */
  getConversationList(): ConversationListItem[] {
    return collectSidebarConversationList({
      selectors: [
        'nav a[href*="/app/"]',
        'aside a[href*="/app/"]',
        '[class*="sidebar"] a[href*="/app/"]',
        '[class*="history"] a[href*="/app/"]',
        'a[href^="/app/"]'
      ],
      platform: 'gemini',
      resolveId: href => href.match(/\/app\/([a-zA-Z0-9_-]+)/)?.[1],
    })
  }
}

/** Resolve an open conversation through the same DOM/API recovery path as exports. */
export async function resolveCurrentGeminiConversation(
  currentParser: Pick<GeminiParser, 'parseCurrentConversation' | 'fetchConversationDetail'>,
  conversationId: string,
  requestedTitle?: string
): Promise<Conversation | null> {
  const domConversation = await currentParser.parseCurrentConversation()
  if (!shouldUseApiFallback(domConversation)) return domConversation

  try {
    const apiConversation = await currentParser.fetchConversationDetail(conversationId, requestedTitle)
    const preferred = preferMoreCompleteConversation(domConversation, apiConversation)
    const renderedFallback = preferred === apiConversation ? domConversation : apiConversation
    return mergeRenderedImageAttachments(preferred, renderedFallback) || null
  } catch {
    return domConversation
  }
}

// Create parser instance
const parser = new GeminiParser()

// Page-session context for snapshot capture and the future recovery monitor.
// The runtime compares a before/after context to reject captures that
// straddle a navigation/new-chat/regeneration boundary.
const snapshotSession = createGeminiSnapshotSession()

/** Callable page-session context for the recovery observer (round 2). */
export function getGeminiSnapshotContext() {
  return snapshotSession.getSnapshotContext()
}

/** Observed-DOM snapshot capture entry point (no provider API access). */
export function captureGeminiPageSnapshot(): Promise<PageSnapshot> {
  return parser.capturePageSnapshot()
}

// Export for content script
export const config: PlasmoCSConfig = {
  matches: ['https://gemini.google.com/*'],
  // Capture the page's very first batchexecute request. At document_idle that
  // request is usually already over, leaving the bulk UI with no credential
  // and forcing it into the virtualized sidebar fallback.
  run_at: 'document_start'
}

// Listen for credentials from hook script (page world -> content script world)
window.addEventListener('message', async (event) => {
  if (event.source === window && event.origin === window.location.origin && event.data?.type === 'GEMINI_CREDENTIALS') {
    await storeGeminiCredentialFromPage(event.data.payload)
  }
})

// Inject hook script into the page world for credential extraction
injectGeminiHookScript()

// Register the shared popup-message handler (see src/providers/parser-runtime.ts).
// Gemini overrides the branches whose flow differs from the standard
// parse/API-merge pipeline: credential-resolved current-conversation fetches
// and the status-carrying conversation list.
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  installRecoveryMonitor({ getContext: getGeminiSnapshotContext, capture: captureGeminiPageSnapshot })
  registerParserMessageHandler({
    platform: 'gemini',
    parser,
    getSnapshotContext: () => snapshotSession.getSnapshotContext(),
    handleParseConversation: (_message, sendResponse) => {
      const conversationId = window.location.pathname.match(/\/app\/([a-zA-Z0-9_-]+)/)?.[1]
      const conversationPromise = conversationId
        ? resolveCurrentGeminiConversation(parser, conversationId)
        : parser.parseCurrentConversation()
      conversationPromise.then(conversation => {
        sendResponse({ data: conversation, ...(!conversationId && !conversation ? { meta: { noConversation: true } } : {}) })
      }).catch(error => {
        sendResponse({ error: error.message })
      })
      return true
    },
    handleFetchAllConversations: (_message, sendResponse) => {
      parser.fetchAllConversationsWithStatus().then(result => {
        sendResponse({
          data: result.conversations,
          meta: {
            source: result.source,
            complete: result.complete,
            authRequired: parser.isAuthenticationRequired(),
            // Gemini's list timestamp is activity metadata; export detail still
            // supplies the earliest message timestamp for filename creation.
            dateField: 'last_activity'
          }
        })
      }).catch(error => {
        if (isProviderRateLimitError(error)) {
          sendResponse({ error: error.message, meta: { authRequired: parser.isAuthenticationRequired() } })
          return
        }
        // If a future Gemini API change throws before the parser can return its
        // structured status, preserve the fallback but label it as incomplete.
        try {
          const fallbackList = parser.getConversationList()
          sendResponse({
            data: fallbackList,
            meta: {
              source: 'sidebar',
              complete: false,
              authRequired: parser.isAuthenticationRequired(),
            },
          })
        } catch {
          sendResponse({ error: (error as Error).message, meta: { authRequired: parser.isAuthenticationRequired() } })
        }
      })
      return true
    },
    handleFetchConversationDetail: (message, sendResponse) => {
      const requestedId = String(message.data?.id || '').replace(/^c_/, '')
      const currentId = window.location.pathname.match(/\/app\/([a-zA-Z0-9_-]+)/)?.[1]
      const detailPromise = requestedId && requestedId === currentId
        ? resolveCurrentGeminiConversation(parser, requestedId, message.data?.title)
        : parser.fetchConversationDetail(requestedId, message.data?.title)

      detailPromise.then(conversation => {
        sendResponse({ data: conversation })
      }).catch(error => {
        sendResponse({ error: error.message })
      })
      return true
    }
  })
}

// Run on page load
runParserMain(parser)
