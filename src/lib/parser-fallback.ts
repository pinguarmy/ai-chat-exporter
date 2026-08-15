import type { Conversation, ChatMessage } from './types'
import { analyzeConversationIntegrity } from './conversation-integrity'

/**
 * Decide whether a DOM-parsed conversation is likely incomplete and should be
 * replaced by an API detail fetch.
 *
 * A common real-world failure is a SPA rendering only the user's message while
 * assistant output lives in a virtualized/artifact tree. Returning that partial
 * DOM result causes exports with one user message and no AI response.
 */
export function shouldUseApiFallback(conversation: Conversation | null | undefined): boolean {
  return analyzeConversationIntegrity(conversation).shouldAttemptFallback
}

export function preferMoreCompleteConversation<T extends Conversation | null | undefined>(
  domConversation: T,
  apiConversation: Conversation | null | undefined
): Conversation | T {
  if (!apiConversation) return domConversation
  if (!domConversation) return apiConversation

  const domIntegrity = analyzeConversationIntegrity(domConversation)
  const apiIntegrity = analyzeConversationIntegrity(apiConversation)
  const domHasAssistant = domIntegrity.assistantCount > 0
  const apiHasAssistant = apiIntegrity.assistantCount > 0

  if (domHasAssistant && !apiHasAssistant) return domConversation
  if (!domHasAssistant && apiHasAssistant) return apiConversation

  // Prefer the result with more usable content, not a branch-expanded result
  // that is merely longer. Assistant/user counts are weighted before raw
  // message count so a user-only DOM cannot beat a complete API response.
  const domScore = domIntegrity.assistantCount * 4 + domIntegrity.userCount * 2 + domIntegrity.nonEmptyContentCount
  const apiScore = apiIntegrity.assistantCount * 4 + apiIntegrity.userCount * 2 + apiIntegrity.nonEmptyContentCount
  if (apiScore !== domScore) return apiScore > domScore ? apiConversation : domConversation

  return apiConversation.messages.length >= domConversation.messages.length ? apiConversation : domConversation
}

/**
 * Preserve rendered image URLs when the API wins for richer Markdown/text.
 *
 * Provider APIs often preserve text and ordering better than the live DOM,
 * while the DOM can contain the final browser-resolved image URL. Long chats
 * make simple array-index matching unsafe because the page may render only the
 * last few turns. Match by provider message ID first, then by unique text,
 * unique strong text similarity, and finally same-role position counted from
 * the end of the rendered window.
 */
export function mergeRenderedImageAttachments(
  preferred: Conversation | null | undefined,
  rendered: Conversation | null | undefined
): Conversation | null | undefined {
  if (!preferred || !rendered) return preferred

  const renderedMatches = alignRenderedMessages(preferred.messages, rendered.messages)
  let changed = false
  const messages = preferred.messages.map((message, preferredIndex) => {
    const renderedIndex = renderedMatches.get(preferredIndex)
    if (renderedIndex === undefined) return message

    const renderedMessage = rendered.messages[renderedIndex]
    const renderedImages = (renderedMessage.attachments || [])
      .filter(attachment => attachment.type === 'image' && Boolean(attachment.url))
    if (renderedImages.length === 0) return message

    const existing = message.attachments || []
    const known = new Set(existing.map(attachment => `${attachment.type}\u0000${attachment.url}`))
    const additions = renderedImages.filter(attachment => !known.has(`${attachment.type}\u0000${attachment.url}`))
    const content = mergeInlineRenderedImages(message.content, renderedMessage.content)
    if (additions.length === 0 && content === message.content) return message

    changed = true
    return { ...message, content, attachments: additions.length > 0 ? [...existing, ...additions] : existing }
  })

  return changed ? { ...preferred, messages } : preferred
}

/**
 * Align rendered DOM turns to authoritative/API turns without assuming the two
 * arrays begin at the same conversation position. The DOM of virtualized chats
 * is commonly only a tail window.
 */
function alignRenderedMessages(
  preferred: ChatMessage[],
  rendered: ChatMessage[]
): Map<number, number> {
  const matches = new Map<number, number>()
  const usedRendered = new Set<number>()

  // 1. Provider-stable message IDs are authoritative when both sides expose them.
  for (let preferredIndex = 0; preferredIndex < preferred.length; preferredIndex++) {
    const id = preferred[preferredIndex].id
    if (!id) continue
    const renderedIndex = rendered.findIndex((candidate, index) =>
      !usedRendered.has(index) && candidate.role === preferred[preferredIndex].role && candidate.id === id
    )
    if (renderedIndex >= 0) {
      matches.set(preferredIndex, renderedIndex)
      usedRendered.add(renderedIndex)
    }
  }

  // 2. A unique normalized message body is safe even when it is short.
  for (let preferredIndex = 0; preferredIndex < preferred.length; preferredIndex++) {
    if (matches.has(preferredIndex)) continue
    const message = preferred[preferredIndex]
    const text = comparableMessageText(message.content)
    if (!text) continue

    const candidates = rendered
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate, index }) =>
        !usedRendered.has(index) &&
        candidate.role === message.role &&
        comparableMessageText(candidate.content) === text
      )
    if (candidates.length !== 1) continue

    const samePreferredTextCount = preferred.filter(candidate =>
      candidate.role === message.role && comparableMessageText(candidate.content) === text
    ).length
    if (samePreferredTextCount !== 1) continue

    matches.set(preferredIndex, candidates[0].index)
    usedRendered.add(candidates[0].index)
  }

  // 3. Preserve the older strong-text capability for richer API Markdown vs
  // flatter DOM text, but only when the match is unique in both directions.
  for (let preferredIndex = 0; preferredIndex < preferred.length; preferredIndex++) {
    if (matches.has(preferredIndex)) continue
    const message = preferred[preferredIndex]
    const preferredText = comparableMessageText(message.content)
    if (!preferredText) continue

    const candidates = rendered
      .map((candidate, index) => ({ candidate, index, text: comparableMessageText(candidate.content) }))
      .filter(({ candidate, index, text }) =>
        !usedRendered.has(index) && candidate.role === message.role && messagesLikelyMatch(preferredText, text)
      )
    if (candidates.length !== 1) continue

    const renderedText = candidates[0].text
    const competingPreferred = preferred
      .map((candidate, index) => ({ candidate, index, text: comparableMessageText(candidate.content) }))
      .filter(({ candidate, index, text }) =>
        !matches.has(index) && candidate.role === message.role && messagesLikelyMatch(text, renderedText)
      )
    if (competingPreferred.length !== 1) continue

    matches.set(preferredIndex, candidates[0].index)
    usedRendered.add(candidates[0].index)
  }

  // 4. For remaining turns, compare same-role ordinal positions from the end.
  // This is robust to a DOM window such as API[72..79] <-> DOM[0..7]. Text is
  // still required so a positional coincidence cannot attach media elsewhere.
  const roles: ChatMessage['role'][] = ['user', 'assistant', 'system']
  for (const role of roles) {
    const preferredRoleIndexes = preferred
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => message.role === role)
      .map(({ index }) => index)
    const renderedRoleIndexes = rendered
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => message.role === role)
      .map(({ index }) => index)

    const comparableTail = Math.min(preferredRoleIndexes.length, renderedRoleIndexes.length)
    for (let offset = 1; offset <= comparableTail; offset++) {
      const preferredIndex = preferredRoleIndexes[preferredRoleIndexes.length - offset]
      const renderedIndex = renderedRoleIndexes[renderedRoleIndexes.length - offset]
      if (matches.has(preferredIndex) || usedRendered.has(renderedIndex)) continue

      const preferredText = comparableMessageText(preferred[preferredIndex].content)
      const renderedText = comparableMessageText(rendered[renderedIndex].content)
      if (!messagesLikelyMatch(preferredText, renderedText)) continue

      matches.set(preferredIndex, renderedIndex)
      usedRendered.add(renderedIndex)
    }
  }

  return matches
}

interface MarkdownBlock {
  start: number
  end: number
  comparable: string
}

interface InlineRenderedImage {
  start: number
  end: number
  markdown: string
  url: string
}

const PROVIDER_IMAGE_HANDLE = /\b(?:i?turn\d+(?:image|video|asset)\d+)\b/gi
const PROVIDER_IMAGE_HANDLE_TEST = /\b(?:i?turn\d+(?:image|video|asset)\d+)\b/i

/**
 * API payloads often retain stronger Markdown than the live DOM, but may omit
 * an image position entirely. The DOM parser records `![alt](url)` at the
 * actual node position, so use its neighbouring text blocks as conservative
 * anchors and insert the image into the equivalent API paragraph.
 */
function mergeInlineRenderedImages(preferred: string, rendered: string): string {
  if (!preferred || !rendered || PROVIDER_IMAGE_HANDLE_TEST.test(preferred)) return preferred

  const images = inlineRenderedImages(rendered)
  if (images.length === 0) return preferred

  let merged = preferred
  // Work from the last image back so positions calculated from the API text
  // remain valid when a message contains more than one rendered image.
  for (const image of [...images].reverse()) {
    if (merged.includes(image.url)) continue
    const placement = findInlineImagePlacement(merged, rendered, image)
    if (placement === null) continue
    merged = `${merged.slice(0, placement)}\n\n${image.markdown}\n\n${merged.slice(placement)}`
  }
  return merged
}

function inlineRenderedImages(content: string): InlineRenderedImage[] {
  const images: InlineRenderedImage[] = []
  for (const match of content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    const url = String(match[1] || '').trim()
    if (!url) continue
    images.push({
      start: match.index || 0,
      end: (match.index || 0) + match[0].length,
      markdown: match[0],
      url
    })
  }
  return images
}

function findInlineImagePlacement(
  preferred: string,
  rendered: string,
  image: InlineRenderedImage
): number | null {
  const blocks = markdownBlocks(preferred)
  const before = lastMarkdownBlock(rendered.slice(0, image.start))
  const after = firstMarkdownBlock(rendered.slice(image.end))

  const beforeMatch = before ? bestMatchingBlock(blocks, before.comparable) : null
  if (beforeMatch) return beforeMatch.end

  const afterMatch = after ? bestMatchingBlock(blocks, after.comparable) : null
  if (afterMatch) return afterMatch.start

  return null
}

function markdownBlocks(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  const matcher = /[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g
  for (const match of content.matchAll(matcher)) {
    const text = match[0]
    const comparable = comparableBlockText(text)
    if (!comparable) continue
    blocks.push({ start: match.index || 0, end: (match.index || 0) + text.length, comparable })
  }
  return blocks
}

function lastMarkdownBlock(content: string): MarkdownBlock | null {
  const blocks = markdownBlocks(content)
  return blocks.at(-1) || null
}

function firstMarkdownBlock(content: string): MarkdownBlock | null {
  return markdownBlocks(content)[0] || null
}

function bestMatchingBlock(blocks: MarkdownBlock[], anchor: string): MarkdownBlock | null {
  if (anchor.length < 8) return null
  let best: MarkdownBlock | null = null
  let bestScore = 0
  for (const block of blocks) {
    const score = comparableBlockScore(anchor, block.comparable)
    if (score > bestScore) {
      best = block
      bestScore = score
    }
  }
  return bestScore >= 0.78 ? best : null
}

function comparableBlockScore(left: string, right: string): number {
  if (left === right) return 1
  const shortest = Math.min(left.length, right.length)
  const longest = Math.max(left.length, right.length)
  if (shortest < 8) return 0
  if (left.includes(right) || right.includes(left)) return shortest / longest

  const prefix = sharedPrefixLength(left, right)
  const suffix = sharedSuffixLength(left, right)
  return Math.max(prefix, suffix) / shortest
}

function sharedPrefixLength(left: string, right: string): number {
  let length = 0
  while (length < left.length && length < right.length && left[length] === right[length]) length++
  return length
}

function sharedSuffixLength(left: string, right: string): number {
  let length = 0
  while (
    length < left.length &&
    length < right.length && left[left.length - 1 - length] === right[right.length - 1 - length]
  ) length++
  return length
}

function comparableBlockText(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(PROVIDER_IMAGE_HANDLE, '')
    .replace(/[`*_~#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function comparableMessageText(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(PROVIDER_IMAGE_HANDLE, '')
    .replace(/[`*_~#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function messagesLikelyMatch(preferred: string, rendered: string): boolean {
  if (!preferred || !rendered) return false
  if (preferred === rendered) return true

  const shortest = Math.min(preferred.length, rendered.length)
  const longest = Math.max(preferred.length, rendered.length)
  if (shortest >= 8 && (preferred.includes(rendered) || rendered.includes(preferred))) {
    return shortest / longest >= 0.72
  }

  const overlap = Math.min(80, preferred.length, rendered.length)
  return overlap >= 12 && preferred.slice(0, overlap) === rendered.slice(0, overlap)
}
