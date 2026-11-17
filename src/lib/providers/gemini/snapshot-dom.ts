/**
 * Observed-DOM page snapshot capture for Gemini.
 *
 * Reads only the live DOM; it never calls the provider list/detail APIs and
 * always yields an unverified snapshot. It selects message containers strictly
 * (no broad fallback) so a failed capture is reported instead of sweeping up
 * lookalike nodes.
 */
import type { ChatMessage, Conversation, PageSnapshot } from '../../types'
import { createVerificationEvidence } from '../../verification'
import { buildPageSnapshot } from '../../page-snapshot'
import { PageSnapshotCaptureError } from '../../snapshot-session'
import { extractImages, generateId } from '../../dom-utils'
import { extractDomImageAttachments } from '../dom-message'
import { parseGeminiMessageElement } from './dom-messages'

/**
 * Capture a page snapshot from the observed DOM only.
 *
 * Unlike parseCurrentConversation()/fetchConversationDetail(), this never
 * touches the provider detail/list APIs, never merges an API result, and
 * uses a strict message-container selection instead of the legacy broad
 * fallback. The result is a whitelist-built PageSnapshot with fixed
 * dom/unverified evidence. Throws PageSnapshotCaptureError (safe, non-private
 * message) when no capturable conversation content exists.
 */
export async function captureGeminiDomPageSnapshot(): Promise<PageSnapshot> {
  const messages = extractGeminiSnapshotMessages()
  if (messages.length === 0) {
    throw new PageSnapshotCaptureError(
      'No capturable conversation content is currently visible on this page.'
    )
  }

  const urlMatch = window.location.pathname.match(/\/app\/([a-zA-Z0-9_-]+)/)
  const conversationId = urlMatch?.[1] || generateId()

  const conversation: Conversation = {
    id: conversationId,
    title: document.title.replace(/\s*[-–|]\s*Gemini.*$/i, '').trim() && document.title !== 'Gemini'
      ? document.title.replace(/\s*[-–|]\s*Gemini.*$/i, '').trim()
      : messages.find(message => message.role === 'user')?.content.slice(0, 80) || 'Untitled Conversation',
    url: window.location.href,
    messages,
    platform: 'gemini',
    // Fixed at capture time; buildPageSnapshot re-asserts these and attaches
    // the snapshot envelope. Never mark a snapshot as verified.
    source: 'dom',
    sourceCompleteness: 'unverified',
    verification: createVerificationEvidence({
      provider: 'gemini',
      source: 'dom',
      transcript: {
        verified: false,
        method: 'dom-unverified',
        reasons: ['source_unverified'],
      },
    }),
  }

  return buildPageSnapshot(conversation, detectGeminiSnapshotGenerationState())
}

/**
 * Strict snapshot message selection: only explicit current main-conversation
 * message containers. Excludes editors/input areas, nav/aside, hidden or
 * aria-hidden copies and inactive branches; de-nests by ancestor/node
 * relationship instead of deleting same-text messages.
 */
export function extractGeminiSnapshotMessages(): ChatMessage[] {
  const root =
    document.querySelector('chat-window-content') ||
    document.querySelector('chat-window') ||
    document.querySelector('main') ||
    document.querySelector('[role="main"]')
  if (!root) return []

  // No broad [class*="query"]/[class*="content"] fallback here: a snapshot
  // must fail rather than sweep up arbitrary lookalike nodes.
  const candidates = Array.from(root.querySelectorAll(
    'user-query, .user-query, [class*="user-message"], [data-message-author-role="user"], ' +
    'model-response, .model-response, [class*="model-message"], [data-message-author-role="model"]'
  )) as Element[]

  const kept = new Set<Element>()
  const messages: ChatMessage[] = []
  for (const element of candidates) {
    if (kept.has(element)) continue
    if (isExcludedFromGeminiSnapshot(element)) continue
    // De-nest by node relationship: when an ancestor message container was
    // already kept, this descendant is a copy/child of the same message.
    let ancestor = element.parentElement
    let nested = false
    while (ancestor) {
      if (kept.has(ancestor)) { nested = true; break }
      if (ancestor === root) break
      ancestor = ancestor.parentElement
    }
    if (nested) continue
    kept.add(element)

    const roleAttr = element.getAttribute('data-message-author-role')
    const role: ChatMessage['role'] =
      roleAttr === 'user' ? 'user' :
      roleAttr === 'model' ? 'assistant' :
      element.matches('user-query, .user-query, [class*="user-message"]') ? 'user' : 'assistant'

    const message = parseGeminiSnapshotMessageElement(element, role)
    if (message) messages.push(message)
  }
  return messages
}

/** True when a candidate is an editor, navigation, hidden or inactive node. */
export function isExcludedFromGeminiSnapshot(element: Element): boolean {
  // Draft input / editor areas must never be captured, even if they render
  // inside a lookalike container.
  if (element.closest(
    'nav, aside, textarea, input, [contenteditable="true"], ' +
    '[class*="editor"], [class*="input-area"], [class*="input-container"]'
  )) {
    return true
  }

  let node: Element | null = element
  while (node) {
    if (node.hasAttribute('hidden') || node.hasAttribute('inert')) return true
    if (node.getAttribute('aria-hidden') === 'true') return true
    const className = typeof node.className === 'string' ? node.className : ''
    // Inactive branch/draft copies Gemini keeps in the DOM for switching.
    if (/\binactive\b|inactive-branch/.test(className)) return true
    try {
      const style = window.getComputedStyle(node)
      if (style.display === 'none' || style.visibility === 'hidden') return true
    } catch { /* structural checks remain authoritative */ }
    node = node.parentElement
  }

  try {
    const style = window.getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden') return true
  } catch {
    // getComputedStyle may be unavailable in synthetic DOMs; structural
    // checks above still apply.
  }
  return false
}

/**
 * Snapshot parsing reuses the private content/citation/attachment extraction
 * of the full parser, but an attachment-only turn becomes an honest readable
 * placeholder instead of being silently dropped or invented.
 */
export function parseGeminiSnapshotMessageElement(element: Element, role: ChatMessage['role']): ChatMessage | null {
  // Prune excluded descendants on a detached clone; never alter the provider page.
  // Checking only the message container would include hidden branch text and image URLs.
  const original = element
  element = original.cloneNode(true) as Element
  const originals = Array.from(original.querySelectorAll('*'))
  const clones = Array.from(element.querySelectorAll('*'))
  originals.forEach((node, index) => { if (isExcludedFromGeminiSnapshot(node)) clones[index]?.remove() })
  const parsed = parseGeminiMessageElement(element, role)
  if (parsed) return parsed

  const images = extractImages(element)
  if (images.length === 0) return null
  const names = images.map(img => img.alt).filter(name => name && name.trim())
  const label = names.length > 0 ? names.join(', ') : 'unnamed attachment'
  return {
    id: element.getAttribute('data-message-id') || element.id || generateId(),
    role,
    content: `[Attachment only: ${label}. Attachment content is not included in this snapshot.]`,
    attachments: extractDomImageAttachments(element, role)
  }
}

/**
 * Only an explicit stop/busy control proves generation is in progress.
 * Without one the state stays 'unknown'; never guess 'idle'.
 */
export function detectGeminiSnapshotGenerationState(): 'generating' | 'unknown' {
  const controls = document.querySelectorAll(
    'button[aria-label], [role="button"][aria-label], [class*="stop-button"], [data-test-id*="stop"]'
  )
  for (const control of Array.from(controls)) {
    if (isExcludedFromGeminiSnapshot(control)) continue
    const label = control.getAttribute('aria-label') || ''
    const className = typeof control.className === 'string' ? control.className : ''
    if (/stop/i.test(label) || /stop-button/i.test(className)) return 'generating'
  }
  return 'unknown'
}
