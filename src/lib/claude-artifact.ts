import type { ConversationArtifact } from './types'

/** Capture provider-exposed display source as inert text, never execute it. */
export function extractClaudeDisplayArtifact(block: Record<string, any>): ConversationArtifact | null {
  if (block.type !== 'tool_result' || block.display_content?.type !== 'json_block' || typeof block.display_content.json_block !== 'string') return null
  let display: unknown
  try { display = JSON.parse(block.display_content.json_block) } catch { return null }
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
export function inferClaudeArtifactType(block: Record<string, any>): ConversationArtifact['type'] {
  const name = String(block.name || '').toLowerCase()
  const inputType = String(block.input?.type || '').toLowerCase()
  const mimeType = String(block.input?.mimeType || block.input?.mime_type || '').toLowerCase()

  if (inputType === 'html' || name.includes('html') || mimeType.includes('text/html')) {
    return 'html'
  }
  if (inputType === 'document' || name.includes('document')) {
    return 'document'
  }
  return 'code'
}
