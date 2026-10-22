import type { Conversation } from './types'

export function isoTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/** Times of messages actually exported, never the export or chat creation time. */
export function visibleMessageTimes(conversation: Conversation) {
  // Message timestamps describe the exported branch, not conversation-level
  // activity (which can include metadata changes) or the time of this download.
  let first: number | undefined
  let last: number | undefined
  let count = 0
  for (const message of conversation.messages) {
    const timestamp = message.timestamp
    if (typeof timestamp !== 'number' || timestamp < 0 || !isoTimestamp(timestamp)) continue
    first = first === undefined ? timestamp : Math.min(first, timestamp)
    last = last === undefined ? timestamp : Math.max(last, timestamp)
    count += 1
  }
  return { first: isoTimestamp(first), last: isoTimestamp(last), count }
}

export function transcriptMetadata(conversation: Conversation, exportedAt = Date.now()) {
  const times = visibleMessageTimes(conversation)
  return {
    provider_created_at: isoTimestamp(conversation.createdAt),
    first_visible_message_at: times.first,
    last_visible_message_at: times.last ?? 'unknown',
    last_visible_message_at_source: times.last ? 'max-exported-message-timestamp' : 'unknown',
    message_timestamp_coverage: `${times.count}/${conversation.messages.length}`,
    exported_at: isoTimestamp(exportedAt),
    models_observed: [...new Set([conversation.modelName, ...conversation.messages.map(m => m.modelName)].filter((m): m is string => Boolean(m)))],
  }
}
