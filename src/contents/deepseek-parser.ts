/**
 * DeepSeek DOM + API Parser Content Script
 * Parses conversations from deepseek.com / chat.deepseek.com
 * - DOM parsing for current conversation page
 * - API-based conversation list fetching (cookie-authenticated)
 */
import type { Conversation, ChatMessage, ConversationListItem } from '../lib/types'
import { createVerificationEvidence, syncSourceCompleteness } from '../lib/verification'
import { generateId, extractTextContent, extractTextWithMedia, extractCodeBlocks, extractImages, cleanText, stripProviderArtifacts } from '../lib/dom-utils'
import { registerParserMessageHandler, runParserMain } from '../lib/parser-runtime'
import { extractApiMessageText, getApiMessageRecords, normalizeApiMessageRole } from '../lib/api-message-normalizer'
import { isProviderRateLimitError, isRateLimitedResponse, ProviderRateLimitError } from '../lib/provider-rate-limit'

function deepSeekTimestamp(value: unknown): number | undefined {
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

function deepSeekModelName(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

export interface DeepSeekHistoryPage {
  items: any[]
  nextCursor?: string
  hasMore: boolean
}

interface DeepSeekConversationListMeta extends Record<string, unknown> {
  source: 'api' | 'sidebar'
  complete: boolean
  pagesFetched?: number
}

function unwrapDeepSeekEnvelope(data: any): any {
  let envelope = data
  // Live `/chat_session/fetch_page` wraps rows in { code, data: { biz_data } }.
  for (let depth = 0; depth < 4; depth++) {
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) break
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
export function parseDeepSeekHistoryPage(data: any): DeepSeekHistoryPage {
  const envelope = unwrapDeepSeekEnvelope(data)
  const rawItems = Array.isArray(envelope)
    ? envelope
    : envelope?.chat_sessions || envelope?.items || envelope?.conversations || envelope?.chat_session || envelope?.data || []
  const items = Array.isArray(rawItems) ? rawItems : []
  const nextCursor = [
    envelope?.next_cursor,
    envelope?.nextCursor,
    envelope?.next_page_token,
    envelope?.nextPageToken,
    envelope?.cursor,
    envelope?.lte_cursor,
  ].find(value => typeof value === 'string' && value.length > 0)
  const explicitHasMore = envelope?.has_more ?? envelope?.hasMore ?? envelope?.has_next_page
  return {
    items,
    nextCursor,
    hasMore: typeof explicitHasMore === 'boolean' ? explicitHasMore : Boolean(nextCursor),
  }
}

const DEEPSEEK_VISIBLE_FRAGMENT_TYPES = new Set(['REQUEST', 'RESPONSE', 'ANSWER', 'TEXT'])

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
  'https://chat.deepseek.com/api/v0/chat/history',
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
export class DeepSeekParser {
  platform = 'deepseek' as const
  private authenticationRequired = false
  private conversationListMeta: DeepSeekConversationListMeta = { source: 'sidebar', complete: false }

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
      document.querySelector('[class*="chat-message"], [class*="ds-message"], [data-message-author-role]') ||
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
    // 1. Parse document.title — most reliable
    const pageTitle = document.title
    if (pageTitle) {
      const cleaned = pageTitle.replace(/\s*[-–|]\s*DeepSeek.*$/i, '').trim()
      if (cleaned && cleaned !== 'DeepSeek' && cleaned.length > 0) {
        return cleaned
      }
    }

    // 2. Try first user message as fallback
    const firstUserMsg =
      document.querySelector('[data-message-author-role="user"]') ||
      document.querySelector('[class*="user-message"]') ||
      document.querySelector('[class*="message-user"]')
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
            reasons: ['source_unverified'],
          },
        }),
      })
    } catch (error) {
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
        const candidates = endpoint ? [endpoint] : [...DEEPSEEK_HISTORY_ENDPOINTS]
        for (const base of candidates) {
          response = await fetch(deepSeekHistoryUrl(base, cursor, offset), {
            method: 'GET',
            credentials: 'include',
            headers: { 'Accept': 'application/json' }
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
        for (const item of pageData.items) {
          const id = item?.chat_session_id || item?.id
          if (typeof id !== 'string' || !id || seen.has(id)) continue
          const title = item.title || item.name || 'Untitled Conversation'
          seen.add(id)
          conversations.push({
            id,
            title,
            url: `https://chat.deepseek.com/a/chat/s/${id}`,
            platform: 'deepseek',
            createdAt: deepSeekTimestamp(
              item.created_at ?? item.createdAt ?? item.updated_at ?? item.inserted_at ?? item.create_time
            )
          })
        }

        if (!pageData.hasMore || pageData.items.length === 0) break
        if (pageData.nextCursor) {
          if (seenCursors.has(pageData.nextCursor)) throw new Error('DeepSeek history pagination cursor repeated')
          seenCursors.add(pageData.nextCursor)
          cursor = pageData.nextCursor
        } else {
          const lastId = pageData.items.at(-1)?.chat_session_id || pageData.items.at(-1)?.id
          if (typeof lastId === 'string' && lastId && endpoint?.endsWith('/chat_session/fetch_page')) {
            if (seenCursors.has(lastId)) throw new Error('DeepSeek history pagination cursor repeated')
            seenCursors.add(lastId)
            cursor = lastId
          } else {
            offset += pageData.items.length
            cursor = ''
          }
        }
        if (page === maxPages - 1) throw new Error('DeepSeek history pagination exceeded safe page limit')
      }
    } catch (error) {
      if (isProviderRateLimitError(error)) throw error
      paginationFailed = true
      console.error('[DeepSeek Parser] Error fetching conversations:', error)
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
            'Accept': 'application/json'
          }
        }
      )

      if (isRateLimitedResponse(response)) {
        throw new ProviderRateLimitError()
      }

      if (!response.ok) {
        console.error(`[DeepSeek Parser] Failed to fetch conversation ${id}: ${response.status}`)
        return null
      }

      const data = await response.json()
      const envelope = unwrapDeepSeekEnvelope(data)
      const session = envelope?.chat_session && typeof envelope.chat_session === 'object'
        ? envelope.chat_session
        : envelope
      const items = getApiMessageRecords(data)
      const messages: ChatMessage[] = []

      for (const item of items) {
        const role = normalizeApiMessageRole(item)
        if (role) {
          const content = extractDeepSeekVisibleText(item)
          if (content) {
            messages.push({
              id: typeof item.id === 'string' ? item.id : typeof item.message_id === 'number' ? String(item.message_id) : generateId(),
              role,
              content: stripProviderArtifacts(content).trim(),
              timestamp: deepSeekTimestamp(
                item.inserted_at ?? item.created_at ?? item.createdAt ?? item.create_time ??
                (item.message as any)?.created_at
              )
            })
          }
        }
      }

      return syncSourceCompleteness({
        id,
        title: session?.title || session?.name || data.title || this.getConversationTitle(),
        url: `https://chat.deepseek.com/a/chat/s/${id}`,
        messages,
        createdAt: deepSeekTimestamp(
          session?.inserted_at ?? session?.created_at ?? session?.createdAt ?? session?.create_time ??
          data.created_at ?? data.createdAt ?? data.create_time
        ),
        modelName: deepSeekModelName(
          session?.model_type, session?.model, session?.model_name, session?.modelName, session?.model_slug,
          data.model, data.model_name, data.modelName, data.model_slug
        ),
        platform: 'deepseek',
        source: 'api',
        sourceCompleteness: 'verified',
        verification: createVerificationEvidence({
          provider: 'deepseek',
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
      console.error(`[DeepSeek Parser] Error fetching conversation detail:`, error)
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
    const messages: ChatMessage[] = []
    const seenElements = new Set<Element>()

    // Try data-message-author-role first (if DeepSeek uses it)
    const messageElements = document.querySelectorAll('[data-message-author-role]')

    if (messageElements.length > 0) {
      messageElements.forEach(element => {
        if (seenElements.has(element)) return
        seenElements.add(element)
        const message = this.parseMessageElement(element)
        if (message) {
          messages.push(message)
        }
      })
    } else {
      // Fallback: query user and assistant candidates together. Running one
      // selector at a time used to stop after the first user node and silently
      // drop every assistant response. querySelectorAll preserves DOM order.
      const classCandidates = Array.from(document.querySelectorAll(
        '[class*="message-user"], [class*="message-assistant"], ' +
        '[class*="ds-message"], [class*="chat-message"], [class*="turn"]'
      ))
      classCandidates.forEach(element => {
        if (seenElements.has(element)) return
        // Do not parse a generic wrapper when it contains a more specific
        // role-bearing candidate; that would duplicate the transcript.
        const specificChild = element.querySelector(
          '[class*="message-user"], [class*="message-assistant"]'
        )
        if (specificChild && !element.matches('[class*="message-user"], [class*="message-assistant"]')) return
        seenElements.add(element)
        const role = this.determineRoleFromElement(element) || this.determineRoleFromClass(element)
        if (!role) return
        const content = this.extractMessageContent(element)
        if (!content.trim()) return
        messages.push({
          id: element.getAttribute('data-message-id') || generateId(),
          role,
          content,
        })
      })

      // Final fallback: look for generic message containers
      if (messages.length === 0) {
        const genericSelectors = [
          '[class*="message"]',
          '[class*="msg"]',
          '[class*="turn"]'
        ]

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
    }

    return messages
  }

  /**
   * Parse a message element with data-message-author-role
   */
  private parseMessageElement(element: Element): ChatMessage | null {
    const role = element.getAttribute('data-message-author-role') as ChatMessage['role']
    if (!role || (role !== 'user' && role !== 'assistant')) {
      return null
    }

    const contentElement = element.querySelector(
      '.markdown, [class*="markdown"], [class*="content"]'
    ) || element

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

    const messageId = element.getAttribute('data-message-id') || generateId()

    return {
      id: messageId,
      role,
      content,
      attachments: attachments.length > 0 ? attachments : undefined,
      codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
      timestamp: deepSeekTimestamp(
        element.querySelector('time[datetime]')?.getAttribute('datetime')
          || element.getAttribute('data-timestamp')
          || element.getAttribute('data-created-at')
      )
    }
  }

  /**
   * Determine role from CSS class name
   */
  private determineRoleFromClass(element: Element): ChatMessage['role'] | null {
    const className = element.className || ''
    if (typeof className === 'string') {
      if (className.includes('user')) return 'user'
      if (className.includes('assistant') || className.includes('bot') || className.includes('ai')) return 'assistant'
    }
    return null
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
      content,
    }
  }

  /**
   * Determine role from element by checking indicators
   */
  private determineRoleFromElement(element: Element): ChatMessage['role'] | null {
    const hasUserIndicator = element.querySelector(
      '[class*="user"], [data-role="user"]'
    )
    const hasAssistantIndicator = element.querySelector(
      '[class*="assistant"], [data-role="assistant"], [class*="bot"], [class*="ai"]'
    )

    if (hasUserIndicator) return 'user'
    if (hasAssistantIndicator) return 'assistant'

    const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || ''
    if (ariaLabel.includes('user') || ariaLabel.includes('you')) return 'user'
    if (ariaLabel.includes('assistant') || ariaLabel.includes('ai') || ariaLabel.includes('deepseek')) return 'assistant'

    return null
  }

  /**
   * Extract clean content from a message element
   */
  private extractMessageContent(element: Element): string {
    const clone = element.cloneNode(true) as Element

    const removeSelectors = [
      'button',
      '[class*="toolbar"]',
      '[class*="action"]',
      '[class*="copy"]',
      '[class*="edit"]',
      '[class*="regenerate"]'
    ]

    removeSelectors.forEach(selector => {
      clone.querySelectorAll(selector).forEach(el => el.remove())
    })

    return cleanText(extractTextWithMedia(clone))
  }

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
      'nav a[href*="/chat/"]',
      'aside a[href*="/chat/"]',
      '[class*="sidebar"] a[href*="/chat/"]',
      '[class*="nav"] a[href*="/chat/"]',
      'a[href*="/a/chat/s/"]',
      'a[href*="/chat/"]'
    ]

    for (const selector of selectors) {
      const links = document.querySelectorAll(selector)

      links.forEach(link => {
        const href = link.getAttribute('href')
        if (!href) return

        const match = href.match(/\/a\/chat\/s\/([A-Za-z0-9_-]+)/) || href.match(/\/chat\/([A-Za-z0-9_-]+)/)
        if (!match) return

        const id = match[1]
        if (seen.has(id)) return

        const title = extractTextContent(link) || 'Untitled Conversation'

        seen.add(id)
        conversations.push({
          id,
          title,
          url: new URL(href, window.location.origin).href,
          platform: 'deepseek'
        })
      })

      if (conversations.length > 0) break
    }

    return conversations
  }
}

// Create parser instance
const parser = new DeepSeekParser()

// Export for content script
export const config = {
  matches: ['https://deepseek.com/*', 'https://chat.deepseek.com/*']
}

// Register the shared popup-message handler (see src/lib/parser-runtime.ts)
registerParserMessageHandler({
  platform: 'deepseek',
  parser,
  extractConversationId: url =>
    (url.match(/\/a\/chat\/s\/([A-Za-z0-9_-]+)/) || url.match(/\/chat\/([A-Za-z0-9_-]+)/))?.[1] ?? null
})

// Run on page load
runParserMain(parser)
