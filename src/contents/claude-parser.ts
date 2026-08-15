/**
 * Claude DOM Parser Content Script
 * Parses conversations from claude.ai using DOM reading and API-based conversation list
 *
 * Authentication Strategy:
 * - Cookie-based: Claude uses session cookies sent with credentials: 'include'
 * - No access token needed — the browser's cookie handles authentication
 * - Org ID is extracted from the page HTML or API responses
 */
import type { Conversation, ChatMessage, ConversationListItem, ConversationArtifact } from '../lib/types'
import { generateId, extractTextContent, extractCodeBlocks, extractImages } from '../lib/dom-utils'
import { registerParserMessageHandler, runParserMain } from '../lib/parser-runtime'
import { getApiMessageRecords, normalizeApiMessageRole } from '../lib/api-message-normalizer'
import { inferClaudeArtifactType } from '../lib/claude-artifact'
import { claudeElementToMarkdown, extractClaudeMessageMarkdown, normalizeClaudeMarkdown } from '../lib/claude-rich-text'
import { isProviderRateLimitError, isRateLimitedResponse, ProviderRateLimitError } from '../lib/provider-rate-limit'

/** UUID regex for matching conversation IDs and org IDs */
const UUID_REGEX = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

/** Regex to extract org ID from API URLs in the page */
const ORG_API_REGEX = /\/api\/organizations\/([a-f0-9-]{36})\/chat_conversations/i

/** Regex to extract org ID from lastActiveOrg cookie or page data */
const LAST_ACTIVE_ORG_REGEX = /lastActiveOrg[^a-f0-9]{0,120}?([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i

/** Regex to extract org ID from analytics/user ID calls */
const USER_ID_REGEX = /"_setUserId",\s*"([a-f0-9-]{36})"/i

/** Stable role-bearing markers used by current Claude builds. */
const CLAUDE_SEMANTIC_ROLE_SELECTOR =
  '[data-testid="user-message"], [data-testid="assistant-message"], [data-is-streaming], ' +
  '[data-role="user"], [data-role="assistant"]'

/** Legacy exact classes kept only as compatibility fallbacks. */
const CLAUDE_LEGACY_ROLE_SELECTOR = '.font-claude-message, .font-claude-response'
const CLAUDE_GENERIC_MESSAGE_SELECTOR = '[data-testid="chat-message"]'

type ClaudeApiRecord = Record<string, any>

function claudeTimestamp(value: unknown): number | undefined {
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

function firstString(...values: unknown[]): string | null {
  return values.find(value => typeof value === 'string' && value.trim()) as string | null || null
}

function recordId(record: ClaudeApiRecord): string | null {
  return firstString(record.uuid, record.id, record.message_uuid, record.messageUuid)
}

function parentId(record: ClaudeApiRecord): string | null {
  return firstString(
    record.parent_uuid,
    record.parent_message_uuid,
    record.parentMessageUuid,
    record.parent_id,
    record.parentId,
    record.parent?.uuid,
    record.parent?.id
  )
}

function findBranchPointer(value: any, depth = 0): string | null {
  if (!value || depth > 3 || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findBranchPointer(item, depth + 1)
      if (found) return found
    }
    return null
  }
  const direct = firstString(
    value.current_leaf_message_uuid,
    value.current_leaf_uuid,
    value.currentLeafMessageUuid,
    value.currentLeafUuid,
    value.current_node_uuid,
    value.currentNodeUuid,
    value.current_node?.uuid,
    value.current_node?.id,
    value.currentNode?.uuid,
    value.currentNode?.id
  )
  if (direct) return direct
  for (const key of ['conversation', 'metadata', 'tree', 'branch']) {
    const found = findBranchPointer(value[key], depth + 1)
    if (found) return found
  }
  return null
}

/**
 * Resolve Claude's tree response to one active parent chain. Returning every
 * record from a `tree=True` response exports abandoned regenerated answers.
 * When an explicit leaf is unavailable, active flags or the longest coherent
 * chain are used as a conservative fallback instead of flattening siblings.
 *
 * A missing parent must never collapse a large response to one record. We keep
 * the longest recoverable suffix and let fetchConversationDetail reject a
 * suspiciously tiny selection instead of silently exporting it.
 */
export function selectClaudeActiveBranch(
  records: ClaudeApiRecord[],
  payload: unknown
): ClaudeApiRecord[] {
  if (records.length < 2) return records
  const byId = new Map(records.map(record => [recordId(record), record]).filter(([id]) => Boolean(id)) as [string, ClaudeApiRecord][])
  const leafId = findBranchPointer(payload)

  const buildChain = (startId: string): ClaudeApiRecord[] => {
    const chain: ClaudeApiRecord[] = []
    const seen = new Set<string>()
    let current: string | null = startId
    while (current && !seen.has(current)) {
      seen.add(current)
      const record = byId.get(current)
      if (!record) break
      chain.push(record)
      current = parentId(record)
    }
    return chain.reverse()
  }

  if (leafId && byId.has(leafId)) {
    const chain = buildChain(leafId)
    if (chain.length > 0) return chain
  }

  const active = records.filter(record =>
    record.is_current === true || record.isCurrent === true || record.active === true ||
    record.selected === true || record.is_active === true
  )
  if (active.length > 0) {
    const activeLeaf = active[active.length - 1]
    const activeId = recordId(activeLeaf)
    if (activeId) {
      const chain = buildChain(activeId)
      if (chain.length > 0) return chain
    }
  }

  const hasParents = records.some(record => parentId(record))
  if (!hasParents) return records

  // Choose the most complete parent chain. Ties use the last leaf in API
  // order, which is generally the newest branch, while still excluding all
  // sibling records from the export.
  const children = new Set(records.map(parentId).filter(Boolean) as string[])
  const leaves = records.filter(record => {
    const id = recordId(record)
    return Boolean(id && !children.has(id))
  })
  let best: ClaudeApiRecord[] = []
  for (const leaf of leaves) {
    const id = recordId(leaf)
    if (!id) continue
    const chain = buildChain(id)
    if (chain.length >= best.length) best = chain
  }
  return best.length > 0 ? best : records
}

function isSuspiciousClaudeApiSelection(
  allRecords: ClaudeApiRecord[],
  selectedRecords: ClaudeApiRecord[]
): boolean {
  const allRoleRecords = allRecords.filter(record => Boolean(normalizeApiMessageRole(record)))
  const selectedRoleRecords = selectedRecords.filter(record => Boolean(normalizeApiMessageRole(record)))

  if (allRoleRecords.length <= 1) return false
  if (selectedRoleRecords.length === 0) return true
  if (selectedRoleRecords.length === 1 && allRoleRecords.length >= 4) return true

  // Branching can legitimately reduce a tree, so only reject severe collapses.
  // This catches cases such as 80+ API records resolving to ~8 turns while
  // leaving ordinary regeneration branches alone.
  return allRoleRecords.length >= 20 &&
    selectedRoleRecords.length <= 10 &&
    selectedRoleRecords.length * 4 < allRoleRecords.length
}

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
export class ClaudeParser {
  platform = 'claude' as const

  /** Cached org ID to avoid re-extracting */
  private cachedOrgId: string | null = null
  private authenticationRequired = false

  /** Safe aggregate signal for the scheduled-export status surface. */
  isAuthenticationRequired(): boolean {
    return this.authenticationRequired
  }

  /**
   * Check if current page is a Claude conversation
   */
  isConversationPage(): boolean {
    return !!(
      document.querySelector(CLAUDE_GENERIC_MESSAGE_SELECTOR) ||
      document.querySelector(CLAUDE_LEGACY_ROLE_SELECTOR) ||
      document.querySelector(CLAUDE_SEMANTIC_ROLE_SELECTOR) ||
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

    // 3. Fallback: look for a semantic user role marker only.
    const userMsg = document.querySelector('[data-role="user"]')
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
      console.error('[Claude Parser] DOM parse failed:', error)
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
      if (isRateLimitedResponse(response)) throw new ProviderRateLimitError()
      if (response.status === 401 || response.status === 403) {
        this.authenticationRequired = true
        return null
      }
      if (response.ok) {
        const data = await response.json()
        if (data.orgID) {
          this.cachedOrgId = data.orgID
          this.authenticationRequired = false
          return data.orgID
        }
        // Some responses have organization details
        if (data.organization?.id) {
          this.cachedOrgId = data.organization.id
          this.authenticationRequired = false
          return data.organization.id
        }
      }
    } catch (error) {
      if (isProviderRateLimitError(error)) throw error
      console.error('[Claude Parser] Session API unavailable:', error)
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

    const orgId = await this.getOrgId()
    if (!orgId) {
      console.error('[Claude Parser] Could not determine organization ID')
      return this.getConversationList() // Fall back to DOM list only; detail export is guarded separately.
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

        if (isRateLimitedResponse(response)) {
          throw new ProviderRateLimitError()
        }

        if (response.status === 401 || response.status === 403) {
          this.authenticationRequired = true
          console.error(`[Claude Parser] Authentication error: ${response.status}`)
          break
        }

        if (!response.ok) {
          console.error(`[Claude Parser] API error: ${response.status}`)
          break
        }

        this.authenticationRequired = false
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
        if (isProviderRateLimitError(error)) throw error
        console.error('[Claude Parser] Error fetching conversations:', error)
        break
      }
    }

    // If API didn't return results, fall back to DOM list. This does not mean
    // detail exports may fall back silently; current/detail export paths guard that.
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
      if (!id) {
        console.error('[Claude Parser] Missing conversation ID for detail fetch')
        return null
      }

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

      if (isRateLimitedResponse(response)) {
        throw new ProviderRateLimitError()
      }

      if (response.status === 401 || response.status === 403) {
        this.authenticationRequired = true
        console.error(`[Claude Parser] Auth error for conversation ${id}: ${response.status}`)
        return null
      }

      if (!response.ok) {
        console.error(`[Claude Parser] Failed to fetch conversation ${id}: ${response.status}`)
        return null
      }

      this.authenticationRequired = false
      const data = await response.json()
      const messages: ChatMessage[] = []
      const artifacts: ConversationArtifact[] = []

      const apiRecords = getApiMessageRecords(data) as ClaudeApiRecord[]
      const activeRecords = selectClaudeActiveBranch(apiRecords, data)
      if (isSuspiciousClaudeApiSelection(apiRecords, activeRecords)) {
        console.error('[Claude Parser] Refusing suspicious API branch collapse', {
          conversationId: id,
          apiRecordCount: apiRecords.length,
          selectedRecordCount: activeRecords.length,
        })
        return null
      }

      for (const msg of activeRecords) {
        const role = normalizeApiMessageRole(msg)
        if (!role) continue

        const content = extractClaudeMessageMarkdown(msg)
        const blocks = Array.isArray(msg.content)
          ? msg.content
          : Array.isArray(msg.message?.content)
            ? msg.message.content
            : []
        for (const block of blocks) {
          if (!block || typeof block !== 'object') continue
          const typedBlock = block as Record<string, any>
          if (typedBlock.type === 'tool_use' && typedBlock.input?.content) {
            const artifactType = inferClaudeArtifactType(typedBlock)
            artifacts.push({
              type: artifactType,
              title: typedBlock.input.title || typedBlock.name || 'Artifact',
              content: typedBlock.input.content,
              language: typedBlock.input.language || typedBlock.input.lang ||
                (artifactType === 'code' ? typedBlock.name : undefined),
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
            content: normalizeClaudeMarkdown(content),
            timestamp: claudeTimestamp(
              msg.created_at ?? msg.createdAt ?? msg.create_time ??
              msg.message?.created_at ?? msg.message?.createdAt
            ),
          })
        }
      }

      if (messages.length === 0) {
        console.error(`[Claude Parser] API detail for ${id} contained no exportable messages`)
        return null
      }

      const conversation: Conversation = {
        id: data.uuid || data.id || id,
        title: data.name || data.title || this.getConversationTitle(),
        url: `https://claude.ai/chat/${id}`,
        messages,
        createdAt: claudeTimestamp(data.created_at ?? data.createdAt ?? data.create_time),
        modelName: firstString(
          data.model,
          data.model_name,
          data.modelName,
          data.model_slug,
          data.metadata?.model,
          data.metadata?.model_name
        ) || undefined,
        platform: 'claude',
        artifacts: artifacts.length > 0 ? artifacts : undefined
      }

      return conversation
    } catch (error) {
      if (isProviderRateLimitError(error)) throw error
      console.error('[Claude Parser] Error fetching conversation detail:', error)
      return null
    }
  }

  /**
   * Extract all messages from the conversation DOM.
   * Uses semantic role markers first, keeps generic/legacy compatibility, and
   * avoids counting nested wrappers as separate turns.
   */
  private extractMessages(): ChatMessage[] {
    const messages: ChatMessage[] = []

    // One combined query preserves chronological DOM order and, unlike the old
    // either/or strategy, also supports pages where old and new Claude message
    // container shapes coexist in the same long conversation.
    const candidateSelector =
      `${CLAUDE_GENERIC_MESSAGE_SELECTOR}, ${CLAUDE_SEMANTIC_ROLE_SELECTOR}, ${CLAUDE_LEGACY_ROLE_SELECTOR}`
    const messageContainers = document.querySelectorAll(candidateSelector)

    if (messageContainers.length > 0) {
      messageContainers.forEach(element => {
        if (this.shouldSkipNestedMessageCandidate(element)) return
        const message = this.parseMessageElement(element)
        if (message) messages.push(message)
      })
    } else {
      // Last-resort scan uses explicit semantic words only. Avoid broad class
      // substring and aria-label "ai" matching, which can classify unrelated UI.
      const fallbackMessages = document.querySelectorAll(
        '[aria-label*="Claude" i], [aria-label*="assistant" i], ' +
        '[aria-label*="user" i], [aria-label*="human" i]'
      )
      fallbackMessages.forEach(element => {
        const content = this.extractMessageContent(element)
        if (!content.trim()) return

        const role = this.determineRoleFromElement(element)
        if (!role) return

        messages.push({
          id: element.getAttribute('data-message-id') || generateId(),
          role,
          content: normalizeClaudeMarkdown(content)
        })
      })
    }

    return messages
  }

  /**
   * A single turn is often represented by several nested Claude wrappers.
   * Prefer semantic child markers and skip wrapper mirrors so headings/code
   * inside a response can never become extra messages merely through classes.
   */
  private shouldSkipNestedMessageCandidate(element: Element): boolean {
    // A generic wrapper is only needed when it does not contain a more precise
    // role-bearing descendant. This also preserves mixed old/new DOM histories.
    if (
      element.matches(CLAUDE_GENERIC_MESSAGE_SELECTOR) &&
      element.querySelector(`${CLAUDE_SEMANTIC_ROLE_SELECTOR}, ${CLAUDE_LEGACY_ROLE_SELECTOR}`)
    ) {
      return true
    }

    // Prefer explicit user/assistant test IDs inside broader streaming/data-role wrappers.
    if (
      element.hasAttribute('data-is-streaming') &&
      element.querySelector('[data-testid="assistant-message"]')
    ) {
      return true
    }
    if (
      element.getAttribute('data-role') === 'assistant' &&
      element.querySelector('[data-testid="assistant-message"]')
    ) {
      return true
    }
    if (
      element.getAttribute('data-role') === 'user' &&
      element.querySelector('[data-testid="user-message"]')
    ) {
      return true
    }

    // Legacy styling wrappers nested in any semantic role container are mirrors.
    if (element.matches(CLAUDE_LEGACY_ROLE_SELECTOR)) {
      const semanticAncestor = element.parentElement?.closest(CLAUDE_SEMANTIC_ROLE_SELECTOR)
      if (semanticAncestor) return true
    }

    // data-role wrappers nested inside a stronger test-id/streaming marker are mirrors.
    if (element.hasAttribute('data-role')) {
      const strongerAncestor = element.parentElement?.closest(
        '[data-testid="user-message"], [data-testid="assistant-message"], [data-is-streaming]'
      )
      if (strongerAncestor) return true
    }

    return false
  }

  /**
   * Parse a message element from Claude's DOM.
   * Determines the role from data-testid or other attributes.
   */
  private parseMessageElement(element: Element): ChatMessage | null {
    const testId = element.getAttribute('data-testid')
    const dataRole = element.getAttribute('data-role')?.toLowerCase() || ''
    let role: ChatMessage['role'] | null = null

    if (testId === 'user-message' || dataRole === 'user' || dataRole === 'human') {
      role = 'user'
    } else if (testId === 'assistant-message' || dataRole === 'assistant' || dataRole === 'ai') {
      role = 'assistant'
    } else if (
      element.hasAttribute('data-is-streaming') ||
      element.matches(CLAUDE_LEGACY_ROLE_SELECTOR)
    ) {
      // Claude currently marks assistant turns with data-is-streaming. The
      // value is true while a response is being generated and false once it
      // settles; both are assistant messages.
      role = 'assistant'
    } else if (testId === 'chat-message') {
      // For generic chat-message, check for semantic indicators inside.
      const hasUserIndicator = element.querySelector('[data-testid="user-message"], [data-role="user"]')
      const hasAssistantIndicator = element.querySelector(
        '[data-testid="assistant-message"], [data-role="assistant"], [data-is-streaming], ' +
        CLAUDE_LEGACY_ROLE_SELECTOR
      )

      if (hasUserIndicator) {
        role = 'user'
      } else if (hasAssistantIndicator) {
        role = 'assistant'
      } else {
        role = this.determineRoleFromElement(element)
      }
    }

    if (!role) return null

    // Extract content from the message. Prefer Claude's semantic prose/Markdown
    // container so controls and flattened wrapper mirrors stay out of exports.
    const contentElement = element.querySelector(
      '.prose, [class*="markdown"]'
    ) || element.querySelector(
      '.font-claude-message, .font-claude-response, [class*="content"]'
    ) || element

    const content = this.extractMessageContent(contentElement)
    if (!content.trim()) return null

    const codeBlocks = extractCodeBlocks(contentElement)
    const imageData = extractImages(contentElement)
    const attachments = imageData.map(img => ({
      type: 'image' as const,
      url: img.url,
      name: img.alt,
      uploaded: role === 'user'
    }))

    const messageId = element.getAttribute('data-message-id') ||
      element.querySelector('[data-message-id]')?.getAttribute('data-message-id') ||
      generateId()

    return {
      id: messageId,
      role,
      content: normalizeClaudeMarkdown(content),
      attachments: attachments.length > 0 ? attachments : undefined,
      codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
      timestamp: claudeTimestamp(
        element.querySelector('time[datetime]')?.getAttribute('datetime')
          || element.getAttribute('data-timestamp')
          || element.getAttribute('data-created-at')
      )
    }
  }

  /** Determine the role of a message from explicit semantic words only. */
  private determineRoleFromElement(element: Element): ChatMessage['role'] | null {
    const classText = Array.from(element.classList || []).join(' ').toLowerCase()
    const hasUserClass = /(?:^|[\s_-])(user|human)(?:[\s_-]|$)/.test(classText)
    const hasAssistantClass = /(?:^|[\s_-])(assistant|claude)(?:[\s_-]|$)/.test(classText) ||
      /(?:^|[\s_-])claude-response(?:[\s_-]|$)/.test(classText)

    if (hasUserClass) return 'user'
    if (hasAssistantClass) return 'assistant'

    const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || ''
    if (/\b(user|human|you)\b/.test(ariaLabel)) return 'user'
    if (/\b(assistant|claude)\b/.test(ariaLabel) || /\bai assistant\b/.test(ariaLabel)) return 'assistant'

    if (element.hasAttribute('data-is-streaming')) return 'assistant'

    const roleAttr = element.getAttribute('role')?.toLowerCase() || ''
    if (roleAttr === 'user' || roleAttr === 'human') return 'user'
    if (roleAttr === 'assistant' || roleAttr === 'ai') return 'assistant'

    return null
  }

  /** Extract clean Markdown content from a message element. */
  private extractMessageContent(element: Element): string {
    const clone = element.cloneNode(true) as Element
    return claudeElementToMarkdown(clone)
  }

  /** Extract conversation creation timestamp. */
  private extractCreatedAt(): number | undefined {
    const timeElements = document.querySelectorAll('time[datetime]')
    if (timeElements.length > 0) {
      const datetime = timeElements[0].getAttribute('datetime')
      if (datetime) {
        const timestamp = new Date(datetime).getTime()
        if (!isNaN(timestamp)) return timestamp
      }
    }
    return undefined
  }

  /** Get list of conversations from the sidebar (DOM-based, limited to visible items). */
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

// Register the shared popup-message handler (see src/lib/parser-runtime.ts).
// Claude virtualizes long histories, so a DOM-only current export is never
// considered authoritative. If API detail cannot be verified, fail visibly.
registerParserMessageHandler({
  platform: 'claude',
  parser,
  extractConversationId: url => url.match(/\/chat\/([a-f0-9-]+)/)?.[1] ?? null,
  requireApiDetailForCurrentExport: true,
  preferApiDetailWhenComplete: true,
  apiDetailUnavailableError:
    'Claude did not return a verifiably complete conversation. Export was stopped instead of saving a potentially truncated DOM snapshot. Reload Claude and try again.',
  logApiError: error => console.error('[Claude Parser] API fetch error:', error),
  logParseError: error => console.error('[Claude Parser] parseCurrentConversation error:', error)
})

// Run on page load
runParserMain(parser)
