/**
 * Grok DOM Parser Content Script
 * Parses conversations from grok.com using DOM reading
 * - Uses data-message-author-role attribute (similar to ChatGPT)
 * - Cookie-based auth for API calls
 */
import type { Conversation, ChatMessage, ConversationListItem } from '../core/types'
import type { ProviderParser } from '../providers/provider-parser'
import { createVerificationEvidence, syncSourceCompleteness } from '../core/verification'
import { generateId } from '../core/dom-utils'
import { cleanDocumentTitle, extractPageCreatedAt, titleFromFirstMatch } from '../providers/page-metadata'
import { collectAuthorRoleMessages, collectClassCandidateMessages, extractCleanMessageText, parseAuthorRoleElement } from '../providers/dom-message'
import { detectRoleFromIndicators } from '../providers/dom-roles'
import { collectSidebarConversationList } from '../providers/sidebar-list'
import { registerParserMessageHandler, runParserMain } from '../providers/parser-runtime'
import { createDomSnapshotSupport } from '../providers/dom-snapshot'
import { getGrokConversationId } from '../providers/grok-conversation-url'
import { fetchGrokConversationDetail, fetchGrokConversationList } from '../providers/grok-api'
import { isProviderRateLimitError } from '../core/provider-rate-limit'
import { createLogger, errorName } from '../core/logger'

const log = createLogger('Grok Parser')

interface GrokConversationListMeta extends Record<string, unknown> {
  source: 'api' | 'sidebar'
  complete: boolean
}

/**
 * Grok parser implementation
 */
export class GrokParser implements ProviderParser {
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
    return (
      cleanDocumentTitle(document.title, 'Grok') ||
      titleFromFirstMatch('[data-message-author-role="user"]') ||
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
      log.debug(`DOM parse failed (${errorName(error)})`)
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
    return collectAuthorRoleMessages(document, element => this.parseMessageElement(element)) ??
      collectClassCandidateMessages(document, {
        selector:
          '[class*="message-user"], [class*="message-assistant"], ' +
          '[class*="message"], [class*="turn"]',
        resolveRole: element => this.determineRoleFromElement(element),
        extractContent: element => this.extractMessageContent(element),
      })
  }

  /**
   * Parse a message element with data-message-author-role
   */
  private parseMessageElement(element: Element): ChatMessage | null {
    return parseAuthorRoleElement(element, {
      extractContent: contentElement => this.extractMessageContent(contentElement),
    })
  }

  /**
   * Determine role from element indicators
   */
  private determineRoleFromElement(element: Element): ChatMessage['role'] | null {
    return detectRoleFromIndicators(element, {
      assistantIndicatorSelector:
        '[class*="assistant"], [data-role="assistant"], [class*="bot"], [class*="grok"]',
      assistantAriaTerms: ['assistant', 'grok', 'ai'],
      classNameAssistantTerms: ['assistant', 'grok', 'bot'],
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
        'nav a[href]',
        'aside a[href]',
        '[class*="sidebar"] a[href]',
        '[class*="nav"] a[href]',
        'a[href]'
      ],
      platform: 'grok',
      resolveId: getGrokConversationId,
    })
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

// Observed-DOM snapshot: the labelled fallback offered when the provider
// API cannot verify the transcript, so the user is never left with only an error.
const domSnapshot = createDomSnapshotSupport(parser, '[data-message-author-role], [class*="message-user"], [class*="message-assistant"]')

// Register the shared popup-message handler (see src/providers/parser-runtime.ts)
registerParserMessageHandler({
  platform: 'grok',
  parser,
  getSnapshotContext: domSnapshot.getSnapshotContext,
  capturePageSnapshot: domSnapshot.capturePageSnapshot,
  extractConversationId: getGrokConversationId
})

// Run on page load
runParserMain(parser)
