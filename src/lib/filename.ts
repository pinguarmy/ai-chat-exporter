/**
 * Filename generation utility for exports
 */

import type { Conversation } from './types'

/**
 * Sanitize a string for use as a filename
 * Removes or replaces characters not allowed in filenames
 * Preserves Unicode characters (Chinese, Japanese, Korean, Arabic, etc.)
 */
export function sanitizeFilename(text: string): string {
  return String(text || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')  // Remove filesystem-unsafe chars only
    .replace(/\s+/g, '-')                      // Replace spaces with hyphens
    .replace(/-+/g, '-')                       // Collapse multiple hyphens
    .replace(/^-|-$/g, '')                     // Remove leading/trailing hyphens
    .substring(0, 200)                         // Truncate to reasonable length
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
    ...conversation.messages.map(message => message.timestamp),
  ].filter((timestamp): timestamp is number =>
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
  const vars: Record<string, string> = {
    // `{date}` and `{datetime}` are the default filename tokens. They must
    // describe the conversation's first event, not today's export date.
    date: conversationDate,
    datetime: conversationDateTime,
    end_date: getDateStr(),
    // Retain the older explicit names as compatible aliases.
    conv_date: conversationDate,
    conv_datetime: conversationDateTime,
    title: sanitizeFilename(
      conversation.title && conversation.title !== 'Untitled Conversation'
        ? conversation.title
        : (conversation.messages.length > 0
            ? conversation.messages[0].content.substring(0, 80)
            : 'untitled')
    ),
    platform: conversation.platform,
    index: index !== undefined ? String(index).padStart(3, '0') : '000',
    msgcount: String(conversation.messages.length),
  }

  let filename = pattern.replace(/\{(\w+)\}/g, (match, key) => {
    return vars[key] !== undefined ? vars[key] : match
  })

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
  return '{date}-{title}'
}

/**
 * Preview variables for the filename editor
 */
export const FILENAME_PREVIEW_VARS: Record<string, (conv: Conversation) => string> = {
  date: (conv) => getConvDateStr(conv),
  datetime: (conv) => getConvDateTimeStr(conv),
  end_date: () => getDateStr(),
  conv_date: (conv) => getConvDateStr(conv),
  conv_datetime: (conv) => getConvDateTimeStr(conv),
  title: (conv) => sanitizeFilename(conv.title || 'untitled'),
  platform: (conv) => conv.platform,
  index: () => '001',
  msgcount: (conv) => String(conv.messages.length),
}
