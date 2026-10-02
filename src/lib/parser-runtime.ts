/**
 * Shared content-script runtime for the platform parsers.
 *
 * Each contents/*-parser.ts used to end with a verbatim copy of the page-load
 * main() routine and the popup message listener (PARSE_CONVERSATION,
 * DETECT_PLATFORM, FETCH_CONVERSATION_LIST, FETCH_ALL_CONVERSATIONS,
 * FETCH_CONVERSATION_DETAIL). This module hosts that shared pipeline; a parser
 * only supplies its platform name, parser instance, URL conversation-ID
 * extractor, and — where its flow genuinely differs (e.g. Gemini) — branch
 * handler overrides.
 */
import type { Conversation, ConversationListItem, PageSnapshot } from './types'
import { analyzeConversationIntegrity, isConversationExportable } from './conversation-integrity'
import { mergeRenderedImageAttachments, preferMoreCompleteConversation } from './parser-fallback'
import { isProviderRateLimitError } from './provider-rate-limit'
import { requestPreviewSnapshot } from './preview-snapshots'
import { PageSnapshotCaptureError, sameSnapshotSessionContext, type SnapshotSessionContext } from './snapshot-session'

/** Subset of parser methods the shared runtime depends on. */
export interface ParserRuntimeParser {
  isConversationPage(): boolean
  parseCurrentConversation(): Promise<Conversation | null>
  getConversationTitle(): string | null
  getConversationList(): ConversationListItem[]
  /** Absent on parsers that override FETCH_ALL_CONVERSATIONS (e.g. Gemini). */
  fetchAllConversations?: () => Promise<ConversationListItem[]>
  /** Optional source/completeness metadata for the latest list fetch. */
  getConversationListMeta?: () => Record<string, unknown>
  fetchConversationDetail(id: string): Promise<Conversation | null>
  isAuthenticationRequired(): boolean
  /**
   * Optional observed-DOM page-snapshot capability (Gemini only for now).
   * Implementations must read only the live DOM — never the provider detail/
   * list APIs — and must not be routed through the PARSE_CONVERSATION
   * override or the detail-failure cache.
   */
  capturePageSnapshot?: () => Promise<PageSnapshot>
}

type ParseRequest = { type: 'PARSE_CONVERSATION'; data?: { forceVerify?: boolean } }
type DetailRequest = { type: 'FETCH_CONVERSATION_DETAIL'; data: { id: string; title?: string } }
type ListRequest = { type: 'FETCH_ALL_CONVERSATIONS' }
type CaptureSnapshotRequest = { type: 'CAPTURE_PAGE_SNAPSHOT'; data: { requestId: string } }
export type ParserRequest = ParseRequest | DetailRequest | ListRequest | CaptureSnapshotRequest
  | { type: 'DETECT_PLATFORM' } | { type: 'FETCH_CONVERSATION_LIST' }

export interface ParserResponse {
  data?: Conversation | ConversationListItem[] | null | PageSnapshot | { platform: string; isConversationPage: boolean; title: string | null }
  error?: string
  meta?: Record<string, unknown>
}

type SendResponse = (response?: ParserResponse) => void
type BranchHandler<T extends ParserRequest> = (message: T, sendResponse: SendResponse) => boolean | void

const REQUEST_TYPES = new Set(['PARSE_CONVERSATION', 'FETCH_CONVERSATION_DETAIL', 'FETCH_ALL_CONVERSATIONS', 'DETECT_PLATFORM', 'FETCH_CONVERSATION_LIST', 'CAPTURE_PAGE_SNAPSHOT'])

function isParserRequest(message: { type: unknown; data?: unknown }): message is ParserRequest {
  const data = message.data
  if (message.type === 'FETCH_CONVERSATION_DETAIL') {
    if (!data || typeof data !== 'object') return false
    const detail = data as { id?: unknown; title?: unknown }
    return typeof detail.id === 'string' && Boolean(detail.id.trim())
      && (detail.title === undefined || typeof detail.title === 'string')
  }
  if (message.type === 'CAPTURE_PAGE_SNAPSHOT') {
    if (!data || typeof data !== 'object') return false
    const requestId = (data as { requestId?: unknown }).requestId
    return typeof requestId === 'string' && requestId.trim().length > 0 && requestId.length <= 128
  }
  if (message.type === 'PARSE_CONVERSATION' && data !== undefined) {
    if (!data || typeof data !== 'object') return false
    const force = (data as { forceVerify?: unknown }).forceVerify
    return force === undefined || typeof force === 'boolean'
  }
  return typeof message.type === 'string' && REQUEST_TYPES.has(message.type)
}

export interface ParserRuntimeConfig {
  platform: string
  parser: ParserRuntimeParser
  /** Extract the current conversation ID from the page URL. */
  extractConversationId?: (url: string) => string | null | undefined
  logApiError?: (error: unknown) => void
  logParseError?: (error: unknown) => void
  /** Require a provider-verified detail source instead of trusting live DOM. */
  requireApiDetailForCurrentExport?: boolean
  /** Prefer a healthy provider API result even when rendered DOM is longer. */
  preferApiDetailWhenComplete?: boolean
  /** Provider-specific user-facing error when authoritative detail is unavailable. */
  apiDetailUnavailableError?: string
  handleParseConversation?: BranchHandler<ParseRequest>
  handleFetchAllConversations?: BranchHandler<ListRequest>
  handleFetchConversationDetail?: BranchHandler<DetailRequest>
  /**
   * Current page-session context used to reject snapshot results that
   * straddle a conversation boundary. Required for CAPTURE_PAGE_SNAPSHOT to
   * return data; without it capture requests are answered with an error so a
   * stale session can never be reported as captured.
   */
  getSnapshotContext?: () => SnapshotSessionContext
}

/**
 * Page-load routine. Providers may mark a cached DOM snapshot unverified; the
 * preview/export gates honor that marker and will not silently archive it.
 */
export async function runParserMain(
  parser: Pick<ParserRuntimeParser, 'isConversationPage' | 'parseCurrentConversation'>
): Promise<void> {
  if (parser.isConversationPage()) {
    const conversation = await parser.parseCurrentConversation()
    if (conversation) {
      await requestPreviewSnapshot(conversation).catch(() => undefined)
    }
  }
}

function apiDetailError(
  config: ParserRuntimeConfig,
  conversation: Conversation | null,
  apiConversation?: Conversation | null
): ParserResponse {
  const apiIntegrity = analyzeConversationIntegrity(apiConversation)
  return {
    error: config.apiDetailUnavailableError ||
      'The complete conversation could not be verified from the provider API, so export was stopped to avoid silent data loss.',
    meta: {
      source: 'dom',
      apiDetailRequired: true,
      pageFallbackSupported: false,
      domMessageCount: conversation?.messages?.length || 0,
      apiMessageCount: apiIntegrity.messageCount,
      apiIntegrityStatus: apiIntegrity.status,
      apiIntegrityReasons: apiIntegrity.reasons,
      verification: apiConversation?.verification ?? conversation?.verification,
    }
  }
}

/** Register the shared popup-message listener for a platform parser. */
export function registerParserMessageHandler(config: ParserRuntimeConfig): void {
  const { platform, parser } = config
  // A background-tab hydration loop can ask PARSE_CONVERSATION repeatedly.
  // Cache deterministic authoritative-detail failures briefly so one provider
  // outage does not become an API request every 750 ms. User-triggered reads
  // can explicitly bypass this cache so the Retry button is a real retry.
  const detailFailureCache = new Map<string, { at: number; response: ParserResponse }>()
  const DETAIL_FAILURE_COOLDOWN_MS = 30_000

  const getCachedFailure = (id: string): ParserResponse | null => {
    const cached = detailFailureCache.get(id)
    if (!cached) return null
    if (Date.now() - cached.at > DETAIL_FAILURE_COOLDOWN_MS) {
      detailFailureCache.delete(id)
      return null
    }
    return cached.response
  }

  const cacheFailure = (id: string, response: ParserResponse) => {
    detailFailureCache.set(id, { at: Date.now(), response })
  }

  chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse: SendResponse) => {
    if (!raw || typeof raw !== 'object') return
    const candidate = raw as { type: unknown; data?: unknown }
    if (typeof candidate.type !== 'string' || !REQUEST_TYPES.has(candidate.type)) return
    if (!isParserRequest(candidate)) {
      sendResponse({ error: 'Invalid provider request' })
      return
    }
    const message = candidate as ParserRequest
    if (message.type === 'CAPTURE_PAGE_SNAPSHOT') {
      // Deliberately separate from PARSE_CONVERSATION: no provider detail/list
      // API, no handleParseConversation override, no detail-failure cache.
      const requestId = message.data.requestId
      const capture = parser.capturePageSnapshot
      const getContext = config.getSnapshotContext
      if (!capture) {
        sendResponse({
          error: 'Page snapshot capture is not supported by this provider.',
          meta: { requestId }
        })
        return
      }
      if (!getContext) {
        sendResponse({
          error: 'Page snapshot capture is unavailable: the page session context could not be verified.',
          meta: { requestId }
        })
        return
      }
      const before = getContext()
      Promise.resolve()
        .then(() => capture.call(parser))
        .then(snapshot => {
          const after = getContext()
          if (!sameSnapshotSessionContext(before, after)) {
            sendResponse({
              error: 'The conversation changed while the page snapshot was being captured. Please retry.',
              meta: { requestId }
            })
            return
          }
          sendResponse({
            data: snapshot,
            meta: {
              requestId,
              documentId: after.documentId,
              sessionId: after.sessionId,
              sessionEpoch: after.sessionEpoch
            }
          })
        })
        .catch(error => {
          // Only our own capture errors carry non-private text; everything
          // else is replaced so page content can never leak into the reply.
          const message = error instanceof PageSnapshotCaptureError
            ? error.message
            : 'Page snapshot capture failed. The page may not contain capturable conversation content.'
          sendResponse({ error: message, meta: { requestId } })
        })
      return true
    }

    if (message.type === 'PARSE_CONVERSATION') {
      if (config.handleParseConversation) return config.handleParseConversation(message, sendResponse)
      const id = config.extractConversationId?.(window.location.href)
      if (config.requireApiDetailForCurrentExport && !id) {
        sendResponse({ data: null, meta: { noConversation: true } })
        return
      }
      parser.parseCurrentConversation().then(conversation => {
        if (!id) {
          if (!conversation) {
            sendResponse({ data: null, meta: { noConversation: true } })
            return
          }
          if (config.requireApiDetailForCurrentExport) sendResponse(apiDetailError(config, conversation))
          else sendResponse({ data: conversation })
          return
        }

        const forceVerify = message.data?.forceVerify === true
        if (config.requireApiDetailForCurrentExport && !forceVerify) {
          const cachedFailure = getCachedFailure(id)
          if (cachedFailure) {
            sendResponse(cachedFailure)
            return
          }
        }

        parser.fetchConversationDetail(id).then(apiConv => {
          const apiIntegrity = analyzeConversationIntegrity(apiConv)
          const apiExportable = isConversationExportable(apiConv)
          if (config.requireApiDetailForCurrentExport && !apiExportable) {
            const response = apiDetailError(config, conversation, apiConv)
            cacheFailure(id, response)
            sendResponse(response)
            return
          }

          detailFailureCache.delete(id)
          const preferred = config.preferApiDetailWhenComplete && apiExportable
            ? apiConv
            : preferMoreCompleteConversation(conversation, apiConv)
          const renderedFallback = preferred === apiConv ? conversation : apiConv
          sendResponse({
            data: mergeRenderedImageAttachments(preferred, renderedFallback),
            meta: {
              source: preferred === apiConv ? 'api' : 'dom',
              sourceCompleteness: preferred?.sourceCompleteness,
              verification: preferred?.verification,
              domMessageCount: conversation?.messages?.length || 0,
              apiMessageCount: apiIntegrity.messageCount,
              apiIntegrityStatus: apiIntegrity.status,
            }
          })
        }).catch(error => {
          config.logApiError?.(error)
          if (config.requireApiDetailForCurrentExport) {
            const response = apiDetailError(config, conversation)
            cacheFailure(id, response)
            sendResponse(response)
          } else {
            sendResponse({ data: conversation })
          }
        })
      }).catch(error => {
        config.logParseError?.(error)
        sendResponse({ error: error instanceof Error ? error.message : String(error) })
      })
      return true
    }

    if (message.type === 'DETECT_PLATFORM') {
      sendResponse({
        data: {
          platform,
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
      if (config.handleFetchAllConversations) return config.handleFetchAllConversations(message, sendResponse)
      const fetchAll = parser.fetchAllConversations
      if (!fetchAll) {
        sendResponse({ error: 'Full conversation history is unavailable for this provider.' })
        return
      }
      fetchAll.call(parser).then(list => {
        sendResponse({
          data: list,
          meta: {
            ...(parser.getConversationListMeta?.() || {}),
            authRequired: parser.isAuthenticationRequired()
          }
        })
      }).catch(error => {
        if (isProviderRateLimitError(error)) {
          sendResponse({
            error: error.message,
            meta: {
              ...(parser.getConversationListMeta?.() || {}),
              authRequired: parser.isAuthenticationRequired()
            }
          })
          return
        }
        try {
          const fallbackList = parser.getConversationList()
          sendResponse({
            data: fallbackList,
            meta: { source: 'sidebar', complete: false, authRequired: parser.isAuthenticationRequired() }
          })
        } catch {
          sendResponse({ error: (error as Error).message, meta: { authRequired: parser.isAuthenticationRequired() } })
        }
      })
      return true
    }

    if (message.type === 'FETCH_CONVERSATION_DETAIL') {
      if (config.handleFetchConversationDetail) return config.handleFetchConversationDetail(message, sendResponse)
      const requestedId = message.data?.id
      parser.fetchConversationDetail(requestedId).then(conversation => {
        if (config.requireApiDetailForCurrentExport && !isConversationExportable(conversation)) {
          const response = apiDetailError(config, null, conversation)
          if (typeof requestedId === 'string' && requestedId) cacheFailure(requestedId, response)
          sendResponse(response)
          return
        }
        if (typeof requestedId === 'string' && requestedId) detailFailureCache.delete(requestedId)
        sendResponse({
          data: conversation,
          meta: conversation ? {
            source: conversation.source,
            sourceCompleteness: conversation.sourceCompleteness,
            verification: conversation.verification
          } : undefined
        })
      }).catch(error => {
        config.logApiError?.(error)
        if (config.requireApiDetailForCurrentExport) {
          const response = {
            ...apiDetailError(config, null),
            error: isProviderRateLimitError(error) ? error.message : apiDetailError(config, null).error
          }
          if (typeof requestedId === 'string' && requestedId) cacheFailure(requestedId, response)
          sendResponse(response)
        } else {
          sendResponse({ error: error instanceof Error ? error.message : String(error) })
        }
      })
      return true
    }
  })
}
