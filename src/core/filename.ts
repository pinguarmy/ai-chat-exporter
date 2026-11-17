/**
 * Filename generation utility for exports
 */

import type { Conversation } from './types'
import { visibleMessageTimes } from './transcript-metadata'

/**
 * Names Windows refuses to create, regardless of extension.
 * A conversation titled "CON" or "prn" must not produce a download Chrome
 * rejects on Windows.
 */
const WINDOWS_RESERVED_BASENAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`)
])

/**
 * Longest base name (without extension), in UTF-8 bytes. ext4, APFS and NTFS
 * allow 255 bytes/units per path component; 200 leaves room for the extension
 * and the browser's " (n)" de-duplication suffix. Counting bytes rather than
 * UTF-16 units matters for CJK (3 bytes per character) and emoji (4 bytes).
 */
export const MAX_FILENAME_BYTES = 200

const utf8Encoder = new TextEncoder()

export function utf8ByteLength(text: string): number {
  return utf8Encoder.encode(text).length
}

interface GraphemeSegmenter {
  segment(input: string): Iterable<{ segment: string }>
}

/**
 * Split text into user-perceived characters. Uses `Intl.Segmenter` when the
 * browser has it; the fallback keeps combining marks, variation selectors,
 * skin-tone modifiers, ZWJ sequences, tag sequences and flag pairs together.
 */
export function splitGraphemes(text: string): string[] {
  const Segmenter = (
    Intl as unknown as {
      Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => GraphemeSegmenter
    }
  ).Segmenter
  if (typeof Segmenter === 'function') {
    const segmenter = new Segmenter(undefined, { granularity: 'grapheme' })
    return Array.from(segmenter.segment(text), part => part.segment)
  }
  return (
    text.match(
      // eslint-disable-next-line no-misleading-character-class -- intentionally lists modifiers/joiners that extend a cluster
      /\p{Regional_Indicator}{2}|\P{M}(?:[\p{M}\uFE0F\u200C\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]|\u200D\P{M})*|\p{M}+/gu
    ) ?? [text]
  )
}

/**
 * Truncate to at most `maxBytes` of UTF-8 without cutting through a code
 * point, surrogate pair or grapheme cluster (no lone combining marks, split
 * flags or half emoji sequences).
 */
export function truncateToUtf8Bytes(text: string, maxBytes: number): string {
  if (utf8ByteLength(text) <= maxBytes) return text
  let bytes = 0
  let result = ''
  for (const cluster of splitGraphemes(text)) {
    const size = utf8ByteLength(cluster)
    if (bytes + size > maxBytes) break
    bytes += size
    result += cluster
  }
  return result
}

/** Bidi overrides/isolates, zero-width space, LRM/RLM and BOM can disguise names. */
const DISGUISING_INVISIBLES = /[\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g

/**
 * ZWNJ/ZWJ are part of Persian, Indic and emoji spelling, so they survive when
 * they sit between two visible characters; stray or repeated ones are removed.
 */
function keepMeaningfulJoiners(text: string): string {
  return text.replace(/[\u200C\u200D]+/g, (run, offset: number) => {
    const before = text[offset - 1]
    const after = text[offset + run.length]
    const joins = before !== undefined && after !== undefined && !/[\s-]/.test(before + after)
    return joins ? run[0] : ''
  })
}

/** Remove unpaired surrogates (invalid UTF-16 that a download API may reject). */
function dropLoneSurrogates(text: string): string {
  return text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, pair =>
    pair.length === 2 ? pair : ''
  )
}

/**
 * Sanitize without truncating. Removes filesystem-unsafe and disguising
 * characters, joins words with hyphens, and normalizes the edges.
 * Preserves Unicode (CJK, Arabic, Hebrew, Indic, Thai, emoji, ...) and its
 * normalization form.
 */
function normalizeFilename(text: string): string {
  return keepMeaningfulJoiners(
    dropLoneSurrogates(String(text || ''))
      .replace(DISGUISING_INVISIBLES, '')
      // eslint-disable-next-line no-control-regex -- strips control characters (filesystem-unsafe) on purpose
      .replace(/[<>:"/\\|?*\x00-\x1F\x7F-\x9F]/g, '') // Remove filesystem-unsafe chars only
  )
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^[-\u200C\u200D]+|[-\u200C\u200D]+$/g, '') // Remove leading/trailing hyphens
    .replace(/^\.+/, '') // No hidden dotfiles from leading dots
    .replace(/[.\s]+$/, '') // Trailing dots/spaces are invalid on Windows
}

/**
 * Sanitize a string for use as a filename
 * Removes or replaces characters not allowed in filenames
 * Preserves Unicode characters (Chinese, Japanese, Korean, Arabic, etc.)
 */
export function sanitizeFilename(text: string, maxBytes = MAX_FILENAME_BYTES): string {
  const sanitized = truncateToUtf8Bytes(normalizeFilename(text), maxBytes).replace(
    /[-.\s\u200C\u200D]+$/, // Truncation may expose a new trailing dot, hyphen or joiner
    ''
  )

  // Each `-` separated segment must independently avoid reserved basenames
  // (the extension is appended later, so "CON" here would become "CON.md").
  return sanitized
    .split('-')
    .map(segment =>
      WINDOWS_RESERVED_BASENAMES.has(segment.toLowerCase()) ? `_${segment}` : segment
    )
    .join('-')
}

/** First `count` user-perceived characters (never splits a surrogate pair or cluster). */
function firstGraphemes(text: string, count: number): string {
  return splitGraphemes(text).slice(0, count).join('')
}

/**
 * Get a browser-local date string as YYYY-MM-DD.
 *
 * Export filenames are user-facing, so they use the browser's local calendar
 * day rather than UTC (which can otherwise move an evening conversation to
 * the following day for users east of Greenwich).
 */
function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Get a browser-local date and time string as YYYY-MM-DDTHHmmss.
 */
function formatDateTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${formatDate(date)}T${hours}${minutes}${seconds}`
}

/**
 * Get the current date as YYYY-MM-DD
 */
function getDateStr(): string {
  return formatDate(new Date())
}

/**
 * Return the earliest trustworthy timestamp exposed by the provider. A list
 * endpoint can give us `createdAt`, while a full page/API response can give us
 * timestamps on individual messages; choosing the earliest means `{date}`
 * names the conversation by when it began, not when it happened to export.
 */
function getConversationStartDate(conversation: Conversation): Date {
  const candidates = [
    conversation.createdAt,
    ...conversation.messages.map(message => message.timestamp)
  ].filter(
    (timestamp): timestamp is number =>
      typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp >= 0
  )

  return new Date(candidates.length > 0 ? Math.min(...candidates) : Date.now())
}

function getConvDateStr(conversation: Conversation): string {
  return formatDate(getConversationStartDate(conversation))
}

/**
 * Get the conversation's first known local date and time. Falls back to the
 * export moment only when no provider timestamp is available at all.
 */
function getConvDateTimeStr(conversation: Conversation): string {
  return formatDateTime(getConversationStartDate(conversation))
}

/** Use device-local time with an explicit offset; never invent missing times. */
function lastMessageFilenameTimes(conversation: Conversation): { date: string; datetime: string } {
  const last = visibleMessageTimes(conversation).last
  if (!last) return { date: 'unknown', datetime: 'unknown' }
  const date = new Date(last)
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes < 0 ? '-' : '+'
  const hours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0')
  const minutes = String(Math.abs(offsetMinutes) % 60).padStart(2, '0')
  return { date: formatDate(date), datetime: `${formatDateTime(date)}${sign}${hours}${minutes}` }
}

/**
 * Generate a filename from a pattern and conversation
 * @param pattern - The filename pattern (e.g., '{date}-{platform}-{title}')
 * @param conversation - The conversation data
 * @param index - Optional index for bulk exports (padded to 3 digits)
 * @returns Sanitized filename with extension
 */
export function generateFilename(
  pattern: string,
  conversation: Conversation,
  index?: number
): string {
  const conversationDate = getConvDateStr(conversation)
  const conversationDateTime = getConvDateTimeStr(conversation)
  const lastMessage = lastMessageFilenameTimes(conversation)
  const vars: Record<string, string> = {
    // `{date}` and `{datetime}` are the default filename tokens. They must
    // describe the conversation's first event, not today's export date.
    date: conversationDate,
    datetime: conversationDateTime,
    end_date: getDateStr(),
    last_message_date: lastMessage.date,
    last_message_datetime: lastMessage.datetime,
    // Retain the older explicit names as compatible aliases.
    conv_date: conversationDate,
    conv_datetime: conversationDateTime,
    title: sanitizeFilename(
      conversation.title && conversation.title !== 'Untitled Conversation'
        ? conversation.title
        : conversation.messages.length > 0
          ? firstGraphemes(conversation.messages[0].content, 80)
          : 'untitled'
    ),
    id: sanitizeFilename(conversation.id).slice(0, 8),
    full_id: sanitizeFilename(conversation.id),
    platform: conversation.platform,
    index: index !== undefined ? String(index).padStart(3, '0') : '000',
    msgcount: String(conversation.messages.length)
  }

  const render = () =>
    pattern.replace(/\{(\w+)\}/g, (match, key) => {
      return vars[key] !== undefined ? vars[key] : match
    })
  let filename = render()

  // A long title must not push the other tokens (date, id) off the end of the
  // byte budget: shorten the title by the overflow, on a character boundary.
  const overflow = utf8ByteLength(normalizeFilename(filename)) - MAX_FILENAME_BYTES
  if (overflow > 0 && pattern.includes('{title}')) {
    vars.title = sanitizeFilename(
      truncateToUtf8Bytes(vars.title, Math.max(0, utf8ByteLength(vars.title) - overflow))
    )
    filename = render()
  }

  // Final sanitization
  filename = sanitizeFilename(filename)

  // Ensure non-empty filename
  if (!filename || filename.length < 1) {
    filename = 'export'
  }

  return filename
}

/**
 * Get the default filename pattern
 */
export function getDefaultPattern(): string {
  return '{date}-{title}-{id}'
}

/**
 * Preview variables for the filename editor
 */
export const FILENAME_PREVIEW_VARS: Record<string, (conv: Conversation) => string> = {
  date: conv => getConvDateStr(conv),
  datetime: conv => getConvDateTimeStr(conv),
  end_date: () => getDateStr(),
  last_message_date: conv => lastMessageFilenameTimes(conv).date,
  last_message_datetime: conv => lastMessageFilenameTimes(conv).datetime,
  conv_date: conv => getConvDateStr(conv),
  conv_datetime: conv => getConvDateTimeStr(conv),
  title: conv => sanitizeFilename(conv.title || 'untitled'),
  platform: conv => conv.platform,
  index: () => '001',
  id: conv => sanitizeFilename(conv.id).slice(0, 8),
  full_id: conv => sanitizeFilename(conv.id),
  msgcount: conv => String(conv.messages.length)
}
