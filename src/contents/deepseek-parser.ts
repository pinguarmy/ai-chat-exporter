/**
 * DeepSeek DOM + API Parser Content Script
 * Parses conversations from deepseek.com / chat.deepseek.com
 * - DOM parsing for current conversation page
 * - API-based conversation list fetching (cookie-authenticated)
 */
import type {
  Conversation,
  ChatMessage,
  ConversationListItem,
  MessageReference
} from '../core/types'
import type { ProviderParser } from '../providers/provider-parser'
import { createVerificationEvidence, syncSourceCompleteness } from '../core/verification'
import { normalizeApiTimestamp as deepSeekTimestamp } from '../providers/api-message-normalizer'
import { generateId, extractTextContent, stripProviderArtifacts } from '../core/dom-utils'
import {
  cleanDocumentTitle,
  extractPageCreatedAt,
  titleFromMessageText
} from '../providers/page-metadata'
import {
  collectAuthorRoleMessages,
  collectClassCandidateMessages,
  extractCleanMessageText,
  parseAuthorRoleElement
} from '../providers/dom-message'
import { detectRoleFromClassName, detectRoleFromIndicators } from '../providers/dom-roles'
import { collectSidebarConversationList } from '../providers/sidebar-list'
import { registerParserMessageHandler, runParserMain } from '../providers/parser-runtime'
import { createDomSnapshotSupport } from '../providers/dom-snapshot'
import {
  extractApiMessageText,
  getApiMessageRecords,
  normalizeApiMessageRole
} from '../providers/api-message-normalizer'
import {
  isProviderRateLimitError,
  isRateLimitedResponse,
  ProviderRateLimitError
} from '../core/provider-rate-limit'
import {
  dedupeMessageReferences,
  sanitizeReferenceUrl,
  normalizeReferenceTitle,
  isPrivateReferenceUrl
} from '../core/message-references'
import { createLogger, errorName } from '../core/logger'
import { isJsonRecord } from '../core/provider-payload'

const log = createLogger('DeepSeek Parser')

function deepSeekModelName(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

export interface DeepSeekHistoryPage {
  /** Raw history rows; each is inspected with isJsonRecord before use. */
  items: unknown[]
  nextCursor?: string
  hasMore: boolean
}

interface DeepSeekConversationListMeta extends Record<string, unknown> {
  source: 'api' | 'sidebar'
  complete: boolean
  pagesFetched?: number
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function unwrapDeepSeekEnvelope(data: unknown): unknown {
  let envelope = data
  // Live `/chat_session/fetch_page` wraps rows in { code, data: { biz_data } }.
  for (let depth = 0; depth < 4; depth++) {
    if (!isJsonRecord(envelope)) break
    if (envelope.biz_data && typeof envelope.biz_data === 'object') {
      envelope = envelope.biz_data
      continue
    }
    if (envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data)) {
      envelope = envelope.data
      continue
    }
    break
  }
  return envelope
}

/** Normalize the several history response envelopes seen in DeepSeek builds. */
export function parseDeepSeekHistoryPage(data: unknown): DeepSeekHistoryPage {
  const unwrapped = unwrapDeepSeekEnvelope(data)
  const envelope: Record<string, unknown> = isJsonRecord(unwrapped) ? unwrapped : {}
  const rawItems = Array.isArray(unwrapped)
    ? unwrapped
    : envelope.chat_sessions ||
      envelope.items ||
      envelope.conversations ||
      envelope.chat_session ||
      envelope.data ||
      []
  const items = Array.isArray(rawItems) ? rawItems : []
  const nextCursor = [
    envelope.next_cursor,
    envelope.nextCursor,
    envelope.next_page_token,
    envelope.nextPageToken,
    envelope.cursor,
    envelope.lte_cursor
  ].find((value): value is string => typeof value === 'string' && value.length > 0)
  const explicitHasMore = envelope.has_more ?? envelope.hasMore ?? envelope.has_next_page
  return {
    items,
    nextCursor,
    hasMore: typeof explicitHasMore === 'boolean' ? explicitHasMore : Boolean(nextCursor)
  }
}

const DEEPSEEK_VISIBLE_FRAGMENT_TYPES = new Set(['REQUEST', 'RESPONSE', 'ANSWER', 'TEXT'])

/** Get the message_id key from a DeepSeek message record. */
function deepSeekMessageId(item: Record<string, unknown>): string | undefined {
  if (typeof item.message_id === 'number') return String(item.message_id)
  if (typeof item.message_id === 'string' && item.message_id) return item.message_id
  if (typeof item.id === 'string' && item.id) return item.id
  return undefined
}

/** Get the parent_id from a DeepSeek message record.
 *  Returns null for an explicit root (parent_id: null), undefined when the field is absent. */
function deepSeekParentId(item: Record<string, unknown>): string | null | undefined {
  if (!('parent_id' in item)) return undefined // field absent → no chain data
  const raw = item.parent_id
  if (raw === null) return null
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  if (typeof raw === 'string' && raw.trim()) return raw
  return undefined
}

/** Convert a message record to a ChatMessage, returning null when content is empty. */
function deepSeekItemToMessage(item: Record<string, unknown>): ChatMessage | null {
  const role = normalizeApiMessageRole(item)
  if (!role) return null
  const content = extractDeepSeekVisibleText(item)
  if (!content) return null
  const references = extractDeepSeekWebReferences(item)
  return {
    id: deepSeekMessageId(item) || generateId(),
    role,
    content: stripProviderArtifacts(content).trim(),
    timestamp: deepSeekTimestamp(
      item.inserted_at ??
        item.created_at ??
        item.createdAt ??
        item.create_time ??
        (isJsonRecord(item.message) ? item.message.created_at : undefined)
    ),
    ...(references.length ? { references } : {})
  }
}

/**
 * Resolve the selected conversation branch.
 *
 * When `chat_session.current_message_id` and per-message `parent_id`
 * fields are present, walk from the leaf back to root through parent links,
 * reverse to produce root-first order, and only mark the chain complete when
 * every link resolves and no cycle is detected.
 *
 * When these fields are absent (legacy or flat synthetic fixtures) the items
 * are returned in their original order with chainComplete = false, because
 * there is no structural evidence of branch selection.
 */
export function resolveDeepSeekMessageChain(
  items: Record<string, unknown>[],
  session: Record<string, unknown> | null | undefined
): { messages: ChatMessage[]; chainComplete: boolean } {
  const currentMessageId = session?.current_message_id
  const currentIdStr =
    typeof currentMessageId === 'number'
      ? String(currentMessageId)
      : typeof currentMessageId === 'string' && currentMessageId
        ? currentMessageId
        : null

  // Check whether items carry parent_id chain data.
  // parent_id present (even as null for root) + message_id = chain evidence.
  const hasChainFields = items.some(item => 'parent_id' in item && item.message_id !== undefined)

  if (!currentIdStr || !hasChainFields) {
    // No chain evidence — fall back to flat iteration, unverified.
    const messages: ChatMessage[] = []
    for (const item of items) {
      const msg = deepSeekItemToMessage(item)
      if (msg) messages.push(msg)
    }
    return { messages, chainComplete: false }
  }

  // Build lookup by message_id.
  const byId = new Map<string, Record<string, unknown>>()
  const duplicateIds = new Set<string>()
  for (const item of items) {
    const mid = deepSeekMessageId(item)
    if (!mid) continue
    if (byId.has(mid)) duplicateIds.add(mid)
    else byId.set(mid, item)
  }

  // Walk from current_message_id back through parent_id.
  const chain: Record<string, unknown>[] = []
  const visited = new Set<string>()
  let cursor: string | null | undefined = currentIdStr
  let reachedRoot = false

  while (typeof cursor === 'string') {
    if (visited.has(cursor) || duplicateIds.has(cursor)) break // cycle or ambiguous link
    visited.add(cursor)
    const item = byId.get(cursor)
    if (!item) break // broken link
    chain.push(item)
    const parentId = deepSeekParentId(item)
    if (parentId === null) {
      // Explicit root (parent_id: null) — chain is anchored.
      reachedRoot = true
      break
    }
    if (parentId === undefined) {
      // Field absent — no chain data on this item, cannot verify.
      break
    }
    cursor = parentId
  }

  // Reverse: root → leaf.
  chain.reverse()

  const messages: ChatMessage[] = []
  for (const item of chain) {
    const msg = deepSeekItemToMessage(item)
    if (msg) messages.push(msg)
  }

  // Chain is complete when: we reached an explicit root (parent_id: null)
  // and the walk started from current_message_id.
  const chainComplete = chain.length > 0 && reachedRoot && duplicateIds.size === 0

  return { messages, chainComplete }
}

/**
 * Extract public web source references from DeepSeek TOOL_SEARCH fragments.
 * Only HTTP(S) URLs with titles from search results are included.
 * THINK content, queries, and non-HTTP sources are never exported.
 */
export function extractDeepSeekWebReferences(item: Record<string, unknown>): MessageReference[] {
  const fragments = Array.isArray(item.fragments) ? item.fragments : []
  const references: MessageReference[] = []
  for (const fragment of fragments) {
    if (!fragment || typeof fragment !== 'object') continue
    const typed = fragment as Record<string, unknown>
    const type = typeof typed.type === 'string' ? typed.type.toUpperCase() : ''
    if (type !== 'TOOL_SEARCH') continue
    const results = Array.isArray(typed.results) ? typed.results : []
    for (const result of results) {
      if (!result || typeof result !== 'object') continue
      const r = result as Record<string, unknown>
      const url = sanitizeReferenceUrl(r.url)
      if (!url) continue
      const title = normalizeReferenceTitle(r.title, '')
      if (!title) continue
      const source = normalizeReferenceTitle(r.site_name, '')
      references.push({
        type: 'web',
        title,
        url,
        private: isPrivateReferenceUrl(url),
        ...(source ? { source } : {})
      })
    }
  }
  return dedupeMessageReferences(references)
}

/** Visible DeepSeek turn text. THINK / TOOL_SEARCH fragments stay out of the archive. */
export function extractDeepSeekVisibleText(item: Record<string, unknown>): string {
  const fragments = Array.isArray(item.fragments) ? item.fragments : []
  const fromFragments = fragments.flatMap(fragment => {
    if (!fragment || typeof fragment !== 'object') return []
    const typed = fragment as Record<string, unknown>
    const type = typeof typed.type === 'string' ? typed.type.toUpperCase() : ''
    if (type && !DEEPSEEK_VISIBLE_FRAGMENT_TYPES.has(type)) return []
    return typeof typed.content === 'string' && typed.content.trim() ? [typed.content.trim()] : []
  })
  if (fromFragments.length > 0) return fromFragments.join('\n\n')
  return extractApiMessageText(item)
}

export const DEEPSEEK_HISTORY_ENDPOINTS = [
  'https://chat.deepseek.com/api/v0/chat_session/fetch_page',
  'https://chat.deepseek.com/api/v0/chat/history'
] as const

function deepSeekHistoryUrl(base: string, cursor: string, offset: number): string {
  const query = new URLSearchParams()
  if (base.endsWith('/chat_session/fetch_page')) {
    query.set('lte_cursor.pinned', 'false')
    if (cursor) query.set('lte_cursor.id', cursor)
  } else {
    if (cursor) query.set('cursor', cursor)
    else if (offset > 0) query.set('offset', String(offset))
    query.set('limit', '100')
  }
  return `${base}?${query.toString()}`
}

/**
 * DeepSeek parser implementation
 */
export class DeepSeekParser implements ProviderParser {
  platform = 'deepseek' as const
  private authenticationRequired = false
  private conversationListMeta: DeepSeekConversationListMeta = {
    source: 'sidebar',
    complete: false
  }

  /** Safe aggregate signal for the scheduled-export status surface. */
  isAuthenticationRequired(): boolean {
    return this.authenticationRequired
  }

  getConversationListMeta(): DeepSeekConversationListMeta {
    return { ...this.conversationListMeta }
  }

  /**
   * Check if current page is a DeepSeek conversation
   */
  isConversationPage(): boolean {
    return !!(
      document.querySelector(
        '[class*="chat-message"], [class*="ds-message"], [data-message-author-role]'
      ) ||
      document.querySelector('[data-message-author-role]') ||
      window.location.pathname.match(/\/a\/chat\/s\/[A-Za-z0-9_-]+/) ||
      window.location.pathname.match(/\/chat\/[A-Za-z0-9_-]+/)
    )
  }

  /**
   * Get the conversation title from the page
   * Strategy:
   * 1. Parse document.title (most reliable: "Conversation Title - DeepSeek")
   * 2. Try first user message as fallback
   * 3. Last resort: "Untitled Conversation"
   */
  getConversationTitle(): string {
    const firstUserMsg =
      document.querySelector('[data-message-author-role="user"]') ||
      document.querySelector('[class*="user-message"]') ||
      document.querySelector('[class*="message-user"]')
    return (
      cleanDocumentTitle(document.title, 'DeepSeek') ||
      titleFromMessageText(firstUserMsg ? extractTextContent(firstUserMsg) : null) ||
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

      return syncSourceCompleteness({
        id: this.extractConversationId() || generateId(),
        title: this.getConversationTitle(),
        url: window.location.href,
        messages,
        createdAt: this.extractCreatedAt(),
        modelName: deepSeekModelName(
          document.body.getAttribute('data-model'),
          document.querySelector('[data-model]')?.getAttribute('data-model')
        ),
        platform: 'deepseek',
        source: 'dom',
        sourceCompleteness: 'unverified',
        verification: createVerificationEvidence({
          provider: 'deepseek',
          source: 'dom',
          transcript: {
            verified: false,
            method: 'dom-unverified',
            reasons: ['source_unverified']
          }
        })
      })
    } catch (error) {
      log.debug(`DOM parse failed (${errorName(error)})`)
      return null
    }
  }

  /**
   * Fetch ALL conversations via DeepSeek API
   * DeepSeek uses cookie-based auth, so we can fetch directly with credentials: 'include'
   */
  async fetchAllConversations(): Promise<ConversationListItem[]> {
    this.conversationListMeta = { source: 'sidebar', complete: false }
    const conversations: ConversationListItem[] = []
    const seen = new Set<string>()
    let paginationFailed = false
    let pagesFetched = 0

    try {
      const maxPages = 100
      let cursor = ''
      let offset = 0
      const seenCursors = new Set<string>()
      let endpoint: string | null = null
      for (let page = 0; page < maxPages; page++) {
        let response: Response | null = null
        const candidates: string[] = endpoint ? [endpoint] : [...DEEPSEEK_HISTORY_ENDPOINTS]
        for (const base of candidates) {
          response = await fetch(deepSeekHistoryUrl(base, cursor, offset), {
            method: 'GET',
            credentials: 'include',
            headers: { Accept: 'application/json' }
          })
          if (isRateLimitedResponse(response)) throw new ProviderRateLimitError()
          if (response.status === 401 || response.status === 403) {
            this.authenticationRequired = true
            throw new Error(`DeepSeek history request failed: ${response.status}`)
          }
          if (response.ok) {
            endpoint = base
            break
          }
          response = null
        }
        if (!response) throw new Error('DeepSeek history request failed: no matching endpoint')

        this.authenticationRequired = false

        const pageData = parseDeepSeekHistoryPage(await response.json())
        pagesFetched += 1
        for (const rawItem of pageData.items) {
          const item: Record<string, unknown> = isJsonRecord(rawItem) ? rawItem : {}
          const id = item.chat_session_id || item.id
          if (typeof id !== 'string' || !id || seen.has(id)) continue
          const rawTitle = item.title || item.name
          const title = typeof rawTitle === 'string' ? rawTitle : 'Untitled Conversation'
          seen.add(id)
          conversations.push({
            id,
            title,
            url: `https://chat.deepseek.com/a/chat/s/${id}`,
            platform: 'deepseek',
            createdAt: deepSeekTimestamp(
              item.created_at ??
                item.createdAt ??
                item.updated_at ??
                item.inserted_at ??
                item.create_time
            )
          })
        }

        if (!pageData.hasMore || pageData.items.length === 0) break
        if (pageData.nextCursor) {
          if (seenCursors.has(pageData.nextCursor))
            throw new Error('DeepSeek history pagination cursor repeated')
          seenCursors.add(pageData.nextCursor)
          cursor = pageData.nextCursor
        } else {
          const lastItem = pageData.items.at(-1)
          const lastRecord: Record<string, unknown> = isJsonRecord(lastItem) ? lastItem : {}
          const lastId = lastRecord.chat_session_id || lastRecord.id
          if (
            typeof lastId === 'string' &&
            lastId &&
            endpoint?.endsWith('/chat_session/fetch_page')
          ) {
            if (seenCursors.has(lastId))
              throw new Error('DeepSeek history pagination cursor repeated')
            seenCursors.add(lastId)
            cursor = lastId
          } else {
            offset += pageData.items.length
            cursor = ''
          }
        }
        if (page === maxPages - 1)
          throw new Error('DeepSeek history pagination exceeded safe page limit')
      }
    } catch (error) {
      if (isProviderRateLimitError(error)) throw error
      paginationFailed = true
      log.error(`Error fetching conversations (${errorName(error)})`)
    }

    // Never present a partially paginated API response as the complete list.
    // An empty, successfully parsed account is still a complete API result.
    if (paginationFailed) {
      return this.getConversationList()
    }

    this.conversationListMeta = { source: 'api', complete: true, pagesFetched }
    return conversations
  }

  /**
   * Fetch full conversation detail from the DeepSeek API
   */
  async fetchConversationDetail(id: string): Promise<Conversation | null> {
    try {
      const response = await fetch(
        `https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=${encodeURIComponent(id)}`,
        {
          method: 'GET',
          credentials: 'include',
          headers: {
            Accept: 'application/json'
          }
        }
      )

      if (isRateLimitedResponse(response)) {
        throw new ProviderRateLimitError()
      }

      if (!response.ok) {
        log.error('Failed to fetch conversation', { status: response.status })
        return null
      }

      const data = await response.json()
      const unwrapped = unwrapDeepSeekEnvelope(data)
      const envelope: Record<string, unknown> = isJsonRecord(unwrapped) ? unwrapped : {}
      const session: Record<string, unknown> = isJsonRecord(envelope.chat_session)
        ? envelope.chat_session
        : envelope
      const items = getApiMessageRecords(data)

      // Resolve the selected branch: walk parent_id from the
      // session's current_message_id back to the root, then reverse.
      const { messages, chainComplete } = resolveDeepSeekMessageChain(items, session)

      return syncSourceCompleteness({
        id,
        title:
          nonEmptyString(session.title) ??
          nonEmptyString(session.name) ??
          nonEmptyString(data.title) ??
          this.getConversationTitle(),
        url: `https://chat.deepseek.com/a/chat/s/${id}`,
        messages,
        createdAt: deepSeekTimestamp(
          session?.inserted_at ??
            session?.created_at ??
            session?.createdAt ??
            session?.create_time ??
            data.created_at ??
            data.createdAt ??
            data.create_time
        ),
        modelName: deepSeekModelName(
          session?.model_type,
          session?.model,
          session?.model_name,
          session?.modelName,
          session?.model_slug,
          data.model,
          data.model_name,
          data.modelName,
          data.model_slug
        ),
        platform: 'deepseek',
        source: 'api',
        sourceCompleteness: chainComplete ? 'verified' : 'unverified',
        verification: createVerificationEvidence({
          provider: 'deepseek',
          source: 'api',
          transcript: {
            verified: chainComplete,
            method: chainComplete ? 'provider-api-complete' : 'provider-api-incomplete',
            reasons: chainComplete ? ['source_verified'] : ['branch_chain_incomplete']
          }
        })
      })
    } catch (error) {
      if (isProviderRateLimitError(error)) throw error
      log.error(`Error fetching conversation detail (${errorName(error)})`)
      return null
    }
  }

  /**
   * Extract conversation ID from the URL
   */
  private extractConversationId(): string | null {
    const match = window.location.pathname.match(/\/a\/chat\/s\/([A-Za-z0-9_-]+)/)
    if (match) return match[1]
    const match2 = window.location.pathname.match(/\/chat\/([A-Za-z0-9_-]+)/)
    if (match2) return match2[1]
    return null
  }

  /**
   * Extract all messages from the conversation DOM
   * Uses deduplication to avoid counting the same message twice
   */
  private extractMessages(): ChatMessage[] {
    // Prefer explicit data-message-author-role markup when DeepSeek renders it.
    const authored = collectAuthorRoleMessages(document, element =>
      this.parseMessageElement(element)
    )
    if (authored) return authored

    // Fallback: user and assistant candidates are queried together so one
    // role cannot hide the other; querySelectorAll preserves DOM order.
    const seenElements = new Set<Element>()
    const messages = collectClassCandidateMessages(document, {
      selector:
        '[class*="message-user"], [class*="message-assistant"], ' +
        '[class*="ds-message"], [class*="chat-message"], [class*="turn"]',
      resolveRole: element =>
        this.determineRoleFromElement(element) || this.determineRoleFromClass(element),
      extractContent: element => this.extractMessageContent(element),
      seen: seenElements
    })

    // Final fallback: look for generic message containers
    if (messages.length === 0) {
      const genericSelectors = ['[class*="message"]', '[class*="msg"]', '[class*="turn"]']

      for (const selector of genericSelectors) {
        const elements = document.querySelectorAll(selector)
        elements.forEach(element => {
          if (seenElements.has(element)) return
          seenElements.add(element)
          const message = this.parseGenericMessage(element)
          if (message) {
            messages.push(message)
          }
        })
        if (messages.length > 0) break
      }
    }

    return messages
  }

  /**
   * Parse a message element with data-message-author-role
   */
  private parseMessageElement(element: Element): ChatMessage | null {
    return parseAuthorRoleElement(element, {
      extractContent: contentElement => this.extractMessageContent(contentElement),
      getTimestamp: el =>
        deepSeekTimestamp(
          el.querySelector('time[datetime]')?.getAttribute('datetime') ||
            el.getAttribute('data-timestamp') ||
            el.getAttribute('data-created-at')
        )
    })
  }

  /**
   * Determine role from CSS class name
   */
  private determineRoleFromClass(element: Element): ChatMessage['role'] | null {
    return detectRoleFromClassName(element, ['assistant', 'bot', 'ai'])
  }

  /**
   * Parse a generic message container
   */
  private parseGenericMessage(element: Element): ChatMessage | null {
    const role = this.determineRoleFromElement(element)
    if (!role) return null

    const content = this.extractMessageContent(element)
    if (!content.trim()) return null

    return {
      id: generateId(),
      role,
      content
    }
  }

  /**
   * Determine role from element by checking indicators
   */
  private determineRoleFromElement(element: Element): ChatMessage['role'] | null {
    return detectRoleFromIndicators(element, {
      assistantIndicatorSelector:
        '[class*="assistant"], [data-role="assistant"], [class*="bot"], [class*="ai"]',
      assistantAriaTerms: ['assistant', 'ai', 'deepseek']
    })
  }

  /**
   * Extract clean content from a message element
   */
  private extractMessageContent(element: Element): string {
    return extractCleanMessageText(element)
  }

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
        'nav a[href*="/chat/"]',
        'aside a[href*="/chat/"]',
        '[class*="sidebar"] a[href*="/chat/"]',
        '[class*="nav"] a[href*="/chat/"]',
        'a[href*="/a/chat/s/"]',
        'a[href*="/chat/"]'
      ],
      platform: 'deepseek',
      resolveId: href =>
        (href.match(/\/a\/chat\/s\/([A-Za-z0-9_-]+)/) ||
          href.match(/\/chat\/([A-Za-z0-9_-]+)/))?.[1]
    })
  }
}

// Create parser instance
const parser = new DeepSeekParser()

// Export for content script
export const config = {
  matches: ['https://deepseek.com/*', 'https://chat.deepseek.com/*']
}

// Observed-DOM snapshot: the labelled fallback offered when the provider
// API cannot verify the transcript, so the user is never left with only an error.
const domSnapshot = createDomSnapshotSupport(
  parser,
  '[data-message-author-role], [class*="ds-message"], [class*="message-user"], [class*="message-assistant"]'
)

// Register the shared popup-message handler (see src/providers/parser-runtime.ts)
registerParserMessageHandler({
  platform: 'deepseek',
  parser,
  getSnapshotContext: domSnapshot.getSnapshotContext,
  capturePageSnapshot: domSnapshot.capturePageSnapshot,
  extractConversationId: url =>
    (url.match(/\/a\/chat\/s\/([A-Za-z0-9_-]+)/) || url.match(/\/chat\/([A-Za-z0-9_-]+)/))?.[1] ??
    null
})

// Run on page load
runParserMain(parser)
