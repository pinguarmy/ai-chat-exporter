/**
 * Grok DOM Parser Content Script
 * Parses conversations from grok.com using DOM reading
 * - Uses data-message-author-role attribute (similar to ChatGPT)
 * - Cookie-based auth for API calls
 */
import type { Conversation, ChatMessage, ConversationListItem } from '../lib/types'
import { createVerificationEvidence, syncSourceCompleteness } from '../lib/verification'
import { generateId, extractTextContent, extractTextWithMedia, extractCodeBlocks, extractImages, cleanText } from '../lib/dom-utils'
import { registerParserMessageHandler, runParserMain } from '../lib/parser-runtime'
import { getGrokConversationId } from '../lib/grok-conversation-url'
import { fetchGrokConversationDetail, fetchGrokConversationList } from '../lib/grok-api'
import { isProviderRateLimitError } from '../lib/provider-rate-limit'

interface GrokConversationListMeta extends Record<string, unknown> {
  source: 'api' | 'sidebar'
  complete: boolean
}

/**
 * Grok parser implementation
 */
export class GrokParser {
  platform = 'grok' as const
  private authenticationRequired = false
  private conversationListMeta: GrokConversationListMeta = { source: 'sidebar', complete: false }

  /** Safe aggregate signal for the scheduled-export status surface. */
  isAuthenticationRequired(): boolean {
    return this.authenticationRequired
  }

  getConversationListMeta(): GrokConversationListMeta {
    return { ...this.conversationListMeta }
  }

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

      return syncSourceCompleteness({
        id: this.extractConversationId() || generateId(),
        title: this.getConversationTitle(),
        url: window.location.href,
        messages,
        createdAt: this.extractCreatedAt(),
        platform: 'grok',
        source: 'dom',
        sourceCompleteness: 'unverified',
        verification: createVerificationEvidence({
          provider: 'grok',
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
   * Fetch all conversations from Grok's current API, falling back to the
   * visible sidebar only when the authenticated API cannot return a list.
   */
  async fetchAllConversations(): Promise<ConversationListItem[]> {
    this.conversationListMeta = { source: 'sidebar', complete: false }
    try {
      const conversations = await fetchGrokConversationList()
      this.authenticationRequired = false
      this.conversationListMeta = { source: 'api', complete: true }
      return conversations
    } catch (error) {
      if (error instanceof Error && error.message === 'Authentication required') {
        this.authenticationRequired = true
        throw error
      }
      if (isProviderRateLimitError(error)) throw error
      return this.getConversationList()
    }
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
      // Query all role-bearing candidates in one pass. A user-first selector
      // loop can return a non-empty user result and then break before Grok's
      // assistant nodes are visited.
      const classCandidates = Array.from(document.querySelectorAll(
        '[class*="message-user"], [class*="message-assistant"], ' +
        '[class*="message"], [class*="turn"]'
      ))
      classCandidates.forEach(element => {
        if (seenElements.has(element)) return
        const specificChild = element.querySelector(
          '[class*="message-user"], [class*="message-assistant"]'
        )
        if (specificChild && !element.matches('[class*="message-user"], [class*="message-assistant"]')) return
        seenElements.add(element)
        const role = this.determineRoleFromElement(element)
        if (!role) return
        const content = this.extractMessageContent(element)
        if (!content.trim()) return
        messages.push({
          id: element.getAttribute('data-message-id') || generateId(),
          role,
          content,
        })
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

// Register the shared popup-message handler (see src/lib/parser-runtime.ts)
registerParserMessageHandler({
  platform: 'grok',
  parser,
  extractConversationId: getGrokConversationId
})

// Run on page load
runParserMain(parser)
