/**
 * Observed-DOM message extraction for gemini.google.com.
 *
 * This produces the unverified DOM snapshot only. The batchexecute detail RPC
 * is the authoritative transcript; DOM order never replaces it.
 */
import type { ChatMessage } from '../../core/types'
import { normalizeApiTimestamp as geminiTimestamp } from '../api-message-normalizer'
import { cleanText, extractTextWithMedia, generateId } from '../../core/dom-utils'
import { buildDomMessageExtras } from '../dom-message'

/**
 * Extract all messages from the conversation DOM
 * Uses a single pass with deduplication to avoid counting messages twice
 */
export function extractGeminiDomMessages(): ChatMessage[] {
  const messages: ChatMessage[] = []
  const seenElements = new Set<Element>()

  // Scope strictly to the main conversation container. The sidebar (nav/aside)
  // holds duplicate copies of every message that MUST NOT be re-collected.
  const root =
    document.querySelector('chat-window-content') ||
    document.querySelector('chat-window') ||
    document.querySelector('main') ||
    document.querySelector('[role="main"]') ||
    document.querySelector('[class*="conversation"]') ||
    document.body
  if (!root) return messages

  // ONE query that returns BOTH user and assistant elements in document order.
  // This is the key fix: a single querySelectorAll preserves the real
  // interleaved user/assistant/user/assistant order. Splitting into separate
  // user-then-assistant passes would wrongly emit "all users then all
  // assistants".
  const MESSAGE_SELECTOR =
    'user-query, .user-query, [class*="user-message"], [data-message-author-role="user"], ' +
    'model-response, .model-response, [class*="model-message"], [data-message-author-role="model"]'

  let nodes = Array.from(root.querySelectorAll(MESSAGE_SELECTOR)) as Element[]

  // Fallback: if the specific selectors found nothing, broaden to any
  // query/response/content element (still in DOM order).
  if (nodes.length === 0) {
    nodes = Array.from(
      root.querySelectorAll('[class*="query"], [class*="response"], [class*="content"]')
    ) as Element[]
  }

  let prevText = ''
  for (const element of nodes) {
    if (seenElements.has(element)) continue
    seenElements.add(element)

    const roleAttr = element.getAttribute('data-message-author-role')
    const role: ChatMessage['role'] =
      roleAttr === 'user'
        ? 'user'
        : roleAttr === 'model'
          ? 'assistant'
          : /user|query/i.test(element.className) ||
              element.matches('user-query, .user-query, [class*="user-message"], [class*="query"]')
            ? 'user'
            : 'assistant'

    // Dedup: skip only if this node is text-identical to the PREVIOUS one we
    // kept. This removes adjacent duplicate DOM copies (sidebar/artifact/
    // "Gemini said" panels render the same text back-to-back) WITHOUT
    // dropping a genuine repeated message that appears LATER in the
    // conversation (non-consecutive). Compare the FULL normalized text — a
    // 200-char prefix slice would wrongly collapse two different messages
    // that merely share a long opening (e.g. the same code block pasted
    // twice with different follow-up text).
    const text = (element.textContent || '').replace(/\s+/g, ' ').trim()
    if (text && text === prevText) continue
    prevText = text

    const message = parseGeminiMessageElement(element, role)
    if (message) {
      messages.push(message)
    }
  }

  return messages
}

/**
 * Parse a message element
 */
export function parseGeminiMessageElement(
  element: Element,
  role: ChatMessage['role']
): ChatMessage | null {
  // Gemini places Search/Maps result cards beside the prose subtree. Parse
  // the message root so a narrow `.content` child cannot drop those visible
  // cards from the transcript.
  const contentElement = element

  const content = extractGeminiMessageContent(contentElement)

  if (!content.trim()) {
    return null
  }

  const messageId = element.getAttribute('data-message-id') || element.id || generateId()

  return {
    id: messageId,
    role,
    content,
    ...buildDomMessageExtras(contentElement, role),
    timestamp: geminiTimestamp(
      element.querySelector('time[datetime]')?.getAttribute('datetime') ||
        element.getAttribute('data-timestamp') ||
        element.getAttribute('data-created-at')
    )
  }
}

/**
 * Extract clean content from a message element
 */
export function extractGeminiMessageContent(element: Element): string {
  const clone = element.cloneNode(true) as Element

  const removeSelectors = [
    'button',
    '[class*="toolbar"]',
    '[class*="copy"]',
    '[class*="share"]',
    // Gemini injects static UI crumbs that are not message content
    '[class*="crumb"]',
    '[aria-label*="Gemini said"]',
    '[class*="said"]',
    '[class*="notebook"]',
    '[class*="research"]'
  ]

  removeSelectors.forEach(selector => {
    clone.querySelectorAll(selector).forEach(el => el.remove())
  })

  injectGeminiPlaceCardLabels(clone)

  // Read the cloned subtree once while adding line breaks for block nodes.
  // Image nodes become Markdown at their DOM position, so a place photo is
  // exported next to its location details instead of at the final page.
  let content = extractTextWithMedia(clone)

  // Drop standalone UI crumb lines Gemini renders inside the message body
  // (e.g. "Gemini said", "New notebook", "Show research", "Show thinking").
  const UI_CRUMB_PATTERNS = [
    /^gemini said$/i,
    /^new notebook$/i,
    /^show research$/i,
    /^show thinking$/i,
    /^show full response$/i,
    /^view other drafts$/i
  ]
  content = content
    .split('\n')
    .filter(line => !UI_CRUMB_PATTERNS.some(p => p.test(line.trim())))
    .join('\n')

  return cleanText(content)
}

/**
 * Some Gemini Maps cards expose their name/rating only as an accessible link
 * label. Keep it in the transcript before text extraction; ordinary cards
 * whose visible text already contains the label are left untouched.
 */
export function injectGeminiPlaceCardLabels(root: Element): void {
  const selectors = [
    '[data-place-id]',
    '[data-entity-id]',
    'a[href*="/maps"]',
    'a[href*="maps.google"]',
    'a[href*="google.com/maps"]'
  ]
  const seen = new Set<Element>()
  for (const selector of selectors) {
    root.querySelectorAll(selector).forEach(card => {
      if (seen.has(card)) return
      seen.add(card)
      const label = cleanText(card.getAttribute('aria-label') || '')
      if (!label) return
      const visible = cleanText(card.textContent || '')
      if (visible.toLocaleLowerCase().includes(label.toLocaleLowerCase())) return
      card.insertBefore(document.createTextNode(`\n\n${label}\n\n`), card.firstChild)
    })
  }
}
