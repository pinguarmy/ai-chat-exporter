/**
 * DeepSeek DOM + API Parser Content Script
 * Parses conversations from deepseek.com / chat.deepseek.com
 * - DOM parsing for current conversation page
 * - API-based conversation list fetching (cookie-authenticated)
 */
import type { Conversation, ChatMessage, PlatformParser, ConversationListItem } from '../lib/types'
import { generateId, extractTextContent, extractCodeBlocks, extractImages, cleanText } from '../lib/dom-utils'
import { preferMoreCompleteConversation } from '../lib/parser-fallback'
import { extractApiMessageText, getApiMessageRecords, normalizeApiMessageRole } from '../lib/api-message-normalizer'

/**
 * DeepSeek parser implementation
 */
class DeepSeekParser implements PlatformParser {
  platform = 'deepseek' as const

  /**
   * Check if current page is a DeepSeek conversation
   */
  isConversationPage(): boolean {
    return !!(
      document.querySelector('[class*="chat-message"], [class*="ds-message"], [data-message-author-role]') ||
      document.querySelector('[data-message-author-role]') ||
      window.location.pathname.match(/\/a\/chat\/s\/[a-f0-9-]+/) ||
      window.location.pathname.match(/\/chat\/[a-f0-9-]+/)
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

      return {
        id: this.extractConversationId() || generateId(),
        title: this.getConversationTitle(),
        url: window.location.href,
        messages,
        createdAt: this.extractCreatedAt(),
        platform: 'deepseek'
      }
    } catch (error) {
      return null
    }
  }

  /**
   * Fetch ALL conversations via DeepSeek API
   * DeepSeek uses cookie-based auth, so we can fetch directly with credentials: 'include'
   */
  async fetchAllConversations(): Promise<ConversationListItem[]> {
    const conversations: ConversationListItem[] = []
    const seen = new Set<string>()

    try {
      // Try to fetch conversation history from the sidebar/API
      // DeepSeek may expose an API at /api/v0/chat/history or similar
      const response = await fetch('https://chat.deepseek.com/api/v0/chat/history', {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'application/json'
        }
      })

      if (response.ok) {
        const data = await response.json()
        const items = data.data || data.items || data.conversations || []

        for (const item of items) {
          const id = item.chat_session_id || item.id
          const title = item.title || item.name || 'Untitled Conversation'
          if (!seen.has(id)) {
            seen.add(id)
            conversations.push({
              id,
              title,
              url: `https://chat.deepseek.com/a/chat/s/${id}`,
              platform: 'deepseek',
              createdAt: item.created_at ? new Date(item.created_at).getTime() : undefined
            })
          }
        }
      }
    } catch (error) {
      console.error('[DeepSeek Parser] Error fetching conversations:', error)
    }

    // Fallback to DOM-based sidebar list
    if (conversations.length === 0) {
      return this.getConversationList()
    }

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

      if (!response.ok) {
        console.error(`[DeepSeek Parser] Failed to fetch conversation ${id}: ${response.status}`)
        return null
      }

      const data = await response.json()
      const items = getApiMessageRecords(data)
      const messages: ChatMessage[] = []

      for (const item of items) {
        const role = normalizeApiMessageRole(item)
        if (role) {
          const content = extractApiMessageText(item)
          if (content) {
            messages.push({
              id: typeof item.id === 'string' ? item.id : generateId(),
              role,
              content: cleanText(content)
            })
          }
        }
      }

      return {
        id,
        title: data.title || this.getConversationTitle(),
        url: `https://chat.deepseek.com/a/chat/s/${id}`,
        messages,
        createdAt: data.created_at ? new Date(data.created_at).getTime() : undefined,
        platform: 'deepseek'
      }
    } catch (error) {
      console.error(`[DeepSeek Parser] Error fetching conversation detail:`, error)
      return null
    }
  }

  /**
   * Extract conversation ID from the URL
   */
  private extractConversationId(): string | null {
    const match = window.location.pathname.match(/\/a\/chat\/s\/([a-f0-9-]+)/)
    if (match) return match[1]
    const match2 = window.location.pathname.match(/\/chat\/([a-f0-9-]+)/)
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
      // Fallback: try class-based message containers
      const classSelectors = [
        '[class*="message-user"]',
        '[class*="message-assistant"]',
        '[class*="ds-message"]',
        '[class*="chat-message"]'
      ]

      for (const selector of classSelectors) {
        const elements = document.querySelectorAll(selector)
        elements.forEach(element => {
          if (seenElements.has(element)) return
          seenElements.add(element)
          const role = this.determineRoleFromClass(element)
          if (role) {
            const content = this.extractMessageContent(element)
            if (content.trim()) {
              messages.push({
                id: generateId(),
                role,
                content,
              })
            }
          }
        })
        if (messages.length > 0) break
      }

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
      name: img.alt
    }))

    const messageId = element.getAttribute('data-message-id') || generateId()

    return {
      id: messageId,
      role,
      content,
      attachments: attachments.length > 0 ? attachments : undefined,
      codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined
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

    const contentElement = clone.querySelector(
      '.markdown, [class*="markdown"], [class*="content"], [class*="text"]'
    ) || clone

    const text = extractTextContent(contentElement)
    return cleanText(text)
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

        const match = href.match(/\/a\/chat\/s\/([a-f0-9-]+)/) || href.match(/\/chat\/([a-f0-9-]+)/)
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
      // LaTeX, artifacts, and paragraph structure better than DOM text extraction.
      const url = window.location.href
      const match = url.match(/\/a\/chat\/s\/([a-f0-9-]+)/) || url.match(/\/chat\/([a-f0-9-]+)/)
      if (match) {
        parser.fetchConversationDetail(match[1]).then(apiConv => {
          sendResponse({ data: preferMoreCompleteConversation(conversation, apiConv) })
        }).catch(() => {
          sendResponse({ data: conversation })
        })
      } else {
        sendResponse({ data: conversation })
      }
    }).catch(error => {
      sendResponse({ error: error.message })
    })
    return true // Keep message channel open
  }

  if (message.type === 'DETECT_PLATFORM') {
    sendResponse({
      data: {
        platform: 'deepseek',
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
