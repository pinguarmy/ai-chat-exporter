/**
 * DOM message-extraction building blocks shared by the provider parsers.
 *
 * These cover the observed-DOM path only (the unverified snapshot a parser
 * returns from `parseCurrentConversation`). Provider-authoritative API
 * transcripts decide message order and completeness; DOM output may enrich
 * them only after a confident match elsewhere (see parser-fallback.ts).
 *
 * Document order is preserved everywhere: collectors use a single
 * querySelectorAll pass so interleaved user/assistant turns are never
 * regrouped.
 */
import type { Attachment, ChatMessage } from '../core/types'
import {
  cleanText,
  extractCodeBlocks,
  extractImages,
  extractTextWithMedia,
  generateId
} from '../core/dom-utils'

/** Interactive chrome that is never part of a message body. */
export const MESSAGE_CHROME_SELECTORS: readonly string[] = [
  'button',
  '[class*="toolbar"]',
  '[class*="action"]',
  '[class*="copy"]',
  '[class*="edit"]',
  '[class*="regenerate"]'
]

/**
 * Message text from a detached clone with provider UI chrome removed. Images
 * stay in place as Markdown so they are not mistaken for trailing attachments.
 * The live page is never mutated.
 */
export function extractCleanMessageText(
  element: Element,
  removeSelectors: readonly string[] = MESSAGE_CHROME_SELECTORS
): string {
  const clone = element.cloneNode(true) as Element
  removeSelectors.forEach(selector => {
    clone.querySelectorAll(selector).forEach(el => el.remove())
  })
  return cleanText(extractTextWithMedia(clone))
}

/** Rendered images as attachments; `uploaded` is true only for user turns. */
export function extractDomImageAttachments(
  contentElement: Element,
  role: ChatMessage['role']
): Attachment[] {
  return extractImages(contentElement).map(img => ({
    type: 'image' as const,
    url: img.url,
    name: img.alt,
    uploaded: role === 'user'
  }))
}

/** The optional `attachments` / `codeBlocks` fields of a DOM-derived message. */
export function buildDomMessageExtras(
  contentElement: Element,
  role: ChatMessage['role']
): Pick<ChatMessage, 'attachments' | 'codeBlocks'> {
  const codeBlocks = extractCodeBlocks(contentElement)
  const attachments = extractDomImageAttachments(contentElement, role)
  return {
    attachments: attachments.length > 0 ? attachments : undefined,
    codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined
  }
}

export interface AuthorRoleElementOptions {
  /** Clean text of the content element (provider chrome removal). */
  extractContent: (element: Element) => string
  /** When provided, a `timestamp` field is set from the message element. */
  getTimestamp?: (element: Element) => number | undefined
}

/**
 * Parse one element carrying an explicit `data-message-author-role` of `user`
 * or `assistant`. Any other role value (system, tool, missing) is skipped, as
 * is an element with no visible text.
 */
export function parseAuthorRoleElement(
  element: Element,
  options: AuthorRoleElementOptions
): ChatMessage | null {
  const role = element.getAttribute('data-message-author-role') as ChatMessage['role']
  if (!role || (role !== 'user' && role !== 'assistant')) return null

  const contentElement =
    element.querySelector('.markdown, [class*="markdown"], [class*="content"]') || element

  const content = options.extractContent(contentElement)
  if (!content.trim()) return null

  const message: ChatMessage = {
    id: element.getAttribute('data-message-id') || generateId(),
    role,
    content,
    ...buildDomMessageExtras(contentElement, role)
  }
  if (options.getTimestamp) message.timestamp = options.getTimestamp(element)
  return message
}

/**
 * Collect every `[data-message-author-role]` element in document order.
 *
 * Returns `null` when the page has no such element, so the caller can run its
 * provider-specific fallback. When elements exist but none parse, the result
 * is an empty array and NO fallback should run (the explicit markup is
 * authoritative about what the page rendered).
 */
export function collectAuthorRoleMessages(
  root: ParentNode,
  parse: (element: Element) => ChatMessage | null
): ChatMessage[] | null {
  const elements = root.querySelectorAll('[data-message-author-role]')
  if (elements.length === 0) return null
  const messages: ChatMessage[] = []
  elements.forEach(element => {
    const message = parse(element)
    if (message) messages.push(message)
  })
  return messages
}

const SPECIFIC_ROLE_SELECTOR = '[class*="message-user"], [class*="message-assistant"]'

export interface ClassCandidateOptions {
  /** One combined selector, so querySelectorAll preserves document order. */
  selector: string
  resolveRole: (element: Element) => ChatMessage['role'] | null
  extractContent: (element: Element) => string
  /** Elements already visited; shared so a later fallback can skip them. */
  seen?: Set<Element>
}

/**
 * Class-name based fallback: query user and assistant candidates in ONE pass
 * (running one selector at a time would stop after the first user node and
 * silently drop every assistant response).
 *
 * A generic wrapper that contains a more specific `message-user` /
 * `message-assistant` node is skipped, otherwise the same turn would be
 * emitted twice. Elements without a detectable role or visible text are
 * skipped.
 */
export function collectClassCandidateMessages(
  root: ParentNode,
  options: ClassCandidateOptions
): ChatMessage[] {
  const seen = options.seen ?? new Set<Element>()
  const messages: ChatMessage[] = []
  Array.from(root.querySelectorAll(options.selector)).forEach(element => {
    if (seen.has(element)) return
    const specificChild = element.querySelector(SPECIFIC_ROLE_SELECTOR)
    if (specificChild && !element.matches(SPECIFIC_ROLE_SELECTOR)) return
    seen.add(element)
    const role = options.resolveRole(element)
    if (!role) return
    const content = options.extractContent(element)
    if (!content.trim()) return
    messages.push({
      id: element.getAttribute('data-message-id') || generateId(),
      role,
      content
    })
  })
  return messages
}
