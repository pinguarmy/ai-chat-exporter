/**
 * Gemini batchexecute wire format: request construction and response decoding.
 *
 * Everything here is pure (no network, no DOM, no extension storage) so the
 * frame decoding can be regression-tested against captured payloads. The
 * networking, authentication and pagination loop stay in the content script.
 *
 * Only documented turn fields are read from the detail RPC. Recursively
 * collecting strings would also pull in citations, source pages and internal
 * reasoning, which must not enter an export.
 */
import type { ChatMessage, ConversationListItem } from '../../core/types'
import { normalizeApiTimestamp as geminiTimestamp } from '../api-message-normalizer'
import { generateId, stripProviderArtifacts } from '../../core/dom-utils'

// The live Gemini app currently asks for both conversation-list streams. Keep
// the same page size and envelope shape so bulk history does not depend on the
// virtualized sidebar being scrolled into view.
export const GEMINI_LIST_PAGE_SIZE = 25
export const GEMINI_LIST_MAX_PAGES_PER_STREAM = 200
export const GEMINI_LIST_MODES = [1, 0] as const
export const GEMINI_DETAIL_TURN_LIMIT = 1000

/** Result metadata lets the popup distinguish the account API from its
 * intentionally incomplete, virtualized-sidebar fallback. */
export interface GeminiConversationListResult {
  conversations: ConversationListItem[]
  source: 'api' | 'sidebar'
  complete: boolean
}

export interface GeminiConversationListStreamResult {
  conversations: ConversationListItem[]
  complete: boolean
  receivedPayload: boolean
}

/** Gemini's list RPC exposes its row timestamp as [seconds, nanoseconds].
 * It is deliberately parsed as provider activity metadata, not renamed to a
 * conversation creation date that the list endpoint does not document. */
function geminiListTimestamp(value: unknown): number | undefined {
  if (!Array.isArray(value)) return geminiTimestamp(value)
  const seconds = geminiTimestamp(value[0])
  if (seconds === undefined) return undefined
  const nanos =
    typeof value[1] === 'number' && Number.isFinite(value[1])
      ? Math.max(0, Math.floor(value[1] / 1_000_000))
      : 0
  return seconds + nanos
}

/**
 * Build the correct URL params for Gemini batchexecute API.
 */
export function buildGeminiBatchExecuteUrl(
  rpcids: string,
  sourcePath: string,
  sessionId: string
): string {
  const params = new URLSearchParams({
    rpcids,
    'source-path': sourcePath,
    'f.sid': sessionId,
    _reqid: String(Math.floor(Math.random() * 100000)),
    rt: 'c'
  })
  return `https://gemini.google.com/_/BardChatUi/data/batchexecute?${params.toString()}`
}

/**
 * Build the form body for a batchexecute request.
 */
export function buildGeminiBatchExecuteBody(requestPayload: string, authToken: string): string {
  const body = new URLSearchParams()
  body.set('f.req', requestPayload)
  body.set('at', authToken)
  return body.toString()
}

/**
 * Gemini's current batchexecute page requests use a three-level batch
 * envelope: [[[rpcId, jsonArgs, null, 'generic']]]. The older two-level
 * form can return HTTP 200 with an empty payload, which then made the popup
 * silently fall back to only the virtualized sidebar rows.
 */
export function buildGeminiRpcRequest(rpcId: string, args: unknown): string {
  return JSON.stringify([[[rpcId, JSON.stringify(args), null, 'generic']]])
}

/**
 * Parse one typed inner payload from a batchexecute response.
 */
export function parseGeminiRpcPayload(text: string, rpcId: string): unknown | null {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    const jsonStart = trimmed.indexOf('[[')
    if (jsonStart === -1) continue

    try {
      const outer = JSON.parse(trimmed.substring(jsonStart))
      for (const entry of outer) {
        if (
          Array.isArray(entry) &&
          entry[0] === 'wrb.fr' &&
          entry[1] === rpcId &&
          typeof entry[2] === 'string'
        ) {
          return JSON.parse(entry[2])
        }
      }
    } catch {
      // Length markers and diagnostic lines are not JSON payloads.
    }
  }

  return null
}

/** Keep the known cursor positions explicit rather than recursively guessing strings. */
export function extractGeminiListPageToken(payload: unknown): string | null {
  if (!Array.isArray(payload)) return null
  const nested = Array.isArray(payload[0]) ? payload[0] : []
  const candidates = [payload[1], nested[1]]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate
  }
  return null
}

/** Deduplicate the two streams, retaining the most recent reported activity. */
export function mergeGeminiConversationListItems(
  items: ConversationListItem[]
): ConversationListItem[] {
  const byId = new Map<string, ConversationListItem>()
  for (const item of items) {
    const existing = byId.get(item.id)
    const activity = item.updatedAt ?? -Infinity
    if (!existing || activity > (existing.updatedAt ?? -Infinity)) {
      byId.set(item.id, item)
    }
  }
  return Array.from(byId.values())
}

/**
 * Parse the batchexecute response to extract conversation items
 */
export function parseGeminiConversationListPayload(data: unknown): ConversationListItem[] {
  const items: ConversationListItem[] = []

  try {
    // The response structure varies, try to find conversation entries
    const findConversations = (obj: unknown): void => {
      if (!obj || typeof obj !== 'object') return

      if (Array.isArray(obj)) {
        // Look for arrays that contain conversation-like data
        for (const item of obj) {
          if (Array.isArray(item) && item.length >= 2) {
            // Check if this looks like a conversation entry (has ID and title)
            const maybeId = item[0]
            const maybeTitle = item[1] || item[2]
            if (
              typeof maybeId === 'string' &&
              /^c_[a-zA-Z0-9_-]+$/.test(maybeId) &&
              typeof maybeTitle === 'string'
            ) {
              const normalizedId = maybeId.replace(/^c_/, '')
              const updatedAt = geminiListTimestamp(item[5])
              items.push({
                id: normalizedId,
                title: maybeTitle,
                url: `https://gemini.google.com/app/${normalizedId}`,
                platform: 'gemini',
                ...(updatedAt === undefined ? {} : { updatedAt })
              })
            }
          }
          findConversations(item)
        }
      } else {
        const record = obj as Record<string, unknown>
        for (const key of Object.keys(record)) {
          findConversations(record[key])
        }
      }
    }

    findConversations(data)
  } catch {
    // Parsing failed
  }

  return items
}

/**
 * Extract only the documented turn fields observed in Gemini's detail RPC.
 * Turns arrive newest first and are reversed into display order.
 */
/** Read a value from nested provider arrays; any non-array on the path yields undefined. */
function pick(value: unknown, ...path: number[]): unknown {
  let current = value
  for (const index of path) {
    if (!Array.isArray(current)) return undefined
    current = current[index]
  }
  return current
}

export function extractGeminiMessagesFromDetailPayload(payload: unknown): ChatMessage[] {
  const turns = pick(payload, 0)
  if (!Array.isArray(turns)) return []

  const messages: ChatMessage[] = []
  for (const turn of [...turns].reverse()) {
    if (!Array.isArray(turn)) continue

    const timestampSeconds = pick(turn, 4, 0)
    const timestamp = typeof timestampSeconds === 'number' ? timestampSeconds * 1000 : undefined
    const rawResponseId = pick(turn, 0, 1)
    const responseId = typeof rawResponseId === 'string' ? rawResponseId : generateId()
    const userText = pick(turn, 2, 0, 0)
    const assistantMarkdown = pick(turn, 3, 0, 0, 1, 0)

    if (typeof userText === 'string' && userText.trim()) {
      messages.push({
        id: `${responseId}-user`,
        role: 'user',
        content: stripProviderArtifacts(userText).trim(),
        timestamp
      })
    }

    if (typeof assistantMarkdown === 'string' && assistantMarkdown.trim()) {
      messages.push({
        id: responseId,
        role: 'assistant',
        content: stripProviderArtifacts(assistantMarkdown).trim(),
        timestamp
      })
    }
  }

  return messages
}
