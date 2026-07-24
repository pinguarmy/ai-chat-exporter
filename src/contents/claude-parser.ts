/**
 * Claude DOM Parser Content Script
 * Parses conversations from claude.ai using DOM reading and API-based conversation list
 *
 * Authentication Strategy:
 * - Cookie-based: Claude uses session cookies sent with credentials: 'include'
 * - No access token needed — the browser's cookie handles authentication
 * - Org ID is extracted from the page HTML or API responses
 */
import type { Conversation, ChatMessage, PlatformParser, ConversationListItem, ConversationArtifact } from '../lib/types'
import { generateId, extractTextContent, extractCodeBlocks, extractImages, cleanText } from '../lib/dom-utils'
import { preferMoreCompleteConversation } from '../lib/parser-fallback'
import { extractApiMessageText, getApiMessageRecords, normalizeApiMessageRole } from '../lib/api-message-normalizer'
import { inferClaudeArtifactType } from '../lib/claude-artifact'

/** UUID regex for matching conversation IDs and org IDs */
const UUID_REGEX = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

/** Regex to extract org ID from API URLs in the page */
const ORG_API_REGEX = /\/api\/organizations\/([a-f0-9-]{36})\/chat_conversations/i

/** Regex to extract org ID from lastActiveOrg cookie or page data */
const LAST_ACTIVE_ORG_REGEX = /lastActiveOrg[^a-f0-9]{0,120}?([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i

/** Regex to extract org ID from analytics/user ID calls */
const USER_ID_REGEX = /"_setUserId",\s*"([a-f0-9-]{36})"/i

/**
 * Extract organization ID from the page.
 * Tries multiple strategies:
 * 1. Find org ID from API URLs in the page HTML
 * 2. Find from lastActiveOrg in page data
 * 3. Find from _setUserId analytics calls
 */
function extractOrgId(): string | null {
  try {
    const html = document.documentElement?.innerHTML || ''

    // Strategy 1: Find org ID from API URLs
    const apiMatch = html.match(ORG_API_REGEX)
    if (apiMatch && apiMatch[1]) {
      return apiMatch[1]
    }

    // Strategy 2: Find from lastActiveOrg pattern
    const lastActiveMatch = html.match(LAST_ACTIVE_ORG_REGEX)
    if (lastActiveMatch && lastActiveMatch[1]) {
      return lastActiveMatch[1]
    }

    // Strategy 3: Find from _setUserId analytics
    const userIdMatch = html.match(USER_ID_REGEX)
    if (userIdMatch && userIdMatch[1]) {
      return userIdMatch[1]
    }
  } catch {
    // HTML not available
  }

  return null
}

/**
 * Claude parser implementation
 */
class ClaudeParser implements PlatformParser {
  platform = 'claude' as const

  /** Cached org ID to avoid re-extracting */
  private cachedOrgId: string | null = null

  /**
   * Check if current page is a Claude conversation
   */
  isConversationPage(): boolean {
    return !!(
      document.querySelector('[data-testid="chat-message"]') ||
      document.querySelector('.font-claude-message') ||
      document.querySelector('[data-testid="user-message"]') ||
      document.querySelector('[data-testid="assistant-message"]') ||
      window.location.pathname.match(/\/chat\/[a-f0-9-]+/)
    )
  }

  /**
   * Get the conversation title from the page
   * Strategy:
   * 1. Parse document.title (most reliable: "Conversation Title | Claude" or "- Claude")
   * 2. Try first user message as fallback
   * 3. Last resort: "Untitled Conversation"
   */
  getConversationTitle(): string {
    // 1. Parse document.title — most reliable for Claude
    const pageTitle = document.title
    if (pageTitle) {
      // Claude formats titles as "Conversation Title | Claude" or "Conversation Title - Claude"
      const cleaned = pageTitle.replace(/\s*[|–-]\s*Claude.*$/i, '').trim()
      if (cleaned && cleaned !== 'Claude' && cleaned.length > 0) {
        return cleaned
      }
    }

    // 2. Try first user message as fallback
    const firstUserMsg = document.querySelector('[data-testid="user-message"]')
    if (firstUserMsg) {
      const text = extractTextContent(firstUserMsg)
      if (text && text.length > 0) {
        return text.length > 80 ? text.substring(0, 80) + '...' : text
      }
    }

    // 3. Fallback: look for any user message by role indicators
    const userMsg = document.querySelector('[class*="user-message"], [data-role="user"]')
    if (userMsg) {
      const text = extractTextContent(userMsg)
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

      // Extract real conversation ID from URL (e.g., /chat/abc-123-def)
      const urlMatch = window.location.pathname.match(/\/chat\/([a-f0-9-]+)/)
      const conversationId = urlMatch?.[1] || generateId()

      return {
        id: conversationId,
        title: this.getConversationTitle(),
        url: window.location.href,
        messages,
        createdAt: this.extractCreatedAt(),
        platform: 'claude'
      }
    } catch (error) {
      return null
    }
  }

  /**
   * Get the organization ID for API calls.
   * Caches the result to avoid re-extraction.
   */
  private async getOrgId(): Promise<string | null> {
    if (this.cachedOrgId && UUID_REGEX.test(this.cachedOrgId)) {
      return this.cachedOrgId
    }

    // Try extracting from page
    const orgId = extractOrgId()
    if (orgId) {
      this.cachedOrgId = orgId
      return orgId
    }

    // Try fetching from session API
    try {
      const response = await fetch('https://claude.ai/api/auth/session', {
        credentials: 'include'
      })
      if (response.ok) {
        const data = await response.json()
        if (data.orgID) {
          this.cachedOrgId = data.orgID
          return data.orgID
        }
        // Some responses have organization details
        if (data.organization?.id) {
          this.cachedOrgId = data.organization.id
          return data.organization.id
        }
      }
    } catch {
      // Session API not available
    }

    return null
  }

  /**
   * Fetch ALL conversations via the Claude API.
   * Uses cookie-based authentication (no access token needed).
   */
  async fetchAllConversations(): Promise<ConversationListItem[]> {
    const conversations: ConversationListItem[] = []
    let offset = 0
    const limit = 100
    let hasMore = true
    let retries = 0
    const maxRetries = 1

    const orgId = await this.getOrgId()
    if (!orgId) {
      console.error('[Claude Parser] Could not determine organization ID')
      return this.getConversationList() // Fall back to DOM
    }

    while (hasMore) {
      try {
        const response = await fetch(
          `https://claude.ai/api/organizations/${orgId}/chat_conversations?limit=${limit}&offset=${offset}`,
          {
            credentials: 'include',
            headers: {
              'Accept': 'application/json',
            }
          }
        )

        if (response.status === 401 || response.status === 403) {
          console.error(`[Claude Parser] Authentication error: ${response.status}`)
          break
        }

        if (!response.ok) {
          console.error(`[Claude Parser] API error: ${response.status}`)
          break
        }

        const data = await response.json()
        const items = data.conversations || data.items || []

        if (items.length === 0) {
          hasMore = false
          break
        }

        for (const item of items) {
          conversations.push({
            id: item.uuid || item.id,
            title: item.name || item.title || 'Untitled Conversation',
            url: `https://claude.ai/chat/${item.uuid || item.id}`,
            platform: 'claude',
            createdAt: item.created_at ? new Date(item.created_at).getTime() : undefined
          })
        }

        offset += limit

        // If we got fewer items than the limit, we've reached the end
        if (items.length < limit) {
          hasMore = false
        }
      } catch (error) {
        console.error('[Claude Parser] Error fetching conversations:', error)
        break
      }
    }

    // If API didn't return results, fall back to DOM
    if (conversations.length === 0) {
      return this.getConversationList()
    }

    return conversations
  }

  /**
   * Fetch full conversation detail from the Claude API.
   * Returns a complete Conversation object with messages.
   */
  async fetchConversationDetail(id: string): Promise<Conversation | null> {
    try {
      const orgId = await this.getOrgId()
      if (!orgId) {
        console.error('[Claude Parser] Could not determine organization ID for detail fetch')
        return null
      }

      const response = await fetch(
        `https://claude.ai/api/organizations/${orgId}/chat_conversations/${id}?tree=True&rendering_mode=messages&render_all_tools=true`,
        {
          credentials: 'include',
          headers: {
            'Accept': 'application/json',
          }
        }
      )

      if (response.status === 401 || response.status === 403) {
        console.error(`[Claude Parser] Auth error for conversation ${id}: ${response.status}`)
        return null
      }

      if (!response.ok) {
        console.error(`[Claude Parser] Failed to fetch conversation ${id}: ${response.status}`)
        return null
      }

      const data = await response.json()
      const messages: ChatMessage[] = []
      const artifacts: ConversationArtifact[] = []

      for (const msg of getApiMessageRecords(data)) {
          const role = normalizeApiMessageRole(msg)
          if (!role) continue

          const content = extractApiMessageText(msg)
          const blocks = Array.isArray(msg.content) ? msg.content : []
          for (const block of blocks) {
            if (!block || typeof block !== 'object') continue
            const typedBlock = block as Record<string, any>
            if (typedBlock.type === 'tool_use' && typedBlock.input?.content) {
              artifacts.push({
                type: inferClaudeArtifactType(typedBlock),
                title: typedBlock.input.title || typedBlock.name || 'Artifact',
                content: typedBlock.input.content,
                language: typedBlock.name,
                mimeType: typedBlock.input.mimeType
              })
            } else if (typedBlock.type === 'document') {
              artifacts.push({
                type: 'document',
                title: typedBlock.title || typedBlock.file_name || 'Uploaded File',
                content: typeof typedBlock.content === 'string' ? typedBlock.content : typedBlock.text || '',
                mimeType: typedBlock.media_type || typedBlock.mime_type
              })
            }
          }

          if (content.trim()) {
            messages.push({
              id: typeof msg.uuid === 'string'
                ? msg.uuid
                : typeof msg.id === 'string'
                  ? msg.id
                  : generateId(),
              role,
              content: cleanText(content.trim()),
            })
          }
      }

      const conversation: Conversation = {
        id: data.uuid || data.id || id,
        title: data.name || data.title || this.getConversationTitle(),
        url: `https://claude.ai/chat/${id}`,
        messages,
        createdAt: data.created_at ? new Date(data.created_at).getTime() : undefined,
        platform: 'claude',
        artifacts: artifacts.length > 0 ? artifacts : undefined
      }

      return conversation
    } catch (error) {
      console.error(`[Claude Parser] Error fetching conversation detail:`, error)
      return null
    }
  }

  /**
   * Extract all messages from the conversation DOM.
   * Uses deduplication to avoid counting the same message twice.
   */
  private extractMessages(): ChatMessage[] {
    const messages: ChatMessage[] = []
    const seenElements = new Set<Element>()

    // Primary: Use data-testid selectors for Claude's DOM structure
    const messageContainers = document.querySelectorAll(
      '[data-testid="chat-message"], [data-testid="user-message"], [data-testid="assistant-message"]'
    )

    if (messageContainers.length > 0) {
      messageContainers.forEach(element => {
        if (seenElements.has(element)) return
        seenElements.add(element)
        const message = this.parseMessageElement(element)
        if (message) {
          messages.push(message)
        }
      })
    } else {
      // Fallback: try font-claude-message class (assistant) and other selectors
      const assistantMessages = document.querySelectorAll('.font-claude-message')
      assistantMessages.forEach(element => {
        if (seenElements.has(element)) return
        seenElements.add(element)
        const content = this.extractMessageContent(element)
        if (content.trim()) {
          messages.push({
            id: generateId(),
            role: 'assistant',
            content: cleanText(content)
          })
        }
      })

      // Also try to find user messages by other indicators
      const userMessages = document.querySelectorAll(
        '[class*="user-message"], [data-role="user"], [class*="human-message"]'
      )
      userMessages.forEach(element => {
        if (seenElements.has(element)) return
        seenElements.add(element)
        const content = this.extractMessageContent(element)
        if (content.trim()) {
          messages.push({
            id: generateId(),
            role: 'user',
            content: cleanText(content)
          })
        }
      })
    }

    return messages
  }

  /**
   * Parse a message element from Claude's DOM.
   * Determines the role from data-testid or other attributes.
   */
  private parseMessageElement(element: Element): ChatMessage | null {
    // Determine role from data-testid
    const testId = element.getAttribute('data-testid')
    let role: ChatMessage['role'] | null = null

    if (testId === 'user-message') {
      role = 'user'
    } else if (testId === 'assistant-message') {
      role = 'assistant'
    } else if (testId === 'chat-message') {
      // For chat-message, check for user/assistant indicators inside
      const hasUserIndicator = element.querySelector('[data-testid="user-message"]') ||
        element.closest('[data-testid="user-message"]')
      const hasAssistantIndicator = element.querySelector('[data-testid="assistant-message"]') ||
        element.querySelector('.font-claude-message')

      if (hasUserIndicator) {
        role = 'user'
      } else if (hasAssistantIndicator) {
        role = 'assistant'
      } else {
        // Try to determine from class names or content
        role = this.determineRoleFromElement(element)
      }
    }

    if (!role) return null

    // Extract content from the message
    const contentElement = element.querySelector(
      '.font-claude-message, [class*="markdown"], [class*="content"]'
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
      name: img.alt
    }))

    const messageId = element.getAttribute('data-message-id') ||
      element.querySelector('[data-message-id]')?.getAttribute('data-message-id') ||
      generateId()

    return {
      id: messageId,
      role,
      content: cleanText(content),
      attachments: attachments.length > 0 ? attachments : undefined,
      codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined
    }
  }

  /**
   * Determine the role of a message from an element's class names and attributes.
   */
  private determineRoleFromElement(element: Element): ChatMessage['role'] | null {
    // Check for user-related classes
    const classList = Array.from(element.classList || [])
    const hasUserClass = classList.some(cls =>
      cls.includes('user') || cls.includes('human') || cls.includes('Human')
    )
    const hasAssistantClass = classList.some(cls =>
      cls.includes('assistant') || cls.includes('claude') || cls.includes('Claude')
    )

    if (hasUserClass) return 'user'
    if (hasAssistantClass) return 'assistant'

    // Check aria-label
    const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || ''
    if (ariaLabel.includes('user') || ariaLabel.includes('human') || ariaLabel.includes('you')) {
      return 'user'
    }
    if (ariaLabel.includes('assistant') || ariaLabel.includes('claude') || ariaLabel.includes('ai')) {
      return 'assistant'
    }

    // Check for role attribute
    const roleAttr = element.getAttribute('role')?.toLowerCase() || ''
    if (roleAttr === 'user' || roleAttr === 'human') return 'user'
    if (roleAttr === 'assistant' || roleAttr === 'ai') return 'assistant'

    return null
  }

  /**
   * Extract clean content from a message element.
   * Removes buttons, toolbars, and other non-content elements.
   */
  private extractMessageContent(element: Element): string {
    const clone = element.cloneNode(true) as Element

    // Remove non-content elements
    const removeSelectors = [
      'button',
      '[class*="toolbar"]',
      '[class*="action"]',
      '[class*="copy"]',
      '[class*="edit"]',
      '[class*="regenerate"]',
      '[class*="feedback"]',
      '[class*="menu"]',
      '[data-testid="copy-button"]',
      '[data-testid="edit-button"]'
    ]

    removeSelectors.forEach(selector => {
      clone.querySelectorAll(selector).forEach(el => el.remove())
    })

    let content = ''

    const walker = document.createTreeWalker(
      clone,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            return NodeFilter.FILTER_ACCEPT
          }
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as Element
            const tag = el.tagName.toLowerCase()
            if (['p', 'span', 'div', 'strong', 'em', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
              return NodeFilter.FILTER_ACCEPT
            }
            return NodeFilter.FILTER_SKIP
          }
          return NodeFilter.FILTER_SKIP
        }
      }
    )

    let node: Node | null
    const textParts: string[] = []

    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.trim()
        if (text) {
          textParts.push(text)
        }
      }
    }

    content = textParts.join(' ')

    return cleanText(content)
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

    // Claude sidebar links typically point to /chat/{uuid}
    const selectors = [
      'nav a[href*="/chat/"]',
      'aside a[href*="/chat/"]',
      '[class*="sidebar"] a[href*="/chat/"]',
      '[class*="nav"] a[href*="/chat/"]',
      'a[href^="/chat/"]'
    ]

    for (const selector of selectors) {
      const links = document.querySelectorAll(selector)

      links.forEach(link => {
        const href = link.getAttribute('href')
        if (!href) return

        const match = href.match(/\/chat\/([a-f0-9-]+)/)
        if (!match) return

        const id = match[1]
        if (seen.has(id)) return

        const title = extractTextContent(link) || 'Untitled Conversation'

        seen.add(id)
        conversations.push({
          id,
          title,
          url: new URL(href, window.location.origin).href,
          platform: 'claude'
        })
      })

      if (conversations.length > 0) break
    }

    return conversations
  }
}

// Create parser instance
const parser = new ClaudeParser()

// Export for content script
export const config = {
  matches: ['https://claude.ai/*']
}

// Main function to run when script loads
async function main() {
  if (parser.isConversationPage()) {
    const conversation = await parser.parseCurrentConversation()
    if (conversation) {
      chrome.storage.local.set({
        [`conversation-${conversation.id}`]: { ...conversation, timestamp: Date.now() }
      })
    }
  }
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'PARSE_CONVERSATION') {
    parser.parseCurrentConversation().then(conversation => {
      // API detail is preferred when available because it preserves markdown,
      // artifacts, attachments, and assistant responses better than DOM text extraction.
      const url = window.location.href
      const match = url.match(/\/chat\/([a-f0-9-]+)/)
      if (match) {
        parser.fetchConversationDetail(match[1]).then(apiConv => {
          sendResponse({ data: preferMoreCompleteConversation(conversation, apiConv) })
        }).catch(err => {
          console.error('[Claude Parser] API fetch error:', err)
          sendResponse({ data: conversation })
        })
      } else {
        sendResponse({ data: conversation })
      }
    }).catch(error => {
      console.error('[Claude Parser] parseCurrentConversation error:', error)
      sendResponse({ error: error.message })
    })
    return true // Keep message channel open
  }

  if (message.type === 'DETECT_PLATFORM') {
    sendResponse({
      data: {
        platform: 'claude',
        isConversationPage: parser.isConversationPage(),
        title: parser.getConversationTitle()
      }
    })
  }

  if (message.type === 'FETCH_CONVERSATION_LIST') {
    try {
      const list = parser.getConversationList()
      sendResponse({ data: list })
    } catch (error) {
      sendResponse({ error: (error as Error).message })
    }
  }

  if (message.type === 'FETCH_ALL_CONVERSATIONS') {
    parser.fetchAllConversations().then(list => {
      sendResponse({ data: list })
    }).catch(error => {
      // Fall back to DOM-based list
      try {
        const fallbackList = parser.getConversationList()
        sendResponse({ data: fallbackList })
      } catch (e) {
        sendResponse({ error: (error as Error).message })
      }
    })
    return true
  }

  if (message.type === 'FETCH_CONVERSATION_DETAIL') {
    parser.fetchConversationDetail(message.data?.id).then(conversation => {
      sendResponse({ data: conversation })
    }).catch(error => {
      sendResponse({ error: error.message })
    })
    return true
  }
})

// Run on page load
main()
