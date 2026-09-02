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
import type { Conversation, ChatMessage, ConversationListItem } from '../lib/types'
import { createVerificationEvidence, syncSourceCompleteness } from '../lib/verification'
import type { PlasmoCSConfig } from 'plasmo'
import {
  generateId,
  extractTextContent,
  extractTextWithMedia,
  extractCodeBlocks,
  extractImages,
  cleanText,
  stripProviderArtifacts
} from '../lib/dom-utils'
import { mergeRenderedImageAttachments, preferMoreCompleteConversation, shouldUseApiFallback } from '../lib/parser-fallback'
import { registerParserMessageHandler, runParserMain } from '../lib/parser-runtime'
import { isProviderRateLimitError, isRateLimitedResponse, ProviderRateLimitError } from '../lib/provider-rate-limit'

export interface GeminiCredential {
  at?: string
  sid?: string
  accountSlot?: string
  lastUsed?: number
}

const GEMINI_CREDENTIAL_TTL_MS = 24 * 60 * 60 * 1000
const GEMINI_CREDENTIAL_MAX_ENTRIES = 8
const GEMINI_CREDENTIAL_STORAGE_KEYS = ['gemini_credentials', 'gemini_credentials_map'] as const

/**
 * Auth tokens are session secrets: keep them in chrome.storage.session, which
 * is memory-backed and never written to disk. Older versions persisted the
 * same keys to chrome.storage.local (unencrypted on-disk JSON); those legacy
 * copies are migrated into the session area and deleted on first read/write.
 * When the session area is unavailable (Firefox, older Chromium) the parser
 * falls back to chrome.storage.local so exports keep working.
 */
type GeminiCredentialArea = Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>

function getGeminiCredentialArea(): GeminiCredentialArea {
  return (chrome.storage.session as GeminiCredentialArea | undefined) ?? chrome.storage.local
}

let geminiLegacyCredentialMigration: Promise<void> | null = null

/** Test hook: re-arm the one-shot migration after swapping storage mocks. */
export function resetGeminiCredentialMigrationForTests(): void {
  geminiLegacyCredentialMigration = null
}

/** One-shot move of pre-migration credentials out of the on-disk area. */
function migrateLegacyGeminiCredentials(target: GeminiCredentialArea): Promise<void> {
  if (target === chrome.storage.local) return Promise.resolve()
  if (!geminiLegacyCredentialMigration) {
    geminiLegacyCredentialMigration = (async () => {
      const legacy = await chrome.storage.local.get([...GEMINI_CREDENTIAL_STORAGE_KEYS])
      const writes: Record<string, unknown> = {}
      for (const key of GEMINI_CREDENTIAL_STORAGE_KEYS) {
        if (legacy[key] !== undefined) writes[key] = legacy[key]
      }
      if (Object.keys(writes).length > 0) await target.set(writes)
      await chrome.storage.local.remove([...GEMINI_CREDENTIAL_STORAGE_KEYS])
    })().catch(() => {
      // A failed migration must not break credential reads; it retries on the
      // next access. The legacy copies remain readable until it succeeds.
      geminiLegacyCredentialMigration = null
    })
  }
  return geminiLegacyCredentialMigration
}
const GEMINI_AUTH_TOKEN_MAX_LENGTH = 4096
const GEMINI_SESSION_ID_MAX_LENGTH = 64
const GEMINI_ACCOUNT_SLOT_MAX_LENGTH = 16
// The live Gemini app currently asks for both conversation-list streams. Keep
// the same page size and envelope shape so bulk history does not depend on the
// virtualized sidebar being scrolled into view.
const GEMINI_LIST_PAGE_SIZE = 25
const GEMINI_LIST_MAX_PAGES_PER_STREAM = 200
const GEMINI_LIST_MODES = [1, 0] as const
const GEMINI_DETAIL_TURN_LIMIT = 1000

/** Result metadata lets the popup distinguish the account API from its
 * intentionally incomplete, virtualized-sidebar fallback. */
export interface GeminiConversationListResult {
  conversations: ConversationListItem[]
  source: 'api' | 'sidebar'
  complete: boolean
}

interface GeminiConversationListStreamResult {
  conversations: ConversationListItem[]
  complete: boolean
  receivedPayload: boolean
}

/** Validate page-world credentials before they enter extension storage. */
export function validateGeminiCredentialPayload(payload: unknown, now = Date.now()): GeminiCredential | null {
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as GeminiCredential
  const at = candidate.at
  const sid = candidate.sid
  const accountSlot = candidate.accountSlot
  const lastUsed = candidate.lastUsed

  if (at !== undefined && (typeof at !== 'string' || !at || at.length > GEMINI_AUTH_TOKEN_MAX_LENGTH)) return null
  if (sid !== undefined && (typeof sid !== 'string' || !/^[+-]?\d+$/.test(sid) || sid.length > GEMINI_SESSION_ID_MAX_LENGTH)) return null
  if (!at && !sid) return null
  if (typeof accountSlot !== 'string' || accountSlot.length > GEMINI_ACCOUNT_SLOT_MAX_LENGTH || !/^(?:default|u\d+)$/.test(accountSlot)) return null
  if (typeof lastUsed !== 'number' || !Number.isFinite(lastUsed) || lastUsed < now - GEMINI_CREDENTIAL_TTL_MS || lastUsed > now + 5 * 60 * 1000) return null

  return { at, sid, accountSlot, lastUsed }
}

/** Keep only recent, valid credentials and cap retained account sessions. */
export function pruneGeminiCredentialMap(
  credentialsMap: Record<string, GeminiCredential> | undefined,
  now = Date.now()
): Record<string, GeminiCredential> {
  const validEntries = Object.entries(credentialsMap || {})
    .map(([key, credential]) => {
      // Older extension versions stored mapped credentials before lastUsed was
      // available. Retain them once, timestamping their migration so TTL
      // enforcement starts immediately rather than breaking active sessions.
      const normalized = credential.lastUsed === undefined ? { ...credential, lastUsed: now } : credential
      return [key, validateGeminiCredentialPayload(normalized, now)] as const
    })
    .filter((entry): entry is readonly [string, GeminiCredential] => entry[1] !== null)
    .sort(([, left], [, right]) => (right.lastUsed || 0) - (left.lastUsed || 0))
    .slice(0, GEMINI_CREDENTIAL_MAX_ENTRIES)

  return Object.fromEntries(validEntries)
}

/**
 * The legacy singleton has no account-slot binding, but it is still used as a
 * fallback while an older page has not produced a hooked credential yet. Give
 * it the same bounded lifetime as the account map and persist the migration so
 * an old entry cannot receive a fresh 24-hour lease on every read.
 */
export function normalizeGeminiSingletonCredential(
  value: unknown,
  now = Date.now()
): GeminiCredential | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as GeminiCredential
  const at = candidate.at
  const sid = candidate.sid
  const lastUsed = candidate.lastUsed

  if (at !== undefined && (typeof at !== 'string' || !at || at.length > GEMINI_AUTH_TOKEN_MAX_LENGTH)) return undefined
  if (sid !== undefined && (typeof sid !== 'string' || !/^[+-]?\d+$/.test(sid) || sid.length > GEMINI_SESSION_ID_MAX_LENGTH)) return undefined
  if (!at && !sid) return undefined
  if (lastUsed !== undefined && (
    typeof lastUsed !== 'number' ||
    !Number.isFinite(lastUsed) ||
    lastUsed < now - GEMINI_CREDENTIAL_TTL_MS ||
    lastUsed > now + 5 * 60 * 1000
  )) return undefined

  return { at, sid, lastUsed: lastUsed ?? now }
}

function geminiTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return undefined
}

/** Gemini's list RPC exposes its row timestamp as [seconds, nanoseconds].
 * It is deliberately parsed as provider activity metadata, not renamed to a
 * conversation creation date that the list endpoint does not document. */
function geminiListTimestamp(value: unknown): number | undefined {
  if (!Array.isArray(value)) return geminiTimestamp(value)
  const seconds = geminiTimestamp(value[0])
  if (seconds === undefined) return undefined
  const nanos = typeof value[1] === 'number' && Number.isFinite(value[1])
    ? Math.max(0, Math.floor(value[1] / 1_000_000))
    : 0
  return seconds + nanos
}

/** Select the newest credential for the active account without cross-account
 * token reuse. Exported so credential selection can be regression-tested
 * without exposing real credentials. */
export function selectGeminiCredential(
  credentialsMap: Record<string, GeminiCredential>,
  accountSlot: string,
  required?: 'at' | 'sid'
): GeminiCredential | null {
  const candidates = Object.values(credentialsMap)
    .filter(credential => credential.accountSlot === accountSlot)
    .filter(credential => Boolean(required ? credential[required] : credential.at || credential.sid))
    .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0))
  return candidates[0] || null
}

/**
 * Hook script code that runs in the PAGE world (not the content script isolated world).
 * Monkey-patches window.fetch and XMLHttpRequest to intercept Gemini batchexecute requests
 * and extract auth tokens (at) and session IDs (f.sid).
 */
const HOOK_SCRIPT_CODE = `(() => {
  const result = {}

  const originalFetch = window.fetch
  window.fetch = async function (...args) {
    try {
      processRequest(args[0], args[1]?.body?.toString?.())
    } catch (e) {}
    return originalFetch.apply(this, args)
  }

  const originalOpen = XMLHttpRequest.prototype.open
  const originalSend = XMLHttpRequest.prototype.send

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__url = url
    return originalOpen.apply(this, arguments)
  }

  XMLHttpRequest.prototype.send = function (body) {
    if (this.__url && this.__url.includes("batchexecute")) {
      try {
        processRequest(this.__url, body && body.toString ? body.toString() : null)
      } catch (e) {}
    }
    return originalSend.apply(this, arguments)
  }

  function getAccountSlot() {
    try {
      var matched = window.location.pathname.match(/\\/u\\/(\\d+)(?:\\/|$)/)
      if (matched && matched[1]) return "u" + matched[1]
    } catch (e) {}
    return "default"
  }

  function processRequest(url, body) {
    try {
      var atMatch = body ? body.match(/at=([a-zA-Z0-9%:\\-_]+)/) : null
      var sidMatch = url ? url.match(/f\\.sid=([+-]?[0-9]+)/) : null

      if (atMatch || sidMatch) {
        result.at = atMatch ? decodeURIComponent(atMatch[1]) : result.at
        result.sid = sidMatch ? sidMatch[1] : result.sid
        result.accountSlot = getAccountSlot()
        result.lastUsed = Date.now()

        window.postMessage(
          { type: "GEMINI_CREDENTIALS", payload: { at: result.at, sid: result.sid, accountSlot: result.accountSlot, lastUsed: result.lastUsed } },
          window.location.origin
        )
      }
    } catch (e) {}
  }
})()`

/**
 * Inject the hook script into the page world.
 * The hook patches fetch/XHR and sends credentials back via postMessage.
 */
function injectHookScript() {
  // Avoid injecting twice
  if (document.querySelector('script[data-gemini-hook="true"]')) return

  const root = document.documentElement
  // document_start normally has an <html> element already, but keep the
  // credential bridge safe on the rare earliest lifecycle boundary.
  if (!root) {
    document.addEventListener('DOMContentLoaded', injectHookScript, { once: true })
    return
  }

  const script = document.createElement('script')
  script.textContent = HOOK_SCRIPT_CODE
  script.setAttribute('data-gemini-hook', 'true')
  script.type = 'text/javascript'
  script.async = false
  root.appendChild(script)
  script.remove()
}

/**
 * Gemini parser implementation
 */
export class GeminiParser {
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
    // 1. Parse document.title — most reliable for Gemini
    const pageTitle = document.title
    if (pageTitle) {
      // Gemini formats titles as "Conversation Title - Gemini"
      const cleaned = pageTitle.replace(/\s*[-–|]\s*Gemini.*$/i, '').trim()
      if (cleaned && cleaned !== 'Gemini' && cleaned.length > 0) {
        return cleaned
      }
    }

    // 2. Try conversation-title class
    const titleEl = document.querySelector('[class*="conversation-title"]')
    if (titleEl) {
      const text = extractTextContent(titleEl)
      if (text && text !== 'Gemini' && text.length > 0) {
        return text
      }
    }

    // 3. Try first user message as fallback
    const firstUserMsg = document.querySelector('user-query, .user-query, [class*="user-message"], [data-message-author-role="user"]')
    if (firstUserMsg) {
      const text = extractTextContent(firstUserMsg)
      if (text && text.length > 0) {
        return text.length > 80 ? text.substring(0, 80) + '...' : text
      }
    }

    return 'Untitled Conversation'
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
      return null
    }
  }

  /**
   * Get the account slot from the URL path (e.g., /u/0/app/...)
   */
  private getAccountSlot(): string {
    try {
      const matched = window.location.pathname.match(/\/u\/(\d+)(?:\/|$)/)
      if (matched?.[1]) return `u${matched[1]}`
    } catch (e) {}
    return 'default'
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
      const accountSlot = this.getAccountSlot()
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
    } catch (e) {
      // chrome.storage not available in tests
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
      const accountSlot = this.getAccountSlot()
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
    const area = getGeminiCredentialArea()
    await migrateLegacyGeminiCredentials(area)
    const stored = await area.get([...GEMINI_CREDENTIAL_STORAGE_KEYS])
    const storedMap: Record<string, GeminiCredential> = stored.gemini_credentials_map || {}
    const now = Date.now()
    const credentialsMap = pruneGeminiCredentialMap(storedMap, now)
    const credentials = normalizeGeminiSingletonCredential(stored.gemini_credentials, now)
    const mapChanged = JSON.stringify(credentialsMap) !== JSON.stringify(storedMap)
    const singletonChanged = JSON.stringify(credentials) !== JSON.stringify(stored.gemini_credentials)

    if (mapChanged || (singletonChanged && credentials)) {
      await area.set({
        ...(mapChanged ? { gemini_credentials_map: credentialsMap } : {}),
        ...(singletonChanged && credentials ? { gemini_credentials: credentials } : {})
      })
    }
    if (singletonChanged && !credentials && stored.gemini_credentials !== undefined) {
      await area.remove('gemini_credentials')
    }
    return { credentials, credentialsMap }
  }

  /**
   * Build the correct URL params for Gemini batchexecute API.
   */
  private buildBatchExecuteUrl(
    rpcids: string,
    sourcePath: string,
    sessionId: string
  ): string {
    const params = new URLSearchParams({
      rpcids,
      'source-path': sourcePath,
      'f.sid': sessionId,
      _reqid: String(Math.floor(Math.random() * 100000)),
      rt: 'c'
    })
    return `https://gemini.google.com/_/BardChatUi/data/batchexecute?${params.toString()}`
  }

  /**
   * Build the form body for a batchexecute request.
   */
  private buildBatchExecuteBody(requestPayload: string, authToken: string): string {
    const body = new URLSearchParams()
    body.set('f.req', requestPayload)
    body.set('at', authToken)
    return body.toString()
  }

  /**
   * Gemini's current batchexecute page requests use a three-level batch
   * envelope: [[[rpcId, jsonArgs, null, 'generic']]]. The older two-level
   * form can return HTTP 200 with an empty payload, which then made the popup
   * silently fall back to only the virtualized sidebar rows.
   */
  private buildGeminiRpcRequest(rpcId: string, args: unknown): string {
    return JSON.stringify([[[rpcId, JSON.stringify(args), null, 'generic']]])
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
    const url = this.buildBatchExecuteUrl(rpcids, sourcePath, sessionId)
    const body = this.buildBatchExecuteBody(requestPayload, authToken)

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
        await this.clearStoredCredentialsForCurrentAccount()
      }
      console.error(`[Gemini Parser] API error: ${response.status}`)
      return null
    }

    this.authenticationRequired = false

    return response.text()
  }

  /** Remove only credentials that are demonstrably invalid for this account. */
  private async clearStoredCredentialsForCurrentAccount(): Promise<void> {
    try {
      const accountSlot = this.getAccountSlot()
      const area = getGeminiCredentialArea()
      await migrateLegacyGeminiCredentials(area)
      const stored = await area.get(['gemini_credentials_map'])
      const credentialsMap = pruneGeminiCredentialMap(stored.gemini_credentials_map)
      for (const [key, credential] of Object.entries(credentialsMap)) {
        if (credential.accountSlot === accountSlot) delete credentialsMap[key]
      }
      await area.set({ gemini_credentials_map: credentialsMap })
      await area.remove('gemini_credentials')
    } catch {
      // Storage is optional for DOM parsing and must not mask the API failure.
    }
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
        console.error('[Gemini Parser] Could not find auth token')
        return { conversations: this.getConversationList(), source: 'sidebar', complete: false }
      }

      const sessionId = await this.getSessionId()
      const streams = await Promise.all(
        GEMINI_LIST_MODES.map(mode => this.fetchGeminiConversationListStream(authToken, sessionId, mode))
      )
      const conversations = this.mergeGeminiConversationListItems(
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
      console.error('[Gemini Parser] Error fetching account history:', error)
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
          this.buildGeminiRpcRequest('MaZiqc', [
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

      const payload = this.parseRpcPayload(text, 'MaZiqc')
      if (!Array.isArray(payload)) return { conversations, complete: false, receivedPayload }
      receivedPayload = true
      conversations.push(...this.parseBatchResponse(payload))

      const nextPageToken = this.extractGeminiListPageToken(payload)
      if (!nextPageToken) return { conversations, complete: true, receivedPayload }
      if (seenPageTokens.has(nextPageToken)) {
        return { conversations, complete: false, receivedPayload }
      }

      seenPageTokens.add(nextPageToken)
      pageToken = nextPageToken
    }

    return { conversations, complete: false, receivedPayload }
  }

  /** Keep the known cursor positions explicit rather than recursively guessing strings. */
  private extractGeminiListPageToken(payload: unknown): string | null {
    if (!Array.isArray(payload)) return null
    const nested = Array.isArray(payload[0]) ? payload[0] : []
    const candidates = [payload[1], nested[1]]
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate
    }
    return null
  }

  /** Deduplicate the two streams without discarding a provider timestamp. */
  private mergeGeminiConversationListItems(items: ConversationListItem[]): ConversationListItem[] {
    const byId = new Map<string, ConversationListItem>()
    for (const item of items) {
      const existing = byId.get(item.id)
      if (!existing || (!Number.isFinite(existing.updatedAt) && Number.isFinite(item.updatedAt))) {
        byId.set(item.id, item)
      }
    }
    return Array.from(byId.values())
  }

  /**
   * Parse the batchexecute response to extract conversation items
   */
  private parseBatchResponse(data: any[]): ConversationListItem[] {
    const items: ConversationListItem[] = []

    try {
      // The response structure varies, try to find conversation entries
      const findConversations = (obj: any): void => {
        if (!obj || typeof obj !== 'object') return

        if (Array.isArray(obj)) {
          // Look for arrays that contain conversation-like data
          for (const item of obj) {
            if (Array.isArray(item) && item.length >= 2) {
              // Check if this looks like a conversation entry (has ID and title)
              const maybeId = item[0]
              const maybeTitle = item[1] || item[2]
              if (
                typeof maybeId === 'string' &&
                /^c_[a-zA-Z0-9_-]+$/.test(maybeId) &&
                typeof maybeTitle === 'string'
              ) {
                const normalizedId = maybeId.replace(/^c_/, '')
                const updatedAt = geminiListTimestamp(item[5])
                items.push({
                  id: normalizedId,
                  title: maybeTitle,
                  url: `https://gemini.google.com/app/${normalizedId}`,
                  platform: 'gemini',
                  ...(updatedAt === undefined ? {} : { updatedAt })
                })
              }
            }
            findConversations(item)
          }
        } else {
          for (const key of Object.keys(obj)) {
            findConversations(obj[key])
          }
        }
      }

      findConversations(data)
    } catch {
      // Parsing failed
    }

    return items
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
        console.error('[Gemini Parser] Could not find auth token for detail fetch')
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
      const requestPayload = this.buildGeminiRpcRequest('hNvQHb', [
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
        console.error(`[Gemini Parser] Failed to fetch conversation ${normalizedId}`)
        return null
      }

      const payload = this.parseRpcPayload(text, 'hNvQHb')
      const messages = this.extractMessagesFromDetailPayload(payload)
      if (messages.length === 0) return null

      // Try to extract title from the response
      let title = requestedTitle?.trim() || 'Untitled Conversation'
      const currentUrlId = window.location.pathname.match(/\/app\/([a-zA-Z0-9_-]+)/)?.[1]
      const pageTitle = currentUrlId === normalizedId ? document.title : ''
      if (!requestedTitle && pageTitle) {
        const cleaned = pageTitle.replace(/\s*[-–|]\s*Gemini.*$/i, '').trim()
        if (cleaned && cleaned !== 'Gemini') {
          title = cleaned
        }
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
      console.error('[Gemini Parser] Error fetching conversation detail:', error)
      return null
    }
  }

  /**
   * Parse one typed inner payload from a batchexecute response.
   */
  private parseRpcPayload(text: string, rpcId: string): any | null {
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      const jsonStart = trimmed.indexOf('[[')
      if (jsonStart === -1) continue

      try {
        const outer = JSON.parse(trimmed.substring(jsonStart))
        for (const entry of outer) {
          if (
            Array.isArray(entry) &&
            entry[0] === 'wrb.fr' &&
            entry[1] === rpcId &&
            typeof entry[2] === 'string'
          ) {
            return JSON.parse(entry[2])
          }
        }
      } catch {
        // Length markers and diagnostic lines are not JSON payloads.
      }
    }

    return null
  }

  /**
   * Extract only the documented turn fields observed in Gemini's detail RPC.
   * Turns arrive newest first and are reversed into display order.
   */
  private extractMessagesFromDetailPayload(payload: any): ChatMessage[] {
    const turns = payload?.[0]
    if (!Array.isArray(turns)) return []

    const messages: ChatMessage[] = []
    for (const turn of [...turns].reverse()) {
      if (!Array.isArray(turn)) continue

      const timestampSeconds = turn?.[4]?.[0]
      const timestamp = typeof timestampSeconds === 'number'
        ? timestampSeconds * 1000
        : undefined
      const responseId = typeof turn?.[0]?.[1] === 'string'
        ? turn[0][1]
        : generateId()
      const userText = turn?.[2]?.[0]?.[0]
      const assistantMarkdown = turn?.[3]?.[0]?.[0]?.[1]?.[0]

      if (typeof userText === 'string' && userText.trim()) {
        messages.push({
          id: `${responseId}-user`,
          role: 'user',
          content: stripProviderArtifacts(userText).trim(),
          timestamp
        })
      }

      if (typeof assistantMarkdown === 'string' && assistantMarkdown.trim()) {
        messages.push({
          id: responseId,
          role: 'assistant',
          content: stripProviderArtifacts(assistantMarkdown).trim(),
          timestamp
        })
      }
    }

    return messages
  }

  /**
   * Extract all messages from the conversation DOM
   * Uses a single pass with deduplication to avoid counting messages twice
   */
  private extractMessages(): ChatMessage[] {
    const messages: ChatMessage[] = []
    const seenElements = new Set<Element>()

    // Scope strictly to the main conversation container. The sidebar (nav/aside)
    // holds duplicate copies of every message that MUST NOT be re-collected.
    const root =
      document.querySelector('chat-window-content') ||
      document.querySelector('chat-window') ||
      document.querySelector('main') ||
      document.querySelector('[role="main"]') ||
      document.querySelector('[class*="conversation"]') ||
      document.body
    if (!root) return messages

    // ONE query that returns BOTH user and assistant elements in document order.
    // This is the key fix: a single querySelectorAll preserves the real
    // interleaved user/assistant/user/assistant order. Splitting into separate
    // user-then-assistant passes would wrongly emit "all users then all
    // assistants".
    const MESSAGE_SELECTOR =
      'user-query, .user-query, [class*="user-message"], [data-message-author-role="user"], ' +
      'model-response, .model-response, [class*="model-message"], [data-message-author-role="model"]'

    let nodes = Array.from(root.querySelectorAll(MESSAGE_SELECTOR)) as Element[]

    // Fallback: if the specific selectors found nothing, broaden to any
    // query/response/content element (still in DOM order).
    if (nodes.length === 0) {
      nodes = Array.from(
        root.querySelectorAll('[class*="query"], [class*="response"], [class*="content"]')
      ) as Element[]
    }

    let prevText = ''
    for (const element of nodes) {
      if (seenElements.has(element)) continue
      seenElements.add(element)

      const roleAttr = element.getAttribute('data-message-author-role')
      const role: ChatMessage['role'] =
        roleAttr === 'user' ? 'user' :
        roleAttr === 'model' ? 'assistant' :
        /user|query/i.test(element.className) || element.matches('user-query, .user-query, [class*="user-message"], [class*="query"]')
          ? 'user' : 'assistant'

      // Dedup: skip only if this node is text-identical to the PREVIOUS one we
      // kept. This removes adjacent duplicate DOM copies (sidebar/artifact/
      // "Gemini said" panels render the same text back-to-back) WITHOUT
      // dropping a genuine repeated message that appears LATER in the
      // conversation (non-consecutive). Compare the FULL normalized text — a
      // 200-char prefix slice would wrongly collapse two different messages
      // that merely share a long opening (e.g. the same code block pasted
      // twice with different follow-up text).
      const text = (element.textContent || '').replace(/\s+/g, ' ').trim()
      if (text && text === prevText) continue
      prevText = text

      const message = this.parseMessageElement(element, role)
      if (message) {
        messages.push(message)
      }
    }

    return messages
  }

  /**
   * Parse a message element
   */
  private parseMessageElement(element: Element, role: ChatMessage['role']): ChatMessage | null {
    // Gemini places Search/Maps result cards beside the prose subtree. Parse
    // the message root so a narrow `.content` child cannot drop those visible
    // cards from the transcript.
    const contentElement = element

    const content = this.extractMessageContent(contentElement)

    if (!content.trim()) {
      return null
    }

    const codeBlocks = extractCodeBlocks(contentElement)

    const imageData = extractImages(contentElement)
    const attachments = imageData.map(img => ({
      type: 'image' as const,
      url: img.url,
      name: img.alt,
      uploaded: role === 'user'
    }))

    const messageId = element.getAttribute('data-message-id') ||
                     element.id ||
                     generateId()

    return {
      id: messageId,
      role,
      content,
      attachments: attachments.length > 0 ? attachments : undefined,
      codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
      timestamp: geminiTimestamp(
        element.querySelector('time[datetime]')?.getAttribute('datetime')
          || element.getAttribute('data-timestamp')
          || element.getAttribute('data-created-at')
      )
    }
  }

  /**
   * Extract clean content from a message element
   */
  private extractMessageContent(element: Element): string {
    const clone = element.cloneNode(true) as Element

    const removeSelectors = [
      'button',
      '[class*="toolbar"]',
      '[class*="copy"]',
      '[class*="share"]',
      // Gemini injects static UI crumbs that are not message content
      '[class*="crumb"]',
      '[aria-label*="Gemini said"]',
      '[class*="said"]',
      '[class*="notebook"]',
      '[class*="research"]'
    ]

    removeSelectors.forEach(selector => {
      clone.querySelectorAll(selector).forEach(el => el.remove())
    })

    this.injectPlaceCardLabels(clone)

    // Read the cloned subtree once while adding line breaks for block nodes.
    // Image nodes become Markdown at their DOM position, so a place photo is
    // exported next to its location details instead of at the final page.
    let content = extractTextWithMedia(clone)

    // Drop standalone UI crumb lines Gemini renders inside the message body
    // (e.g. "Gemini said", "New notebook", "Show research", "Show thinking").
    const UI_CRUMB_PATTERNS = [
      /^gemini said$/i,
      /^new notebook$/i,
      /^show research$/i,
      /^show thinking$/i,
      /^show full response$/i,
      /^view other drafts$/i
    ]
    content = content
      .split('\n')
      .filter(line => !UI_CRUMB_PATTERNS.some(p => p.test(line.trim())))
      .join('\n')

    return cleanText(content)
  }

  /**
   * Some Gemini Maps cards expose their name/rating only as an accessible link
   * label. Keep it in the transcript before text extraction; ordinary cards
   * whose visible text already contains the label are left untouched.
   */
  private injectPlaceCardLabels(root: Element): void {
    const selectors = [
      '[data-place-id]',
      '[data-entity-id]',
      'a[href*="/maps"]',
      'a[href*="maps.google"]',
      'a[href*="google.com/maps"]'
    ]
    const seen = new Set<Element>()
    for (const selector of selectors) {
      root.querySelectorAll(selector).forEach(card => {
        if (seen.has(card)) return
        seen.add(card)
        const label = cleanText(card.getAttribute('aria-label') || '')
        if (!label) return
        const visible = cleanText(card.textContent || '')
        if (visible.toLocaleLowerCase().includes(label.toLocaleLowerCase())) return
        card.insertBefore(document.createTextNode(`\n\n${label}\n\n`), card.firstChild)
      })
    }
  }

  // getElementPosition removed — querySelectorAll already returns DOM order

  /**
   * Extract conversation creation timestamp
   */
  private extractCreatedAt(): number | undefined {
    const timeElements = document.querySelectorAll('time[datetime]')
    if (timeElements.length > 0) {
      const datetime = timeElements[0].getAttribute('datetime')
      if (datetime) {
        const timestamp = new Date(datetime).getTime()
        if (!isNaN(timestamp)) {
          return timestamp
        }
      }
    }
    return undefined
  }

  /**
   * Get list of conversations from the sidebar (DOM-based, limited to visible items)
   */
  getConversationList(): ConversationListItem[] {
    const conversations: ConversationListItem[] = []
    const seen = new Set<string>()

    const selectors = [
      'nav a[href*="/app/"]',
      'aside a[href*="/app/"]',
      '[class*="sidebar"] a[href*="/app/"]',
      '[class*="history"] a[href*="/app/"]',
      'a[href^="/app/"]'
    ]

    for (const selector of selectors) {
      const links = document.querySelectorAll(selector)

      links.forEach(link => {
        const href = link.getAttribute('href')
        if (!href) return

        const match = href.match(/\/app\/([a-zA-Z0-9_-]+)/)
        if (!match) return

        const id = match[1]
        if (seen.has(id)) return

        const title = extractTextContent(link) || 'Untitled Conversation'

        seen.add(id)
        conversations.push({
          id,
          title,
          url: new URL(href, window.location.origin).href,
          platform: 'gemini'
        })
      })

      if (conversations.length > 0) break
    }

    return conversations
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
    const credential = validateGeminiCredentialPayload(event.data.payload)
    if (credential) {
      try {
        const area = getGeminiCredentialArea()
        await migrateLegacyGeminiCredentials(area)

        // Get existing map to merge
        const existing = await area.get(['gemini_credentials_map'])
        const credentialsMap = pruneGeminiCredentialMap(existing.gemini_credentials_map)

        // Update the map with new credentials for this session
        const key = credential.sid || 'default'
        credentialsMap[key] = {
          ...credential
        }
        const prunedCredentialsMap = pruneGeminiCredentialMap(credentialsMap)

        await area.set({
          gemini_credentials: { at: credential.at, sid: credential.sid, lastUsed: credential.lastUsed },
          gemini_credentials_map: prunedCredentialsMap
        })
      } catch (e) {
        // Storage may not be available in some contexts
      }
    }
  }
})

// Inject hook script into the page world for credential extraction
injectHookScript()

// Register the shared popup-message handler (see src/lib/parser-runtime.ts).
// Gemini overrides the branches whose flow differs from the standard
// parse/API-merge pipeline: credential-resolved current-conversation fetches
// and the status-carrying conversation list.
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  registerParserMessageHandler({
    platform: 'gemini',
    parser,
    handleParseConversation: (_message, sendResponse) => {
      const conversationId = window.location.pathname.match(/\/app\/([a-zA-Z0-9_-]+)/)?.[1]
      const conversationPromise = conversationId
        ? resolveCurrentGeminiConversation(parser, conversationId)
        : parser.parseCurrentConversation()
      conversationPromise.then(conversation => {
        sendResponse({ data: conversation })
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
