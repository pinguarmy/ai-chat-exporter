/**
 * Page-level metadata helpers shared by the provider DOM parsers: the
 * conversation creation timestamp and title derivation.
 *
 * Every provider reads these the same way; only the brand suffix of
 * `document.title` differs, so it is an explicit parameter.
 */
import { extractTextContent } from '../core/dom-utils'

/** Longest first-user-message text used as a fallback title before truncation. */
const TITLE_FALLBACK_MAX_LENGTH = 80

/**
 * First valid `<time datetime>` on the page, as epoch milliseconds.
 *
 * Only the FIRST `time[datetime]` element is consulted: when it is malformed
 * the result is `undefined` rather than silently picking a later element, so
 * the timestamp never comes from a different message than the page header.
 */
export function extractPageCreatedAt(root: ParentNode = document): number | undefined {
  const first = root.querySelector('time[datetime]')
  const datetime = first?.getAttribute('datetime')
  if (!datetime) return undefined
  const timestamp = new Date(datetime).getTime()
  return Number.isNaN(timestamp) ? undefined : timestamp
}

/**
 * Strip a trailing `- Brand`, `– Brand` or `| Brand` suffix from a page title.
 *
 * Returns `null` when nothing but the bare brand name (or an empty string)
 * remains, so callers fall through to their next title strategy.
 */
export function cleanDocumentTitle(pageTitle: string | null | undefined, brand: string): string | null {
  if (!pageTitle) return null
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const cleaned = pageTitle.replace(new RegExp(`\\s*[-–|]\\s*${escaped}.*$`, 'i'), '').trim()
  if (cleaned && cleaned !== brand) return cleaned
  return null
}

/**
 * Turn the text of the first user message into a title: empty text yields
 * `null`; long text is cut at 80 characters with an ellipsis.
 */
export function titleFromMessageText(text: string | null | undefined): string | null {
  if (!text) return null
  return text.length > TITLE_FALLBACK_MAX_LENGTH ? `${text.substring(0, TITLE_FALLBACK_MAX_LENGTH)}...` : text
}

/** Title from the first element matching any selector (first non-empty text wins). */
export function titleFromFirstMatch(selector: string, root: ParentNode = document): string | null {
  const element = root.querySelector(selector)
  if (!element) return null
  return titleFromMessageText(extractTextContent(element))
}
