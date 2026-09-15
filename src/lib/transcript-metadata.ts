import type { Conversation } from './types'

export function isoTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}
export function transcriptMetadata(conversation: Conversation, exportedAt = Date.now()) {
  const timestamps = conversation.messages.map(m => m.timestamp).filter((t): t is number => isoTimestamp(t) !== undefined)
  return {
    provider_created_at: isoTimestamp(conversation.createdAt),
    first_visible_message_at: timestamps.length ? isoTimestamp(Math.min(...timestamps)) : undefined,
    last_visible_message_at: timestamps.length ? isoTimestamp(Math.max(...timestamps)) : undefined,
    exported_at: isoTimestamp(exportedAt),
    models_observed: [...new Set([conversation.modelName, ...conversation.messages.map(m => m.modelName)].filter((m): m is string => Boolean(m)))],
  }
}
