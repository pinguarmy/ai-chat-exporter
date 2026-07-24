/**
 * Grok DOM Parser Content Script
 * Parses conversations from grok.com using DOM reading
 * - Uses data-message-author-role attribute (similar to ChatGPT)
 * - Cookie-based auth for API calls
 */
import type { Conversation, ChatMessage, PlatformParser, ConversationListItem } from '../lib/types'
import { generateId, extractTextContent, extractCodeBlocks, extractImages, cleanText } from '../lib/dom-utils'
import { preferMoreCompleteConversation } from '../lib/parser-fallback'
import { getGrokConversationId } from '../lib/grok-conversation-url'
import { fetchGrokConversationDetail, fetchGrokConversationList } from '../lib/grok-api'

/**
 * Grok parser implementation
 */
class GrokParser implements PlatformParser {
  platform = 'grok' as const

  /**
   * Check if current page is a Grok conversation
   */
  isConversationPage(): boolean {
    return !!(
      document.querySelector('[data-message-author-role], [class*="chat-message"], [class*="message-bubble"]') ||
      getGrokConversationId(window.location.href)
    )
  }

  /**
   * Get the conversation title from the page
   * Strategy:
   * 1. Parse document.title (most reliable: "Grok - Conversation Title" or "Conversation Title")
   * 2. Try first user message as fallback
   * 3. Last resort: "Untitled Conversation"
   */
  getConversationTitle(): string {
    // 1. Parse document.title — most reliable
    const pageTitle = document.title
    if (pageTitle) {
      const cleaned = pageTitle.replace(/\s*[-–|]\s*Grok.*$/i, '').trim()
      if (cleaned && cleaned !== 'Grok' && cleaned.length > 0) {
        return cleaned
      }
    }

    // 2. Try first user message as fallback
    const firstUserMsg = document.querySelector(
      '[data-message-author-role="user"]'
    )
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
        platform: 'grok'
      }
    } catch (error) {
      return null
    }
  }

  /**
   * Fetch all conversations from Grok's current API, falling back to the
   * visible sidebar only when the authenticated API cannot return a list.
   */
  async fetchAllConversations(): Promise<ConversationListItem[]> {
    const conversations = await fetchGrokConversationList()
    return conversations.length > 0 ? conversations : this.getConversationList()
  }

  /**
   * Extract conversation ID from the URL
   */
  private extractConversationId(): string | null {
    return getGrokConversationId(window.location.href)
  }

  /**
   * Extract all messages from the conversation DOM
   * Uses data-message-author-role attribute (same approach as ChatGPT)
   * Uses Set-based dedup to avoid counting the same message twice
   */
  private extractMessages(): ChatMessage[] {
    const messages: ChatMessage[] = []
    const seenElements = new Set<Element>()

    // Primary: use data-message-author-role (same as ChatGPT)
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
        '[class*="message"]',
        '[class*="turn"]'
      ]

      for (const selector of classSelectors) {
        const elements = document.querySelectorAll(selector)
        elements.forEach(element => {
          if (seenElements.has(element)) return
          seenElements.add(element)
          const role = this.determineRoleFromElement(element)
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
   * Determine role from element indicators
   */
  private determineRoleFromElement(element: Element): ChatMessage['role'] | null {
    const hasUserIndicator = element.querySelector(
      '[class*="user"], [data-role="user"]'
    )
    const hasAssistantIndicator = element.querySelector(
      '[class*="assistant"], [data-role="assistant"], [class*="bot"], [class*="grok"]'
    )

    if (hasUserIndicator) return 'user'
    if (hasAssistantIndicator) return 'assistant'

    const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || ''
    if (ariaLabel.includes('user') || ariaLabel.includes('you')) return 'user'
    if (ariaLabel.includes('assistant') || ariaLabel.includes('grok') || ariaLabel.includes('ai')) return 'assistant'

    // Check CSS classes directly
    const className = element.className || ''
    if (typeof className === 'string') {
      if (className.includes('user')) return 'user'
      if (className.includes('assistant') || className.includes('grok') || className.includes('bot')) return 'assistant'
    }

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
      'nav a[href]',
      'aside a[href]',
      '[class*="sidebar"] a[href]',
      '[class*="nav"] a[href]',
      'a[href]'
    ]

    for (const selector of selectors) {
      const links = document.querySelectorAll(selector)

      links.forEach(link => {
        const href = link.getAttribute('href')
        if (!href) return

        const id = getGrokConversationId(href)
        if (!id) return
        if (seen.has(id)) return

        const title = extractTextContent(link) || 'Untitled Conversation'

        seen.add(id)
        conversations.push({
          id,
          title,
          url: new URL(href, window.location.origin).href,
          platform: 'grok'
        })
      })

      if (conversations.length > 0) break
    }

    return conversations
  }

  /** Fetch a conversation by its requested ID without reading another chat's DOM. */
  async fetchConversationDetail(id: string): Promise<Conversation | null> {
    return fetchGrokConversationDetail(id)
  }
}

// Create parser instance
const parser = new GrokParser()

// Export for content script
export const config = {
  matches: ['https://grok.com/*', 'https://www.grok.com/*']
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
      const id = getGrokConversationId(url)
      if (id) {
        parser.fetchConversationDetail(id).then(apiConv => {
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
        platform: 'grok',
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
