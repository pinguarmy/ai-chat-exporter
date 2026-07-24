/**
 * ChatGPT DOM Parser Content Script
 * Parses conversations from chatgpt.com using DOM reading and API-based conversation list
 */
import type { Conversation, ChatMessage, PlatformParser, ConversationListItem } from '../lib/types'
import { generateId, extractTextContent, extractCodeBlocks, extractImages, cleanText } from '../lib/dom-utils'
import { preferMoreCompleteConversation } from '../lib/parser-fallback'

/**
 * ChatGPT parser implementation
 */
export class ChatGPTParser implements PlatformParser {
  platform = 'chatgpt' as const
  
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

      return {
        id: conversationId,
        title: this.getConversationTitle(),
        url: window.location.href,
        messages,
        createdAt: this.extractCreatedAt(),
        platform: 'chatgpt'
      }
    } catch (error) {
      return null
    }
  }

  /**
   * Get a ChatGPT access token by calling the session endpoint.
   * Caches the token in chrome.storage.local so subsequent calls reuse it.
   */
  private async getAccessToken(): Promise<string> {
    // Try cached token first
    const cached = await chrome.storage.local.get(['chatGPTAccessToken'])
    if (cached.chatGPTAccessToken) return cached.chatGPTAccessToken

    // Fetch new token from session endpoint
    const response = await fetch('https://chatgpt.com/api/auth/session')
    if (response.status === 403) throw new Error('Forbidden')
    const data = await response.json()
    if (!data.accessToken) throw new Error('No access token in response')

    // Cache it
    await chrome.storage.local.set({ chatGPTAccessToken: data.accessToken })
    return data.accessToken
  }

  /**
   * Clear cached access token (call on 401)
   */
  private async resetAccessToken(): Promise<void> {
    await chrome.storage.local.remove('chatGPTAccessToken')
  }

  /**
   * Fetch ALL conversations via the ChatGPT API (same API the browser uses when scrolling the sidebar).
   * This gets far more conversations than the DOM-only approach.
   */
  async fetchAllConversations(): Promise<ConversationListItem[]> {
    const conversations: ConversationListItem[] = []
    let offset = 0
    const limit = 100
    let hasMore = true
    let retries = 0
    const maxRetries = 1

    // Get access token for Authorization header
    let token = await this.getAccessToken()

    while (hasMore) {
      try {
        const response = await fetch(
          `https://chatgpt.com/backend-api/conversations?offset=${offset}&limit=${limit}&order=updated`,
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
          console.error('[ChatGPT Parser] Authentication expired')
          break
        }

        if (!response.ok) {
          console.error(`[ChatGPT Parser] API error: ${response.status}`)
          break
        }

        const data = await response.json()
        const items = data.items || data.conversations || []

        if (items.length === 0) {
          hasMore = false
          break
        }

        for (const item of items) {
          conversations.push({
            id: item.id,
            title: item.title || 'Untitled Conversation',
            url: `https://chatgpt.com/c/${item.id}`,
            platform: 'chatgpt',
            messageCount: item.message_count || item.messageCount || undefined,
            createdAt: item.create_time ? new Date(item.create_time * 1000).getTime() : undefined
          })
        }

        offset += limit

        // If we got fewer items than the limit, we've reached the end
        if (items.length < limit) {
          hasMore = false
        }
      } catch (error) {
        console.error('[ChatGPT Parser] Error fetching conversations:', error)
        break
      }
    }

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
          `https://chatgpt.com/backend-api/conversation/${id}`,
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

        if (!response.ok) {
          console.error(`[ChatGPT Parser] Failed to fetch conversation ${id}: ${response.status}`)
          return null
        }

        data = await response.json()
        break
      }

      if (!data) return null
      const messages: ChatMessage[] = []

      // ChatGPT API returns a tree of messages with mapping
      if (data.mapping) {
        const nodeMap: Record<string, any> = data.mapping
        // A conversation mapping contains every edited/regenerated branch.
        // Only its current_node is the path the user is actually viewing.
        for (const node of this.getActiveConversationPath(nodeMap, data.current_node)) {
          if (node.message) {
            const msg = node.message
            const role = msg.author?.role
            if (role === 'user' || role === 'assistant') {
              const { text: content, attachments: partAttachments } = this.extractParts(msg.content?.parts)
              if (content.trim()) {
                messages.push({
                  id: msg.id || generateId(),
                  role: role as ChatMessage['role'],
                  content: content.trim(),
                  attachments: partAttachments.length ? partAttachments : undefined,
                })
              }
            }
          }
        }
      }

      // Fallback: try flat messages array
      if (messages.length === 0 && data.messages) {
        for (const msg of data.messages) {
          const role = msg.author?.role || msg.role
          if (role === 'user' || role === 'assistant') {
            const { text: content, attachments: partAttachments } = this.extractParts(msg.content?.parts)
            if (content.trim()) {
              messages.push({
                id: msg.id || generateId(),
                role: role as ChatMessage['role'],
                content: content.trim(),
                attachments: partAttachments.length ? partAttachments : undefined,
              })
            }
          }
        }
      }

      return {
        id: data.id || id,
        title: data.title || this.getConversationTitle(),
        url: `https://chatgpt.com/c/${id}`,
        messages,
        createdAt: data.create_time ? new Date(data.create_time * 1000).getTime() : undefined,
        platform: 'chatgpt'
      }
    } catch (error) {
      console.error(`[ChatGPT Parser] Error fetching conversation detail:`, error)
      return null
    }
  }

  /**
   * Return the root-to-leaf path for the active branch in ChatGPT's message
   * tree. `current_node` is authoritative; older payloads without it fall
   * back to the newest leaf rather than exporting every abandoned branch.
   */
  private getActiveConversationPath(
    nodeMap: Record<string, any>,
    currentNodeId: unknown
  ): any[] {
    let nodeId = typeof currentNodeId === 'string' && nodeMap[currentNodeId]
      ? currentNodeId
      : null

    if (!nodeId) {
      const leaves = Object.entries(nodeMap).filter(([, node]) =>
        !Array.isArray(node?.children) || node.children.length === 0
      )
      nodeId = leaves
        .sort(([, left], [, right]) => {
          const leftTime = Number(left?.message?.create_time) || 0
          const rightTime = Number(right?.message?.create_time) || 0
          return rightTime - leftTime
        })
        .at(0)?.[0] || null
    }

    const path: any[] = []
    const visited = new Set<string>()
    while (nodeId && nodeMap[nodeId] && !visited.has(nodeId)) {
      visited.add(nodeId)
      const node = nodeMap[nodeId]
      path.unshift(node)
      nodeId = typeof node.parent === 'string' ? node.parent : null
    }

    return path
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
      name: img.alt
    }))
    
    return {
      id: generateId(),
      role,
      content,
      attachments: attachments.length > 0 ? attachments : undefined,
      codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined
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
            if (['p', 'span', 'div', 'strong', 'em', 'code'].includes(tag)) {
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
   * Extract text and attachments from ChatGPT message content parts.
   * ChatGPT API content parts are objects with .text, .type, etc. — not strings.
   */
  private extractParts(parts: any[] | undefined): { text: string; attachments: {type:'image'|'file', url:string, name?:string}[] } {
    const textParts: string[] = []
    const attachments: {type:'image'|'file', url:string, name?:string}[] = []
    if (!parts || !Array.isArray(parts)) return { text: '', attachments }
    for (const part of parts) {
      if (!part || typeof part !== 'object') {
        if (typeof part === 'string') textParts.push(part)
        continue
      }
      if (typeof part.text === 'string') {
        textParts.push(cleanText(part.text))
      } else if (part.type === 'image_file' || part.type === 'file') {
        const url = (part.file && part.file.url) || ''
        attachments.push({ type: 'file', url, name: part.name || 'Uploaded file' })
      } else if (part.type === 'image_url' && part.image_url && part.image_url.url) {
        attachments.push({ type: 'image', url: part.image_url.url, name: 'Image' })
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
  matches: ['https://chatgpt.com/*']
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
      const match = url.match(/\/c\/([a-f0-9-]+)/)
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
        platform: 'chatgpt',
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
