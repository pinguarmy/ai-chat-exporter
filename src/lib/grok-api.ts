import type { ChatMessage, Conversation, ConversationListItem } from './types'
import { createVerificationEvidence, syncSourceCompleteness } from './verification'
import { stripProviderArtifacts } from './dom-utils'
import { isProviderRateLimitError, isRateLimitedResponse, ProviderRateLimitError } from './provider-rate-limit'

type JsonRecord = Record<string, unknown>

type FetchResponse = {
  ok: boolean
  status?: number
  json: () => Promise<unknown>
}

type FetchLike = (input: string, init?: RequestInit) => Promise<FetchResponse>

const GROK_LIST_PAGE_SIZE = 100
const MAX_GROK_LIST_PAGES = 200

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function timestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value
  }
  const date = nonEmptyString(value)
  if (!date) return undefined

  const numeric = Number(date)
  if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric

  const result = new Date(date).getTime()
  return Number.isNaN(result) ? undefined : result
}

function responseRole(sender: unknown): ChatMessage['role'] | null {
  const normalized = nonEmptyString(sender)?.toLowerCase()
  if (normalized === 'human' || normalized === 'user') return 'user'
  if (normalized === 'assistant' || normalized === 'bot' || normalized === 'grok') return 'assistant'
  return null
}

function listRecords(payload: unknown): JsonRecord[] {
  if (!isRecord(payload)) return []

  return Object.values(payload).flatMap(value =>
    Array.isArray(value) ? value.filter(isRecord) : []
  )
}

/**
 * Fetch the conversations exposed by Grok's current same-origin web API.
 * The response envelope has changed over time, so we accept only direct
 * top-level record arrays and require an explicit conversation identifier.
 */
export async function fetchGrokConversationList(
  fetchFn: FetchLike = fetch
): Promise<ConversationListItem[]> {
  const seenConversationIds = new Set<string>()
  const seenPageTokens = new Set<string>()
  const conversations: ConversationListItem[] = []
  let pageToken: string | null = null

  try {
    for (let page = 0; page < MAX_GROK_LIST_PAGES; page++) {
      const url = `https://grok.com/rest/app-chat/conversations?pageSize=${GROK_LIST_PAGE_SIZE}` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '')
      const response = await fetchFn(url, {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      })
      if (isRateLimitedResponse(response)) throw new ProviderRateLimitError()
      if (response.status === 401 || response.status === 403) throw new Error('Authentication required')
      if (!response.ok) throw new Error('Grok history request failed')

      const payload = await response.json()
      if (!isRecord(payload)) throw new Error('Grok history request failed')
      for (const record of listRecords(payload)) {
        const id = nonEmptyString(record.conversationId) || nonEmptyString(record.id)
        if (!id || seenConversationIds.has(id)) continue

        seenConversationIds.add(id)
        conversations.push({
          id,
          title: nonEmptyString(record.title) || nonEmptyString(record.name) || 'Untitled Conversation',
          url: `https://grok.com/c/${encodeURIComponent(id)}`,
          platform: 'grok',
          createdAt: timestamp(record.createTime) ?? timestamp(record.createdAt) ?? timestamp(record.created_at)
        })
      }

      const nextPageToken = nonEmptyString(payload.nextPageToken)
      if (!nextPageToken) return conversations
      if (seenPageTokens.has(nextPageToken)) throw new Error('Grok history pagination loop')

      seenPageTokens.add(nextPageToken)
      pageToken = nextPageToken
    }
  } catch (error) {
    if (isProviderRateLimitError(error)) throw error
    if (error instanceof Error && error.message === 'Authentication required') throw error
    throw error instanceof Error ? error : new Error('Grok history request failed')
  }

  throw new Error('Grok history pagination exceeded safe page limit')
}

/**
 * Load a Grok conversation by ID without navigating the browser. Grok exposes
 * metadata, response-node IDs, and message bodies as separate same-origin API
 * calls; keeping that sequence here prevents bulk export from reading the open
 * chat's DOM for every selected row.
 */
export async function fetchGrokConversationDetail(
  id: string,
  fetchFn: FetchLike = fetch
): Promise<Conversation | null> {
  if (!id.trim()) return null

  const encodedId = encodeURIComponent(id)
  const requestInit: RequestInit = {
    credentials: 'include',
    headers: { Accept: 'application/json' }
  }

  try {
    const detailResponse = await fetchFn(
      `https://grok.com/rest/app-chat/conversations_v2/${encodedId}`,
      requestInit
    )
    if (isRateLimitedResponse(detailResponse)) throw new ProviderRateLimitError()
    if (!detailResponse.ok) return null

    const detailPayload = await detailResponse.json()
    const detail = isRecord(detailPayload) && isRecord(detailPayload.conversation)
      ? detailPayload.conversation
      : null
    const conversationId = detail && (nonEmptyString(detail.conversationId) || nonEmptyString(detail.id))
    if (!detail || conversationId !== id) return null

    const nodeResponse = await fetchFn(
      `https://grok.com/rest/app-chat/conversations/${encodedId}/response-node`,
      requestInit
    )
    if (isRateLimitedResponse(nodeResponse)) throw new ProviderRateLimitError()
    if (!nodeResponse.ok) return null

    const nodePayload = await nodeResponse.json()
    const nodes = isRecord(nodePayload) && Array.isArray(nodePayload.responseNodes)
      ? nodePayload.responseNodes.filter(isRecord)
      : []
    const responseIds = Array.from(new Set(nodes
      .map(node => nonEmptyString(node.responseId))
      .filter((responseId): responseId is string => responseId !== null)))
    if (responseIds.length === 0) return null

    const messagesResponse = await fetchFn(
      `https://grok.com/rest/app-chat/conversations/${encodedId}/load-responses`,
      {
        ...requestInit,
        method: 'POST',
        headers: {
          ...requestInit.headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ responseIds })
      }
    )
    if (isRateLimitedResponse(messagesResponse)) throw new ProviderRateLimitError()
    if (!messagesResponse.ok) return null

    const messagesPayload = await messagesResponse.json()
    const responseRecords = isRecord(messagesPayload) && Array.isArray(messagesPayload.responses)
      ? messagesPayload.responses.filter(isRecord)
      : []
    const responseById = new Map(
      responseRecords
        .map(record => [nonEmptyString(record.responseId), record] as const)
        .filter((entry): entry is readonly [string, JsonRecord] => entry[0] !== null)
    )
    const messages: ChatMessage[] = []
    let missingResponses = 0

    for (const responseId of responseIds) {
      const response = responseById.get(responseId)
      if (!response) {
        missingResponses += 1
        continue
      }

      const role = responseRole(response.sender)
      const rawContent = nonEmptyString(response.message)
      if (!role || !rawContent) {
        missingResponses += 1
        continue
      }

      // Grok's API sometimes embeds citation-card XML in the message body.
      // Keep the Markdown, but remove provider-only UI markup before the
      // conversation reaches any export format.
      const content = stripProviderArtifacts(rawContent).trim()
      if (!content) continue

      messages.push({
        id: responseId,
        role,
        content,
        timestamp: timestamp(response.createTime)
      })
    }

    if (messages.length === 0) return null
    const complete = missingResponses === 0

    return syncSourceCompleteness({
      id,
      title: nonEmptyString(detail.title) || 'Untitled Conversation',
      url: `https://grok.com/c/${encodedId}`,
      messages,
      createdAt: timestamp(detail.createTime),
      modelName: nonEmptyString(detail.modelName)
        || nonEmptyString(detail.model)
        || nonEmptyString(detail.model_name)
        || undefined,
      platform: 'grok',
      source: 'api',
      sourceCompleteness: complete ? 'verified' : 'unverified',
      verification: createVerificationEvidence({
        provider: 'grok',
        source: 'api',
        transcript: {
          verified: complete,
          method: complete ? 'provider-api-complete' : 'provider-api-incomplete',
          reasons: complete ? ['source_verified'] : ['missing_response_bodies'],
        },
      }),
    })
  } catch (error) {
    if (isProviderRateLimitError(error)) throw error
    return null
  }
}
