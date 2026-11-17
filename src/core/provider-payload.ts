/**
 * Narrow, structural descriptions of the provider API payloads the parsers read.
 *
 * These are compile-time shapes only: payloads come from `Response.json()` and are
 * not validated at the boundary, so every consumer must keep its own runtime
 * checks (`typeof`, `Array.isArray`, ...). Fields are optional because providers
 * add, drop and rename fields without notice.
 */

/** Plain JSON object whose members have not been inspected yet. */
export type JsonRecord = Record<string, unknown>

export function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read a nested member of provider JSON without assuming its shape. Any
 * non-object on the path yields undefined, like optional chaining.
 */
export function readPath(value: unknown, ...keys: string[]): unknown {
  let current = value
  for (const key of keys) {
    if (!isJsonRecord(current)) return undefined
    current = current[key]
  }
  return current
}

export interface ChatGptContentPart {
  type?: string
  content_type?: string
  text?: string
  name?: string
  url?: string
  image_url?: { url?: string }
  source?: { url?: string }
  file?: { url?: string }
}

export interface ChatGptPayloadMessage {
  id?: string
  role?: string
  recipient?: string
  channel?: string
  model?: string
  model_slug?: string
  create_time?: number | null
  author?: { role?: string; name?: string }
  metadata?: {
    is_visually_hidden_from_conversation?: boolean
    is_error?: boolean
    tool_call_id?: string
    model_slug?: string
    default_model_slug?: string
    content_references?: unknown
    citations?: unknown
  }
  content?: {
    content_type?: string
    parts?: Array<ChatGptContentPart | string>
    text?: string
  }
}

export interface ChatGptPayloadNode {
  id?: string
  parent?: string | null
  children?: string[]
  message?: ChatGptPayloadMessage | null
}

export interface ChatGptConversationPayload {
  id?: string
  title?: string
  create_time?: number | null
  current_node?: unknown
  default_model_slug?: string
  model_slug?: string
  model?: string
  metadata?: { model_slug?: string; default_model_slug?: string }
  mapping?: Record<string, ChatGptPayloadNode>
  messages?: ChatGptPayloadMessage[]
}
