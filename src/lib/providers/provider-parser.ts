/**
 * The public contract every provider content-script parser fulfils.
 *
 * Each `src/contents/<provider>-parser.ts` defines a class that
 * `implements ProviderParser` and hands an instance to the shared content-script
 * runtime (`src/lib/parser-runtime.ts`). DOM helpers such as `extractMessages`
 * are deliberately NOT part of this contract: they are private implementation
 * details whose shape differs per provider, and the runtime never calls them.
 *
 * Invariants every implementation must keep (see AGENTS.md):
 * - the provider API / authoritative source decides message order and
 *   completeness; DOM may only enrich it after a confident match;
 * - `parseCurrentConversation` returns an unverified DOM snapshot and must say
 *   so in its verification evidence;
 * - failures never log private conversation content.
 */
import type { Conversation, ConversationListItem, PageSnapshot } from '../types'

export interface ProviderParser {
  /** True when the current page looks like a conversation of this provider. */
  isConversationPage(): boolean

  /**
   * Parse the rendered DOM. The result is always an unverified snapshot; it is
   * never evidence that an export is complete.
   */
  parseCurrentConversation(): Promise<Conversation | null>

  /** Best-effort title for the open conversation (never throws). */
  getConversationTitle(): string | null

  /** Sidebar-derived list of the currently rendered conversations (DOM only). */
  getConversationList(): ConversationListItem[]

  /**
   * Fetch one conversation by id through the provider's authoritative source.
   * `requestedTitle` is only honoured by providers whose detail response does
   * not carry a title (Gemini).
   */
  fetchConversationDetail(id: string, requestedTitle?: string): Promise<Conversation | null>

  /** Safe aggregate "the user must sign in" signal for scheduled exports. */
  isAuthenticationRequired(): boolean

  /** Absent on parsers that override FETCH_ALL_CONVERSATIONS (e.g. Gemini). */
  fetchAllConversations?: () => Promise<ConversationListItem[]>

  /** Optional source/completeness metadata for the latest list fetch. */
  getConversationListMeta?: () => Record<string, unknown>

  /**
   * Optional observed-DOM page-snapshot capability (Gemini only for now).
   * Implementations must read only the live DOM, never the provider detail or
   * list APIs, and must not be routed through the PARSE_CONVERSATION override
   * or the detail-failure cache.
   */
  capturePageSnapshot?: () => Promise<PageSnapshot>
}
