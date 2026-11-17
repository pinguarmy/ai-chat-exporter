import type { ConversationArtifact } from '../core/types'
import { isJsonRecord, type JsonRecord } from '../core/provider-payload'

/** Capture provider-exposed display source as inert text, never execute it. */
export function extractClaudeDisplayArtifact(block: JsonRecord): ConversationArtifact | null {
  const displayContent = isJsonRecord(block.display_content) ? block.display_content : undefined
  if (block.type !== 'tool_result' || displayContent?.type !== 'json_block' || typeof displayContent.json_block !== 'string') return null
  let display: unknown
  try { display = JSON.parse(displayContent.json_block) } catch { return null }
  if (!display || typeof display !== 'object') return null
  const value = display as Record<string, unknown>
  if (typeof value.code !== 'string' || !value.code.trim() || typeof value.language !== 'string') return null
  const language = value.language.toLowerCase()
  if (!['html', 'markdown', 'svg'].includes(language)) return null
  return {
    type: language === 'markdown' ? 'document' : language === 'html' ? 'html' : 'code',
    title: `Displayed ${language.toUpperCase()} source`,
    content: value.code,
    language,
    mimeType: language === 'html' ? 'text/html' : language === 'svg' ? 'image/svg+xml' : 'text/markdown',
  }
}


/** Infer the exported artifact type from both the Claude tool name and payload. */
export function inferClaudeArtifactType(block: JsonRecord): ConversationArtifact['type'] {
  const input: JsonRecord = isJsonRecord(block.input) ? block.input : {}
  const name = String(block.name || '').toLowerCase()
  const inputType = String(input.type || '').toLowerCase()
  const mimeType = String(input.mimeType || input.mime_type || '').toLowerCase()

  if (inputType === 'html' || name.includes('html') || mimeType.includes('text/html')) {
    return 'html'
  }
  if (inputType === 'document' || name.includes('document')) {
    return 'document'
  }
  return 'code'
}
