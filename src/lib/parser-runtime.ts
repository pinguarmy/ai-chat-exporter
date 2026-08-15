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
import type { Conversation, ConversationListItem } from './types'
import { analyzeConversationIntegrity, isConversationExportable } from './conversation-integrity'
import { mergeRenderedImageAttachments, preferMoreCompleteConversation } from './parser-fallback'
import { isProviderRateLimitError } from './provider-rate-limit'

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
}

type SendResponse = (response?: any) => void

type BranchHandler = (message: any, sendResponse: SendResponse) => boolean | void

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
  handleParseConversation?: BranchHandler
  handleFetchAllConversations?: BranchHandler
  handleFetchConversationDetail?: BranchHandler
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
      chrome.storage.local.set({
        [`conversation-${conversation.id}`]: { ...conversation, timestamp: Date.now() }
      })
    }
  }
}

function apiDetailError(
  config: ParserRuntimeConfig,
  conversation: Conversation | null,
  apiConversation?: Conversation | null
): any {
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
    }
  }
}

/** Register the shared popup-message listener for a platform parser. */
export function registerParserMessageHandler(config: ParserRuntimeConfig): void {
  const { platform, parser } = config
  // A background-tab hydration loop can ask PARSE_CONVERSATION repeatedly.
  // Cache deterministic authoritative-detail failures briefly so one provider
  // outage does not become an API request every 750 ms.
  const detailFailureCache = new Map<string, { at: number; response: any }>()
  const DETAIL_FAILURE_COOLDOWN_MS = 30_000

  const getCachedFailure = (id: string): any | null => {
    const cached = detailFailureCache.get(id)
    if (!cached) return null
    if (Date.now() - cached.at > DETAIL_FAILURE_COOLDOWN_MS) {
      detailFailureCache.delete(id)
      return null
    }
    return cached.response
  }

  const cacheFailure = (id: string, response: any) => {
    detailFailureCache.set(id, { at: Date.now(), response })
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'PARSE_CONVERSATION') {
      if (config.handleParseConversation) return config.handleParseConversation(message, sendResponse)
      parser.parseCurrentConversation().then(conversation => {
        const id = config.extractConversationId?.(window.location.href)
        if (!id) {
          if (config.requireApiDetailForCurrentExport) sendResponse(apiDetailError(config, conversation))
          else sendResponse({ data: conversation })
          return
        }

        if (config.requireApiDetailForCurrentExport) {
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
            sourceCompleteness: conversation.sourceCompleteness
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