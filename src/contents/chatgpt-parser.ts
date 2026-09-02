/**
 * ChatGPT DOM Parser Content Script
 * Parses conversations from chatgpt.com using DOM reading and API-based conversation list
 */
import type { Conversation, ChatMessage, ConversationListItem, Attachment, MessageReference, MessageReferenceType } from '../lib/types'
import { createVerificationEvidence, syncSourceCompleteness } from '../lib/verification'
import { generateId, extractTextContent, extractTextWithMedia, extractCodeBlocks, extractImages, cleanText, stripProviderArtifacts } from '../lib/dom-utils'
import { dedupeMessageReferences, isPrivateReferenceUrl, normalizeReferenceTitle, sanitizeReferenceUrl } from '../lib/message-references'
import { registerParserMessageHandler, runParserMain } from '../lib/parser-runtime'
import { isProviderRateLimitError, isRateLimitedResponse, ProviderRateLimitError } from '../lib/provider-rate-limit'

function chatGptTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // ChatGPT's API uses Unix seconds; tolerate millisecond payloads from
    // newer endpoints as well.
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

function chatGptModelName(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

const CHATGPT_CANONICAL_ORIGIN = 'https://chatgpt.com'
const CHATGPT_ALLOWED_ORIGINS = new Set([
  CHATGPT_CANONICAL_ORIGIN,
  'https://chat.openai.com'
])

export type ChatGptBranchIssue =
  | 'current_node_missing'
  | 'leaf_missing'
  | 'missing_parent'
  | 'cycle'
  | 'no_resolvable_leaf'
  | 'not_leaf'

export interface ChatGptBranchResolution {
  nodes: any[]
  complete: boolean
  leafId?: string
  issue?: ChatGptBranchIssue
}

interface ChatGptConversationListMeta extends Record<string, unknown> {
  source: 'api' | 'sidebar'
  complete: boolean
  pagesFetched?: number
}

/**
 * Resolve ChatGPT's selected root-to-leaf branch and prove that its parent
 * chain reaches a real root. A plausible-looking partial chain is not enough:
 * missing parents and cycles must remain visible to the export safety gate.
 */
export function resolveChatGptActiveBranch(
  nodeMap: Record<string, any>,
  currentNodeId: unknown
): ChatGptBranchResolution {
  const buildChain = (leafId: string): ChatGptBranchResolution => {
    const nodes: any[] = []
    const visited = new Set<string>()
    let nodeId = leafId

    while (nodeId) {
      if (visited.has(nodeId)) {
        return { nodes, complete: false, leafId, issue: 'cycle' }
      }
      visited.add(nodeId)

      const node = nodeMap[nodeId]
      if (!node || typeof node !== 'object') {
        return { nodes, complete: false, leafId, issue: 'missing_parent' }
      }

      nodes.unshift(node)
      if (node.parent === null) {
        const children = Array.isArray(nodeMap[leafId]?.children)
          ? nodeMap[leafId].children.filter((child: unknown) => typeof child === 'string' && child)
          : []
        if (children.length > 0) {
          return { nodes, complete: false, leafId, issue: 'not_leaf' }
        }
        return { nodes, complete: true, leafId }
      }
      if (typeof node.parent !== 'string' || !node.parent) {
        return { nodes, complete: false, leafId, issue: 'missing_parent' }
      }
      nodeId = node.parent
    }

    return { nodes, complete: false, leafId, issue: 'missing_parent' }
  }

  if (typeof currentNodeId === 'string' && currentNodeId) {
    if (!nodeMap[currentNodeId]) {
      return { nodes: [], complete: false, leafId: currentNodeId, issue: 'leaf_missing' }
    }
    return buildChain(currentNodeId)
  }

  // Preserve the legacy best-effort transcript for diagnostics, but never
  // certify it: without current_node there is no authoritative branch choice.
  const parentIds = new Set(
    Object.values(nodeMap)
      .map(node => typeof node?.parent === 'string' ? node.parent : null)
      .filter((id): id is string => Boolean(id))
  )
  const fallbackLeafId = Object.entries(nodeMap)
    .filter(([id]) => !parentIds.has(id))
    .sort(([, left], [, right]) => {
      const leftTime = Number(left?.message?.create_time) || 0
      const rightTime = Number(right?.message?.create_time) || 0
      return rightTime - leftTime
    })
    .at(0)?.[0]

  if (!fallbackLeafId) {
    return { nodes: [], complete: false, issue: 'no_resolvable_leaf' }
  }

  const fallback = buildChain(fallbackLeafId)
  return fallback.complete
    ? { ...fallback, complete: false, issue: 'current_node_missing' }
    : fallback
}

function resolveChatGptOrigin(currentOrigin: unknown): string {
  return typeof currentOrigin === 'string' && CHATGPT_ALLOWED_ORIGINS.has(currentOrigin)
    ? currentOrigin
    : CHATGPT_CANONICAL_ORIGIN
}

/**
 * ChatGPT parser implementation
 */
export class ChatGPTParser {
  platform = 'chatgpt' as const
  private accessToken: string | null = null
  private authenticationRequired = false
  private conversationListMeta: ChatGptConversationListMeta = { source: 'sidebar', complete: false }
  private readonly apiOrigin: string
  private readonly legacyTokenCleanup: Promise<void>

  constructor(currentOrigin: unknown = typeof window !== 'undefined' ? window.location.origin : undefined) {
    this.apiOrigin = resolveChatGptOrigin(currentOrigin)
    this.legacyTokenCleanup = this.removeLegacyStoredToken()
  }

  /** Safe aggregate signal for the scheduled-export status surface. */
  isAuthenticationRequired(): boolean {
    return this.authenticationRequired
  }

  getConversationListMeta(): ChatGptConversationListMeta {
    return { ...this.conversationListMeta }
  }

  /** Remove tokens written by older releases without ever reading them back. */
  private async removeLegacyStoredToken(): Promise<void> {
    try {
      await chrome.storage.local.remove('chatGPTAccessToken')
    } catch {
      // Cleanup is best-effort; auth still proceeds with memory-only state.
    }
  }
  
  /**
   * Check if current page is a ChatGPT conversation
   */
  isConversationPage(): boolean {
    return !!(
      document.querySelector('[data-message-author-role]') ||
      document.querySelector('article') ||
      document.querySelector('[class*="conversation"]')
    )
  }
  
  /**
   * Get the conversation title from the page
   * Strategy:
   * 1. Parse document.title (most reliable: "Conversation Title - ChatGPT")
   * 2. Try sidebar link matching the current URL
   * 3. Fall back to first user message
   * 4. Last resort: "Untitled Conversation"
   */
  getConversationTitle(): string {
    // 1. Parse document.title — most reliable for ChatGPT
    const pageTitle = document.title
    if (pageTitle) {
      // ChatGPT formats titles as "Conversation Title - ChatGPT"
      const cleaned = pageTitle.replace(/\s*[-–|]\s*ChatGPT.*$/i, '').trim()
      if (cleaned && cleaned !== 'ChatGPT' && cleaned.length > 0) {
        return cleaned
      }
    }

    // 2. Try to find the title in the sidebar link matching current conversation URL
    const currentPath = window.location.pathname
    const match = currentPath.match(/\/c\/([a-f0-9-]+)/)
    if (match) {
      const convId = match[1]
      const sidebarLinks = document.querySelectorAll('a[href*="/c/"]')
      for (const link of sidebarLinks) {
        const href = link.getAttribute('href') || ''
        if (href.includes(convId)) {
          const text = extractTextContent(link)
          if (text && text !== 'ChatGPT' && text.length > 0) {
            return text
          }
        }
      }
    }

    // 3. Try first user message as fallback
    const firstUserMsg = document.querySelector('[data-message-author-role="user"]')
    if (firstUserMsg) {
      const text = extractTextContent(firstUserMsg)
      if (text && text.length > 0) {
        // Truncate to reasonable length for a title
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
      
      // Extract real conversation ID from URL (e.g., /c/abc-123-def)
      const urlMatch = window.location.pathname.match(/\/c\/([a-f0-9-]+)/)
      const conversationId = urlMatch?.[1] || generateId()

      return syncSourceCompleteness({
        id: conversationId,
        title: this.getConversationTitle(),
        url: window.location.href,
        messages,
        createdAt: this.extractCreatedAt(),
        platform: 'chatgpt',
        modelName: chatGptModelName(
          document.body.getAttribute('data-model'),
          document.querySelector('[data-model]')?.getAttribute('data-model')
        ),
        source: 'dom',
        sourceCompleteness: 'unverified',
        verification: createVerificationEvidence({
          provider: 'chatgpt',
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
   * Get a ChatGPT access token by calling the session endpoint.
   * Keeps the token only in this parser instance's memory.
   */
  private async getAccessToken(): Promise<string> {
    await this.legacyTokenCleanup
    if (this.accessToken) return this.accessToken

    const response = await fetch(`${this.apiOrigin}/api/auth/session`, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    })
    if (isRateLimitedResponse(response)) throw new ProviderRateLimitError()
    if (response.status === 401 || response.status === 403) {
      this.authenticationRequired = true
      throw new Error('Authentication required')
    }
    const data = await response.json()
    if (typeof data.accessToken !== 'string' || !data.accessToken) {
      throw new Error('No access token in response')
    }

    this.accessToken = data.accessToken
    this.authenticationRequired = false
    return this.accessToken
  }

  /**
   * Clear cached access token (call on 401)
   */
  private async resetAccessToken(): Promise<void> {
    this.accessToken = null
  }

  /**
   * Fetch ALL conversations via the ChatGPT API (same API the browser uses when scrolling the sidebar).
   * This gets far more conversations than the DOM-only approach.
   */
  async fetchAllConversations(): Promise<ConversationListItem[]> {
    const conversations: ConversationListItem[] = []
    this.conversationListMeta = { source: 'sidebar', complete: false }
    let offset = 0
    const limit = 100
    const maxPages = 200
    let hasMore = true
    let pagesFetched = 0
    let paginationComplete = false
    let paginationFailed = false
    let retries = 0
    const maxRetries = 1

    // Get access token for Authorization header
    let token = await this.getAccessToken()

    while (hasMore && pagesFetched < maxPages) {
      try {
        const response = await fetch(
          `${this.apiOrigin}/backend-api/conversations?offset=${offset}&limit=${limit}&order=updated`,
          {
            credentials: 'include',
            headers: {
              'Accept': 'application/json',
              'Authorization': 'Bearer ' + token,
              'oai-language': 'en-US',
              'sec-fetch-dest': 'empty',
              'sec-fetch-mode': 'cors',
              'sec-fetch-site': 'same-origin',
            }
          }
        )

        if (response.status === 401) {
          // Token expired — reset and get a new one, retry
          if (retries < maxRetries) {
            retries++
            await this.resetAccessToken()
            token = await this.getAccessToken()
            continue
          }
          this.authenticationRequired = true
          console.error('[ChatGPT Parser] Authentication expired')
          paginationFailed = true
          break
        }

        if (isRateLimitedResponse(response)) {
          throw new ProviderRateLimitError()
        }

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) this.authenticationRequired = true
          console.error(`[ChatGPT Parser] API error: ${response.status}`)
          paginationFailed = true
          break
        }

        const data = await response.json()
        const items = data.items || data.conversations || []
        pagesFetched += 1

        if (items.length === 0) {
          hasMore = false
          paginationComplete = true
          break
        }

        for (const item of items) {
          conversations.push({
            id: item.id,
            title: item.title || 'Untitled Conversation',
            url: `${this.apiOrigin}/c/${item.id}`,
            platform: 'chatgpt',
            messageCount: item.message_count || item.messageCount || undefined,
            createdAt: chatGptTimestamp(item.create_time)
          })
        }

        offset += limit

        // If we got fewer items than the limit, we've reached the end
        if (items.length < limit) {
          hasMore = false
          paginationComplete = true
        }
      } catch (error) {
        if (isProviderRateLimitError(error)) throw error
        console.error('[ChatGPT Parser] Error fetching conversations:', error)
        paginationFailed = true
        break
      }
    }

    if (paginationFailed || !paginationComplete) {
      return this.getConversationList()
    }

    this.conversationListMeta = { source: 'api', complete: true, pagesFetched }
    return conversations
  }

  /**
   * Fetch full conversation detail from the ChatGPT API.
   * Returns a complete Conversation object with messages.
   */
  async fetchConversationDetail(id: string): Promise<Conversation | null> {
    try {
      let token = await this.getAccessToken()
      let data: any | null = null

      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await fetch(
          `${this.apiOrigin}/backend-api/conversation/${encodeURIComponent(id)}`,
          {
            credentials: 'include',
            headers: {
              'Accept': 'application/json',
              'Authorization': 'Bearer ' + token,
              'oai-language': 'en-US',
              'sec-fetch-dest': 'empty',
              'sec-fetch-mode': 'cors',
              'sec-fetch-site': 'same-origin',
            }
          }
        )

        if (response.status === 401 && attempt === 0) {
          await this.resetAccessToken()
          token = await this.getAccessToken()
          continue
        }

        if (isRateLimitedResponse(response)) {
          throw new ProviderRateLimitError()
        }

        if (!response.ok) {
          // Do not log the conversation ID: it is a private identifier.
          console.error(`[ChatGPT Parser] Failed to fetch conversation: ${response.status}`)
          return null
        }

        data = await response.json()
        break
      }

      if (!data) return null
      const messages: ChatMessage[] = []
      let sourceCompleteness: Conversation['sourceCompleteness'] = 'unverified'
      let verification = createVerificationEvidence({
        provider: 'chatgpt',
        source: 'api',
        transcript: {
          verified: false,
          method: 'active-branch-root-chain',
          reasons: ['source_unverified'],
        },
      })
      let modelName = chatGptModelName(
        data.default_model_slug,
        data.model_slug,
        data.model,
        data.metadata?.model_slug,
        data.metadata?.default_model_slug
      )

      // ChatGPT API returns a tree of messages with mapping
      if (data.mapping && typeof data.mapping === 'object') {
        const nodeMap: Record<string, any> = data.mapping
        // A conversation mapping contains every edited/regenerated branch.
        // Only its current_node is the path the user is actually viewing.
        const branch = resolveChatGptActiveBranch(nodeMap, data.current_node)
        sourceCompleteness = branch.complete ? 'verified' : 'unverified'
        verification = createVerificationEvidence({
          provider: 'chatgpt',
          source: 'api',
          transcript: {
            verified: branch.complete,
            method: 'active-branch-root-chain',
            reasons: [
              branch.issue || (branch.complete ? 'active_branch_root_chain' : 'active_branch_incomplete'),
            ],
          },
        })
        for (const node of branch.nodes) {
          if (node.message) {
            const msg = node.message
            const role = msg.author?.role
            // ChatGPT stores internal progress/status updates in the mapping as
            // assistant text, but explicitly hides them from the conversation
            // UI. Export the user-visible transcript, not those private worker
            // checkpoints.
            if (msg.metadata?.is_visually_hidden_from_conversation) continue
            if (role === 'user' || role === 'assistant') {
              const { text: rawContent, attachments: partAttachments } = this.extractParts(msg.content?.parts, role)
              const { content, references } = this.extractChatGptContentReferences(
                rawContent,
                msg.metadata?.content_references ?? msg.metadata?.citations
              )
              if (content.trim() || partAttachments.length > 0) {
                modelName ||= chatGptModelName(
                  msg.metadata?.model_slug,
                  msg.metadata?.default_model_slug,
                  msg.model_slug,
                  msg.model
                )
                messages.push({
                  id: msg.id || generateId(),
                  role: role as ChatMessage['role'],
                  content: content.trim(),
                  attachments: partAttachments.length ? partAttachments : undefined,
                  references: references.length ? references : undefined,
                  timestamp: chatGptTimestamp(msg.create_time)
                })
              }
            }
          }
        }
      }

      // Older API payloads may be a flat authoritative transcript. Never use
      // this fallback to hide a broken mapping/current_node tree.
      else if (Array.isArray(data.messages)) {
        sourceCompleteness = 'verified'
        verification = createVerificationEvidence({
          provider: 'chatgpt',
          source: 'api',
          transcript: {
            verified: true,
            method: 'provider-api-complete',
            reasons: ['flat_authoritative_messages'],
          },
        })
        for (const msg of data.messages) {
          const role = msg.author?.role || msg.role
          if (msg.metadata?.is_visually_hidden_from_conversation) continue
          if (role === 'user' || role === 'assistant') {
            const { text: rawContent, attachments: partAttachments } = this.extractParts(msg.content?.parts, role)
            const { content, references } = this.extractChatGptContentReferences(
              rawContent,
              msg.metadata?.content_references ?? msg.metadata?.citations
            )
            if (content.trim() || partAttachments.length > 0) {
              modelName ||= chatGptModelName(
                msg.metadata?.model_slug,
                msg.metadata?.default_model_slug,
                msg.model_slug,
                msg.model
              )
              messages.push({
                id: msg.id || generateId(),
                role: role as ChatMessage['role'],
                content: content.trim(),
                attachments: partAttachments.length ? partAttachments : undefined,
                references: references.length ? references : undefined,
                timestamp: chatGptTimestamp(msg.create_time)
              })
            }
          }
        }
      }

      return syncSourceCompleteness({
        id: data.id || id,
        title: data.title || this.getConversationTitle(),
        url: `${this.apiOrigin}/c/${id}`,
        messages,
        createdAt: chatGptTimestamp(data.create_time),
        modelName,
        platform: 'chatgpt',
        source: 'api',
        sourceCompleteness,
        verification,
      })
    } catch (error) {
      if (isProviderRateLimitError(error)) throw error
      console.error(`[ChatGPT Parser] Error fetching conversation detail:`, error)
      return null
    }
  }

  /**
   * Extract all messages from the conversation
   * Uses deduplication to avoid counting the same message twice
   */
  private extractMessages(): ChatMessage[] {
    const messages: ChatMessage[] = []
    const seenElements = new Set<Element>()
    
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
      // Fallback: try article elements only if no data-message-author-role found
      const articles = document.querySelectorAll('article')
      articles.forEach(article => {
        if (seenElements.has(article)) return
        seenElements.add(article)
        const message = this.parseArticleElement(article)
        if (message) {
          messages.push(message)
        }
      })
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
      timestamp: this.extractMessageTimestamp(element)
    }
  }
  
  /**
   * Parse an article element (fallback)
   */
  private parseArticleElement(element: Element): ChatMessage | null {
    const role = this.determineRoleFromArticle(element)
    if (!role) return null
    
    const content = this.extractMessageContent(element)
    if (!content.trim()) return null
    
    const codeBlocks = extractCodeBlocks(element)
    const imageData = extractImages(element)
    const attachments = imageData.map(img => ({
      type: 'image' as const,
      url: img.url,
      name: img.alt,
      uploaded: role === 'user'
    }))
    
    return {
      id: generateId(),
      role,
      content,
      attachments: attachments.length > 0 ? attachments : undefined,
      codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
      timestamp: this.extractMessageTimestamp(element)
    }
  }
  
  /**
   * Determine the role of a message from an article element
   */
  private determineRoleFromArticle(element: Element): ChatMessage['role'] | null {
    const hasUserIndicator = element.querySelector(
      '[class*="user"], [data-role="user"]'
    )
    const hasAssistantIndicator = element.querySelector(
      '[class*="assistant"], [data-role="assistant"], [class*="bot"]'
    )
    
    if (hasUserIndicator) return 'user'
    if (hasAssistantIndicator) return 'assistant'
    
    const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || ''
    if (ariaLabel.includes('user') || ariaLabel.includes('you')) return 'user'
    if (ariaLabel.includes('assistant') || ariaLabel.includes('ai')) return 'assistant'
    
    const hasUserAvatar = element.querySelector('[class*="avatar-user"]')
    const hasAssistantAvatar = element.querySelector('[class*="avatar-assistant"], [class*="logo"]')
    
    if (hasUserAvatar) return 'user'
    if (hasAssistantAvatar) return 'assistant'
    
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
    
    // Preserve DOM image nodes as Markdown at their original position. The
    // previous text-only walker made every rendered image look like a trailing
    // attachment once the shared exporter received it.
    return cleanText(extractTextWithMedia(clone))
  }
  
  /** Extract provider-neutral references while removing ChatGPT UI-only tokens. */
  private extractChatGptContentReferences(
    content: string,
    values: unknown
  ): { content: string; references: MessageReference[] } {
    const references: MessageReference[] = []
    if (Array.isArray(values)) {
      for (const value of values) {
        if (!value || typeof value !== 'object') continue
        const raw = value as Record<string, unknown>
        const rawType = typeof raw.type === 'string' ? raw.type.toLowerCase() : ''
        const marker = typeof raw.matched_text === 'string' ? raw.matched_text : ''
        if (raw.invalid === true || rawType === 'hidden' || marker.includes('memcite')) continue

        const type: MessageReferenceType = rawType === 'file' || rawType === 'file_citation'
          ? 'file'
          : rawType === 'web' || rawType === 'webpage' || rawType === 'sources'
            ? 'web'
            : rawType === 'memory'
              ? 'memory'
              : 'unknown'
        if (type === 'memory') continue

        const rawUrl = raw.cloud_doc_url ?? raw.url
        const url = sanitizeReferenceUrl(rawUrl)
        const fallbackTitle = type === 'file' ? 'Source file' : type === 'web' ? 'Web source' : 'Source'
        const title = normalizeReferenceTitle(raw.title ?? raw.name, fallbackTitle)
        const source = typeof raw.attribution === 'string'
          ? normalizeReferenceTitle(raw.attribution, '') || undefined
          : undefined
        const provenance = [
          raw.source,
          raw.api_tool_source,
          raw.plugin,
          raw.connector,
        ].filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
        const connectorPrivate = type === 'unknown'
          || rawType.includes('connector')
          || rawType.includes('plugin')
          || provenance.some(value => /my_files|plugin|connector|files\//i.test(value))
        references.push({
          type,
          title,
          ...(url ? { url } : {}),
          private: !url || isPrivateReferenceUrl(url) || connectorPrivate,
          ...(source ? { source } : {}),
        })
      }
    }

    const cleaned = stripProviderArtifacts(content)
      .replace(/[\uE000-\uF8FF]+(?:filecite|memcite)[\uE000-\uF8FF\w-]*/g, '')
      .replace(/[\uE000-\uF8FF]/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim()
    return { content: cleaned, references: dedupeMessageReferences(references) }
  }

  /**
   * Extract text and attachments from ChatGPT message content parts.
   * ChatGPT API content parts are objects with .text, .type, etc. — not strings.
   */
  private extractParts(
    parts: any[] | undefined,
    role: ChatMessage['role']
  ): { text: string; attachments: Attachment[] } {
    const textParts: string[] = []
    const attachments: Attachment[] = []
    if (!parts || !Array.isArray(parts)) return { text: '', attachments }
    for (const part of parts) {
      if (!part || typeof part !== 'object') {
        if (typeof part === 'string') textParts.push(part)
        continue
      }
      if (typeof part.text === 'string') {
        // Keep provider markers intact until message-level citation metadata can
        // map them into structured references in extractChatGptContentReferences.
        textParts.push(part.text)
      } else if (part.type === 'image_file') {
        const url = (part.file && part.file.url) || part.image_url?.url || ''
        attachments.push({
          type: 'image',
          url,
          name: part.name || 'Image',
          uploaded: role === 'user'
        })
      } else if (part.type === 'file') {
        const url = (part.file && part.file.url) || ''
        attachments.push({
          type: 'file',
          url,
          name: part.name || 'Uploaded file',
          uploaded: role === 'user'
        })
      } else if (part.type === 'image_url' && part.image_url && part.image_url.url) {
        attachments.push({
          type: 'image',
          url: part.image_url.url,
          name: 'Image',
          uploaded: role === 'user'
        })
      }
    }
    return { text: textParts.join('\n').trim(), attachments }
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

  private extractMessageTimestamp(element: Element): number | undefined {
    const timeValue = element.querySelector('time[datetime]')?.getAttribute('datetime')
    const attributeValue = element.getAttribute('data-timestamp')
      || element.getAttribute('data-created-at')
      || element.getAttribute('data-create-time')
    return chatGptTimestamp(timeValue || attributeValue)
  }
  
  /**
   * Get list of conversations from the sidebar (DOM-based, limited to visible items)
   */
  getConversationList(): ConversationListItem[] {
    const conversations: ConversationListItem[] = []
    const seen = new Set<string>()
    
    const selectors = [
      'nav a[href*="/c/"]',
      'aside a[href*="/c/"]',
      '[class*="sidebar"] a[href*="/c/"]',
      '[class*="nav"] a[href*="/c/"]',
      'a[href^="/c/"]'
    ]
    
    for (const selector of selectors) {
      const links = document.querySelectorAll(selector)
      
      links.forEach(link => {
        const href = link.getAttribute('href')
        if (!href) return
        
        const match = href.match(/\/c\/([a-f0-9-]+)/)
        if (!match) return
        
        const id = match[1]
        if (seen.has(id)) return
        
        const title = extractTextContent(link) || 'Untitled Conversation'
        
        seen.add(id)
        conversations.push({
          id,
          title,
          url: new URL(href, window.location.origin).href,
          platform: 'chatgpt'
        })
      })
      
      if (conversations.length > 0) break
    }
    
    return conversations
  }
}

// Create parser instance
const parser = new ChatGPTParser()

// Export for content script
export const config = {
  matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*']
}

// Register the shared popup-message handler (see src/lib/parser-runtime.ts)
registerParserMessageHandler({
  platform: 'chatgpt',
  parser,
  extractConversationId: url => url.match(/\/c\/([a-f0-9-]+)/)?.[1] ?? null,
  requireApiDetailForCurrentExport: true,
  preferApiDetailWhenComplete: true,
  apiDetailUnavailableError:
    'ChatGPT did not return a verifiably complete active branch. Export was stopped instead of saving a potentially truncated page snapshot. Reload ChatGPT and try again.'
})

// Run on page load
runParserMain(parser)
