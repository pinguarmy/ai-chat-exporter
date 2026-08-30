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
import { createVerificationEvidence, syncSourceCompleteness } from '../lib/verification'
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

/** Stable role-bearing markers used by current Claude builds. */
const CLAUDE_SEMANTIC_ROLE_SELECTOR =
  '[data-testid="user-message"], [data-testid="assistant-message"], [data-is-streaming], ' +
  '[data-role="user"], [data-role="assistant"]'

/** Legacy exact classes kept only as compatibility fallbacks. */
const CLAUDE_LEGACY_ROLE_SELECTOR = '.font-claude-message, .font-claude-response'
const CLAUDE_GENERIC_MESSAGE_SELECTOR = '[data-testid="chat-message"]'

type ClaudeApiRecord = Record<string, any>

type ClaudeConversationListMeta = {
  source: 'api' | 'sidebar'
  complete: boolean
  pagesFetched?: number
}

export type ClaudeBranchIssue = 'leaf_missing' | 'missing_parent' | 'cycle' | 'no_resolvable_leaf'

export interface ClaudeBranchResolution {
  records: ClaudeApiRecord[]
  complete: boolean
  leafId?: string
  issue?: ClaudeBranchIssue
}

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
 * Resolve Claude's tree response to one active parent chain and prove that the
 * selected chain reaches a real root. Message-count ratios are intentionally
 * not used: a legitimate short fork can coexist with a much larger abandoned
 * branch, while a 15-record response can still be truncated to six records by
 * a missing parent.
 */
export function resolveClaudeActiveBranch(
  records: ClaudeApiRecord[],
  payload: unknown
): ClaudeBranchResolution {
  if (records.length === 0) {
    return { records: [], complete: false, issue: 'no_resolvable_leaf' }
  }

  const entries = records
    .map(record => [recordId(record), record] as const)
    .filter((entry): entry is readonly [string, ClaudeApiRecord] => Boolean(entry[0]))
  const byId = new Map<string, ClaudeApiRecord>(entries)
  const explicitLeafId = findBranchPointer(payload)

  // Some Claude response shapes are already flat chronological arrays and do
  // not expose parent links. In that case there is no tree chain to validate.
  const hasParents = records.some(record => Boolean(parentId(record)))
  if (!hasParents) {
    return { records, complete: true, leafId: explicitLeafId || undefined }
  }

  const buildChain = (startId: string): ClaudeBranchResolution => {
    const chain: ClaudeApiRecord[] = []
    const seen = new Set<string>()
    let current: string | null = startId

    while (current) {
      if (seen.has(current)) {
        return { records: chain.reverse(), complete: false, leafId: startId, issue: 'cycle' }
      }
      seen.add(current)

      const record = byId.get(current)
      if (!record) {
        return { records: chain.reverse(), complete: false, leafId: startId, issue: 'missing_parent' }
      }

      chain.push(record)
      current = parentId(record)
    }

    return { records: chain.reverse(), complete: true, leafId: startId }
  }

  // An explicit active leaf is authoritative. If Claude points at a node that
  // is absent, or its parent chain is broken, do not silently switch branches.
  if (explicitLeafId) {
    if (!byId.has(explicitLeafId)) {
      return { records: [], complete: false, leafId: explicitLeafId, issue: 'leaf_missing' }
    }
    return buildChain(explicitLeafId)
  }

  const active = records.filter(record =>
    record.is_current === true || record.isCurrent === true || record.active === true ||
    record.selected === true || record.is_active === true
  )
  if (active.length > 0) {
    const activeParentIds = new Set(active.map(parentId).filter(Boolean) as string[])
    const activeLeaves = active.filter(record => {
      const id = recordId(record)
      return Boolean(id && !activeParentIds.has(id))
    })
    const activeId = recordId(activeLeaves[0] || active[active.length - 1])
    if (activeId) return buildChain(activeId)
  }

  // No active pointer: choose the longest structurally complete leaf chain.
  // An incomplete chain never beats a shorter chain that actually reaches root.
  const parentIds = new Set(records.map(parentId).filter(Boolean) as string[])
  const leaves = records.filter(record => {
    const id = recordId(record)
    return Boolean(id && !parentIds.has(id))
  })

  let bestComplete: ClaudeBranchResolution | null = null
  let bestIncomplete: ClaudeBranchResolution | null = null
  for (const leaf of leaves) {
    const id = recordId(leaf)
    if (!id) continue
    const candidate = buildChain(id)
    if (candidate.complete) {
      if (!bestComplete || candidate.records.length >= bestComplete.records.length) bestComplete = candidate
    } else if (!bestIncomplete || candidate.records.length >= bestIncomplete.records.length) {
      bestIncomplete = candidate
    }
  }

  if (bestComplete) return bestComplete
  if (bestIncomplete) return bestIncomplete
  return { records, complete: false, issue: 'no_resolvable_leaf' }
}

/** Backward-compatible helper used by existing branch-selection tests. */
export function selectClaudeActiveBranch(
  records: ClaudeApiRecord[],
  payload: unknown
): ClaudeApiRecord[] {
  return resolveClaudeActiveBranch(records, payload).records
}

/**
 * Extract organization ID from the page.
 * Tries multiple strategies:
 * 1. Find org ID from API URLs in the page HTML
 * 2. Find from lastActiveOrg in page data
 * Analytics `_setUserId` is a user UUID, not an organization UUID, so it is
 * never used as an org candidate.
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
  private conversationListMeta: ClaudeConversationListMeta = { source: 'sidebar', complete: false }

  /** Safe aggregate signal for the scheduled-export status surface. */
  isAuthenticationRequired(): boolean {
    return this.authenticationRequired
  }

  /** Completeness metadata for the most recent history-list read. */
  getConversationListMeta(): ClaudeConversationListMeta {
    return { ...this.conversationListMeta }
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
    const pageTitle = document.title
    if (pageTitle) {
      const cleaned = pageTitle.replace(/\s*[|–-]\s*Claude.*$/i, '').trim()
      if (cleaned && cleaned !== 'Claude' && cleaned.length > 0) return cleaned
    }

    const firstUserMsg = document.querySelector('[data-testid="user-message"]')
    if (firstUserMsg) {
      const text = extractTextContent(firstUserMsg)
      if (text && text.length > 0) return text.length > 80 ? text.substring(0, 80) + '...' : text
    }

    const userMsg = document.querySelector('[data-role="user"]')
    if (userMsg) {
      const text = extractTextContent(userMsg)
      if (text && text.length > 0) return text.length > 80 ? text.substring(0, 80) + '...' : text
    }

    return 'Untitled Conversation'
  }

  /** Parse the currently rendered DOM snapshot. Claude marks this unverified. */
  async parseCurrentConversation(): Promise<Conversation | null> {
    try {
      const messages = this.extractMessages()
      if (messages.length === 0) return null

      const urlMatch = window.location.pathname.match(/\/chat\/([a-f0-9-]+)/)
      const conversationId = urlMatch?.[1] || generateId()

      return syncSourceCompleteness({
        id: conversationId,
        title: this.getConversationTitle(),
        url: window.location.href,
        messages,
        createdAt: this.extractCreatedAt(),
        platform: 'claude',
        source: 'dom',
        sourceCompleteness: 'unverified',
        verification: createVerificationEvidence({
          provider: 'claude',
          source: 'dom',
          transcript: {
            verified: false,
            method: 'dom-unverified',
            reasons: ['source_unverified'],
          },
        }),
      })
    } catch (error) {
      console.error('[Claude Parser] DOM parse failed:', error)
      return null
    }
  }

  /** Get the organization ID for API calls. Caches a valid result. */
  private async getOrgId(): Promise<string | null> {
    if (this.cachedOrgId && UUID_REGEX.test(this.cachedOrgId)) return this.cachedOrgId

    const orgId = extractOrgId()
    if (orgId) {
      this.cachedOrgId = orgId
      return orgId
    }

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

    const bootstrapOrgId = await this.getOrgIdFromBootstrap()
    if (bootstrapOrgId) {
      this.cachedOrgId = bootstrapOrgId
      this.authenticationRequired = false
      return bootstrapOrgId
    }

    return null
  }

  /**
   * `/new` often has no organization URL in HTML, and `/api/auth/session` 404s
   * on current Claude builds. Probe `/api/bootstrap` memberships and keep the
   * first org that can list conversations.
   */
  private async getOrgIdFromBootstrap(): Promise<string | null> {
    try {
      const response = await fetch('https://claude.ai/api/bootstrap', { credentials: 'include' })
      if (isRateLimitedResponse(response)) throw new ProviderRateLimitError()
      if (response.status === 401 || response.status === 403) {
        this.authenticationRequired = true
        return null
      }
      if (!response.ok) return null
      const data = await response.json()
      const memberships: unknown[] = Array.isArray(data?.account?.memberships) ? data.account.memberships : []
      const candidates = memberships.flatMap(membership => {
        if (!membership || typeof membership !== 'object') return []
        const organization = (membership as Record<string, any>).organization
        const uuid = organization?.uuid || organization?.id
        return typeof uuid === 'string' && UUID_REGEX.test(uuid) ? [uuid] : []
      })
      for (const candidate of candidates) {
        const probe = await fetch(
          `https://claude.ai/api/organizations/${candidate}/chat_conversations?limit=1&offset=0`,
          { credentials: 'include', headers: { 'Accept': 'application/json' } }
        )
        if (isRateLimitedResponse(probe)) throw new ProviderRateLimitError()
        if (probe.ok) return candidate
      }
    } catch (error) {
      if (isProviderRateLimitError(error)) throw error
      console.error('[Claude Parser] Bootstrap org discovery failed:', error)
    }
    return null
  }

  /** Fetch Claude conversation history while retaining pagination completeness. */
  async fetchAllConversations(): Promise<ConversationListItem[]> {
    const conversations: ConversationListItem[] = []
    let offset = 0
    const limit = 100
    let hasMore = true
    let pagesFetched = 0
    let apiSucceeded = false
    let complete = true

    const useSidebarFallback = () => {
      this.conversationListMeta = { source: 'sidebar', complete: false }
      return this.getConversationList()
    }

    const orgId = await this.getOrgId()
    if (!orgId) {
      console.error('[Claude Parser] Could not determine organization ID')
      return useSidebarFallback()
    }

    while (hasMore) {
      try {
        const response = await fetch(
          `https://claude.ai/api/organizations/${orgId}/chat_conversations?limit=${limit}&offset=${offset}`,
          {
            credentials: 'include',
            headers: { 'Accept': 'application/json' }
          }
        )

        if (isRateLimitedResponse(response)) {
          if (conversations.length === 0) throw new ProviderRateLimitError()
          complete = false
          break
        }

        if (response.status === 401 || response.status === 403) {
          this.authenticationRequired = true
          complete = false
          console.error(`[Claude Parser] Authentication error: ${response.status}`)
          break
        }

        if (!response.ok) {
          complete = false
          console.error(`[Claude Parser] API error: ${response.status}`)
          break
        }

        apiSucceeded = true
        pagesFetched += 1
        this.authenticationRequired = false
        const data = await response.json()
        const items = Array.isArray(data)
          ? data
          : Array.isArray(data.conversations)
            ? data.conversations
            : Array.isArray(data.items)
              ? data.items
              : []

        if (items.length === 0) break

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
        if (items.length < limit) hasMore = false
      } catch (error) {
        if (isProviderRateLimitError(error)) throw error
        complete = false
        console.error('[Claude Parser] Error fetching conversations:', error)
        break
      }
    }

    if (!apiSucceeded && conversations.length === 0) return useSidebarFallback()

    this.conversationListMeta = { source: 'api', complete, pagesFetched }
    return conversations
  }

  /** Fetch structurally verified full conversation detail from the Claude API. */
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
          headers: { 'Accept': 'application/json' }
        }
      )

      if (isRateLimitedResponse(response)) throw new ProviderRateLimitError()

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
      const branch = resolveClaudeActiveBranch(apiRecords, data)
      if (!branch.complete) {
        console.error('[Claude Parser] Refusing structurally incomplete API branch', {
          conversationId: id,
          apiRecordCount: apiRecords.length,
          selectedRecordCount: branch.records.length,
          issue: branch.issue,
        })
        return null
      }

      for (const msg of branch.records) {
        const role = normalizeApiMessageRole(msg)
        if (!role) continue

        const content = extractClaudeMessageMarkdown(msg)
        const blocks = Array.isArray(msg.content)
          ? msg.content
          : Array.isArray(msg.message?.content)
            ? msg.message.content
            : []
        const attachments: ChatMessage['attachments'] = []
        for (const block of blocks) {
          if (!block || typeof block !== 'object') continue
          const typedBlock = block as Record<string, any>
          if (typedBlock.type === 'image') {
            const url = firstString(
              typedBlock.source?.url,
              typedBlock.url,
              typedBlock.file?.url,
              typedBlock.source?.file?.url
            )
            if (url) {
              attachments.push({
                type: 'image',
                url,
                name: firstString(typedBlock.title, typedBlock.file_name, typedBlock.name) || 'Image',
                uploaded: role === 'user',
              })
            }
            continue
          }
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
              mimeType: typedBlock.media_type || typedBlock.mime_type,
              uploaded: role === 'user',
            })
          }
        }

        if (content.trim() || attachments.length > 0) {
          messages.push({
            id: typeof msg.uuid === 'string'
              ? msg.uuid
              : typeof msg.id === 'string'
                ? msg.id
                : generateId(),
            role,
            content: normalizeClaudeMarkdown(content),
            attachments: attachments.length ? attachments : undefined,
            timestamp: claudeTimestamp(
              msg.created_at ?? msg.createdAt ?? msg.create_time ??
              msg.message?.created_at ?? msg.message?.createdAt
            ),
          })
        }
      }

      if (messages.length === 0 && artifacts.length === 0) {
        console.error(`[Claude Parser] API detail for ${id} contained no exportable messages`)
        return null
      }

      return syncSourceCompleteness({
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
        artifacts: artifacts.length > 0 ? artifacts : undefined,
        source: 'api',
        sourceCompleteness: 'verified',
        verification: createVerificationEvidence({
          provider: 'claude',
          source: 'api',
          transcript: {
            verified: true,
            method: 'active-branch-root-chain',
            reasons: branch.issue ? [branch.issue] : ['selected_branch_reaches_root'],
          },
        }),
      })
    } catch (error) {
      if (isProviderRateLimitError(error)) throw error
      console.error('[Claude Parser] Error fetching conversation detail:', error)
      return null
    }
  }

  /** Extract all messages from the current Claude DOM snapshot. */
  private extractMessages(): ChatMessage[] {
    const messages: ChatMessage[] = []
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

  /** Prefer one semantic node per rendered turn and skip nested mirrors. */
  private shouldSkipNestedMessageCandidate(element: Element): boolean {
    if (
      element.matches(CLAUDE_GENERIC_MESSAGE_SELECTOR) &&
      element.querySelector(`${CLAUDE_SEMANTIC_ROLE_SELECTOR}, ${CLAUDE_LEGACY_ROLE_SELECTOR}`)
    ) return true

    if (element.hasAttribute('data-is-streaming') && element.querySelector('[data-testid="assistant-message"]')) return true
    if (element.getAttribute('data-role') === 'assistant' && element.querySelector('[data-testid="assistant-message"]')) return true
    if (element.getAttribute('data-role') === 'user' && element.querySelector('[data-testid="user-message"]')) return true

    if (element.matches(CLAUDE_LEGACY_ROLE_SELECTOR)) {
      const semanticAncestor = element.parentElement?.closest(CLAUDE_SEMANTIC_ROLE_SELECTOR)
      if (semanticAncestor) return true
    }

    if (element.hasAttribute('data-role')) {
      const strongerAncestor = element.parentElement?.closest(
        '[data-testid="user-message"], [data-testid="assistant-message"], [data-is-streaming]'
      )
      if (strongerAncestor) return true
    }

    return false
  }

  /** Parse a message element from Claude's DOM. */
  private parseMessageElement(element: Element): ChatMessage | null {
    const testId = element.getAttribute('data-testid')
    const dataRole = element.getAttribute('data-role')?.toLowerCase() || ''
    let role: ChatMessage['role'] | null = null

    if (testId === 'user-message' || dataRole === 'user' || dataRole === 'human') {
      role = 'user'
    } else if (testId === 'assistant-message' || dataRole === 'assistant' || dataRole === 'ai') {
      role = 'assistant'
    } else if (element.hasAttribute('data-is-streaming') || element.matches(CLAUDE_LEGACY_ROLE_SELECTOR)) {
      role = 'assistant'
    } else if (testId === 'chat-message') {
      const hasUserIndicator = element.querySelector('[data-testid="user-message"], [data-role="user"]')
      const hasAssistantIndicator = element.querySelector(
        '[data-testid="assistant-message"], [data-role="assistant"], [data-is-streaming], ' +
        CLAUDE_LEGACY_ROLE_SELECTOR
      )

      if (hasUserIndicator) role = 'user'
      else if (hasAssistantIndicator) role = 'assistant'
      else role = this.determineRoleFromElement(element)
    }

    if (!role) return null

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
        if (!UUID_REGEX.test(id) || seen.has(id)) return

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

const parser = new ClaudeParser()

export const config = {
  matches: ['https://claude.ai/*']
}

// Claude virtualizes long histories, so DOM detail is diagnostic/rendering data
// only. The API transcript must pass structural verification before export.
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

runParserMain(parser)
