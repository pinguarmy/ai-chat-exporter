type ApiRecord = Record<string, unknown>

function isRecord(value: unknown): value is ApiRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function messageArrayFrom(value: unknown, depth = 0): ApiRecord[] {
  if (depth > 3) return []
  if (Array.isArray(value)) {
    const records = value.filter(isRecord)
    return records.some(record => normalizeApiMessageRole(record) !== null) ? records : []
  }
  if (!isRecord(value)) return []

  for (const key of ['chat_messages', 'messages', 'items', 'data']) {
    const result = messageArrayFrom(value[key], depth + 1)
    if (result.length > 0) return result
  }

  for (const key of ['conversation', 'result', 'payload']) {
    const result = messageArrayFrom(value[key], depth + 1)
    if (result.length > 0) return result
  }

  return []
}

/**
 * Gets message-like records from the small set of response envelopes used by
 * chat web apps. This intentionally does not recursively scan arbitrary JSON:
 * exports must not pick up unrelated application metadata.
 */
export function getApiMessageRecords(value: unknown): ApiRecord[] {
  return messageArrayFrom(value)
}

/** Map provider role variants to the two roles that the export format supports. */
export function normalizeApiMessageRole(value: ApiRecord): 'user' | 'assistant' | null {
  const nestedMessage = isRecord(value.message) ? value.message : null
  const nestedAuthor = isRecord(value.author) ? value.author : null
  const role = [
    value.role,
    value.sender_type,
    value.sender,
    nestedMessage?.role,
    nestedAuthor?.role
  ].map(asNonEmptyString).find(Boolean)?.toLowerCase()

  if (!role) return null
  if (['user', 'human', 'customer', 'prompt'].includes(role)) return 'user'
  if (['assistant', 'bot', 'ai', 'model', 'tool'].includes(role)) return 'assistant'
  return null
}

function textFromValue(value: unknown, depth = 0): string[] {
  if (depth > 8) return []
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (Array.isArray(value)) return value.flatMap(item => textFromValue(item, depth + 1))
  if (!isRecord(value)) return []

  const values: string[] = []
  for (const key of ['text', 'content', 'parts', 'body', 'value', 'delta']) {
    if (key in value) values.push(...textFromValue(value[key], depth + 1))
  }
  return values
}

/** Extract user-visible message text without walking unrelated metadata fields. */
export function extractApiMessageText(value: ApiRecord): string {
  const nestedMessage = isRecord(value.message) ? value.message : null
  const candidates = [
    value.content,
    value.text,
    value.parts,
    value.body,
    nestedMessage?.content,
    nestedMessage?.text,
    nestedMessage?.parts
  ]

  const unique = Array.from(new Set(candidates.flatMap(candidate => textFromValue(candidate))))
  return unique.join('\n\n').trim()
}
