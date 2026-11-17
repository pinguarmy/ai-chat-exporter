/**
 * Role detection from DOM hints, for providers whose rendered turns are not
 * labelled with an explicit `data-message-author-role` attribute.
 *
 * ChatGPT (article fallback), DeepSeek and Grok share the same detection
 * ladder (descendant indicators, then aria-label, then optional extras); they
 * differ only in which words identify the assistant, which are parameters.
 *
 * These are heuristics for the observed-DOM fallback only. They never override
 * provider-authoritative roles.
 */
import type { ChatMessage } from '../core/types'

type Role = ChatMessage['role']

const USER_INDICATOR_SELECTOR = '[class*="user"], [data-role="user"]'

export interface IndicatorRoleOptions {
  /** Selector for descendants that identify an assistant turn. */
  assistantIndicatorSelector: string
  /** aria-label substrings (lower-case) that identify an assistant turn. */
  assistantAriaTerms: readonly string[]
  /** Last-resort descendant selectors checked after the aria-label. */
  descendantFallbacks?: { user: string; assistant: string }
  /** When set, the element's own class name is checked after the aria-label. */
  classNameAssistantTerms?: readonly string[]
}

/**
 * Detect a role from the element's own class attribute: `user` wins over any
 * assistant term. Returns `null` when the class name carries neither.
 */
export function detectRoleFromClassName(
  element: Element,
  assistantTerms: readonly string[]
): Role | null {
  const className = element.className || ''
  if (typeof className !== 'string') return null
  if (className.includes('user')) return 'user'
  if (assistantTerms.some(term => className.includes(term))) return 'assistant'
  return null
}

/**
 * Detect a role in this order: a user indicator descendant, an assistant
 * indicator descendant, the aria-label, then the optional provider extras.
 * A user indicator always wins over an assistant one, matching the long-standing
 * behaviour of the per-provider implementations this replaced.
 */
export function detectRoleFromIndicators(element: Element, options: IndicatorRoleOptions): Role | null {
  if (element.querySelector(USER_INDICATOR_SELECTOR)) return 'user'
  if (element.querySelector(options.assistantIndicatorSelector)) return 'assistant'

  const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || ''
  if (ariaLabel.includes('user') || ariaLabel.includes('you')) return 'user'
  if (options.assistantAriaTerms.some(term => ariaLabel.includes(term))) return 'assistant'

  const fallbacks = options.descendantFallbacks
  if (fallbacks) {
    if (element.querySelector(fallbacks.user)) return 'user'
    if (element.querySelector(fallbacks.assistant)) return 'assistant'
  }

  if (options.classNameAssistantTerms) {
    return detectRoleFromClassName(element, options.classNameAssistantTerms)
  }
  return null
}
