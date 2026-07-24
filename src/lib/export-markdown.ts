/**
 * Markdown export functionality for conversations
 */

import type { Conversation, ExportOptions, ChatMessage, CodeBlock, Attachment } from './types'

/** Platform display name lookup */
const platformLabels: Record<string, string> = { chatgpt: 'ChatGPT', gemini: 'Google Gemini', claude: 'Claude', deepseek: 'DeepSeek', grok: 'Grok' }

/**
 * Convert a conversation to Markdown format
 * @param conversation - The conversation to convert
 * @param options - Export options
 * @returns Markdown string
 */
export function conversationToMarkdown(
  conversation: Conversation,
  options: ExportOptions
): string {
  const lines: string[] = []
  
  // Add header with metadata if enabled
  if (options.includeMetadata) {
    lines.push(...generateMetadataHeader(conversation))
    lines.push('')
  }
  
  // Process each message
  conversation.messages.forEach((message, index) => {
    lines.push(...formatMessage(message, options, index))
    lines.push('')
  })

  // Separate "Artifacts" section when requested. Real artifacts are stored on
  // `conversation.artifacts` (populated by parsers — e.g. Claude's tool_use
  // blocks). We ALSO surface any artifact/research-document URLs that parsers
  // attached to individual messages, so the toggle is never silently dead.
  if (options.exportArtifacts) {
    const artifactRefs = collectArtifactReferences(conversation, options)
    if (artifactRefs.length > 0) {
      lines.push('## Artifacts')
      lines.push('')
      lines.push('_AI-generated artifacts and research documents referenced in this conversation:_')
      lines.push('')
      artifactRefs.forEach(ref => {
        // Escape markdown link syntax so a crafted title/url cannot inject
        // markup or a javascript: link.
        const name = escapeMarkdownLinkText(ref.name)
        const url = sanitizeUrl(ref.url)
        lines.push(`- [${name}](${url})`)
      })
      lines.push('')
    }
  }
  
  // Add footer
  lines.push('---')
  lines.push(`*Exported from ${platformLabels[conversation.platform] || conversation.platform} on ${new Date().toLocaleDateString()}*`)
  lines.push('')
  
  return lines.join('\n')
}

/**
 * Generate the metadata header
 * @param conversation - The conversation
 * @returns Array of header lines
 */
function generateMetadataHeader(conversation: Conversation): string[] {
  const lines: string[] = []
  
  lines.push(`# ${conversation.title || 'Untitled Conversation'}`)
  lines.push('')
  
  // Add metadata section
  lines.push('## Metadata')
  lines.push('')
  lines.push(`- **Platform:** ${platformLabels[conversation.platform] || conversation.platform}`)
  lines.push(`- **URL:** ${conversation.url}`)
  lines.push(`- **Messages:** ${conversation.messages.length}`)
  
  if (conversation.createdAt) {
    const date = new Date(conversation.createdAt)
    lines.push(`- **Created:** ${date.toLocaleString()}`)
  }
  
  lines.push('')
  return lines
}

/**
 * Format a single message
 * @param message - The message to format
 * @param options - Export options
 * @param index - Message index
 * @returns Array of formatted lines
 */
function formatMessage(
  message: ChatMessage,
  options: ExportOptions,
  index: number
): string[] {
  const lines: string[] = []
  
  // Add role header
  const roleLabel = formatRoleLabel(message.role)
  const authorInfo = message.authorName ? ` (${message.authorName})` : ''
  lines.push(`### ${roleLabel}${authorInfo}`)
  lines.push('')
  
  // Add timestamp if available
  if (message.timestamp && options.includeMetadata) {
    const time = new Date(message.timestamp).toLocaleTimeString()
    lines.push(`*${time}*`)
    lines.push('')
  }
  
  // Add main content
  if (message.content) {
    lines.push(...formatContent(message.content))
  }
  
  // Add code blocks if enabled (avoid duplicates with content)
  if (options.includeCodeBlocks && message.codeBlocks?.length) {
    const contentLower = message.content?.toLowerCase() || ''
    const newBlocks = message.codeBlocks.filter(block => {
      const blockCode = block.code.trim().toLowerCase()
      return blockCode.length > 10 && !contentLower.includes(blockCode.slice(0, 50))
    })
    if (newBlocks.length > 0) {
      lines.push('')
      newBlocks.forEach(block => {
        lines.push(...formatCodeBlock(block))
        lines.push('')
      })
    }
  }
  
  // Add images if enabled
  if (options.includeImages && message.attachments?.length) {
    // When includeUploadedFiles is OFF, drop references to FILES the user
    // uploaded into the chat — but NEVER strip genuine images, which are
    // conversational content (fixes the previous bug where every image was
    // removed when the toggle was off). Images are only excluded if they are
    // explicitly flagged as `uploaded` AND typed as an image by the parser.
    const uploadedFilter = (a: Attachment) =>
      options.includeUploadedFiles === false && a.uploaded === true && a.type !== 'image'
        ? false
        : true
    const attachments = message.attachments.filter(uploadedFilter)

    const images = attachments.filter(a => a.type === 'image')
    if (images.length > 0) {
      lines.push('')
      images.forEach(img => {
        lines.push(`![${img.name || 'Image'}](${img.url})`)
        lines.push('')
      })
    }
    
    // Add other (non-image) attachments
    const otherAttachments = attachments.filter(a => a.type !== 'image')
    if (otherAttachments.length > 0) {
      lines.push('**Attachments:**')
      otherAttachments.forEach(att => {
        if (att.type === 'link') {
          lines.push(`- [${att.name || att.url}](${att.url})`)
        } else {
          lines.push(`- ${att.name || att.url}`)
        }
      })
    }
  }
  
  return lines
}

/**
 * Collect artifact / research-document references so they can be emitted as a
 * separate "## Artifacts" section when exportArtifacts is on.
 *
 * Sources (union, deduped by URL):
 *  1. `conversation.artifacts` — the real artifact store, populated by parsers
 *     (e.g. Claude tool_use blocks). This is the primary, authoritative source.
 *  2. Non-image attachments on individual messages (Gemini research-doc links,
 *     etc.) — surfaced so the toggle is never silently dead.
 */
function collectArtifactReferences(
  conversation: Conversation,
  options: ExportOptions
): { name: string; url: string }[] {
  const refs: { name: string; url: string }[] = []
  const seen = new Set<string>()

  const add = (name: string, url: string) => {
    if (url && !seen.has(url)) {
      seen.add(url)
      refs.push({ name: name || url, url })
    }
  }

  for (const art of conversation.artifacts || []) {
    // `document`-type entries with no inline content are USER UPLOADS (the
    // Claude API stores uploaded files here). They must honor includeUploadedFiles.
    const isUploadedFile = art.type === 'document' && !art.content
    if (isUploadedFile && options.includeUploadedFiles === false) continue

    // Only emit a reference when a usable URL exists. Inline AI artifacts
    // (code/html with content) are exported in-place and need no reference.
    const url = art.url
    if (url) add(art.title || art.type, url)
  }

  for (const message of conversation.messages) {
    for (const att of message.attachments || []) {
      if (att.url && att.type !== 'image') add(att.name || att.url, att.url)
    }
  }

  return refs
}

/**
 * Escape characters that would break or inject into a markdown link label.
 * Specifically `]` and `\`. A crafted title like `[click](x)` would otherwise
 * corrupt the link or inject a second link.
 */
function escapeMarkdownLinkText(text: string): string {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
}

/**
 * Reject non-http(s) schemes (javascript:, data:, vbscript:) to prevent
 * markdown link injection. Falls back to an empty string when unsafe.
 */
function sanitizeUrl(url: string): string {
  const trimmed = String(url).trim()
  if (/^(https?:|mailto:)/i.test(trimmed)) {
    // Escape spaces and parens so the link target stays well-formed.
    return trimmed.replace(/\s/g, '%20').replace(/\)/g, '%29')
  }
  return ''
}

/**
 * Format role label for display
 * @param role - The message role
 * @returns Formatted role label
 */
function formatRoleLabel(role: ChatMessage['role']): string {
  switch (role) {
    case 'user':
      return '👤 User'
    case 'assistant':
      return '🤖 Assistant'
    case 'system':
      return '⚙️ System'
    default:
      return role
  }
}

/**
 * Format message content preserving structure
 * - Preserves code blocks (triple backticks) as-is
 * - Preserves headers (#, ##, etc.)
 * - Preserves lists (-, *, 1.)
 * - Preserves double newlines as paragraph breaks
 * - Preserves single newlines as line breaks
 */
function formatContent(content: string): string[] {
  const lines: string[] = []
  
  // Split into segments: code blocks and regular text
  const segments = splitContentSegments(content)
  
  for (const segment of segments) {
    if (segment.type === 'code') {
      // Preserve code blocks as-is
      lines.push(segment.content)
    } else {
      // Process regular text paragraphs
      const paragraphs = segment.content.split(/\n\n+/)
      for (let i = 0; i < paragraphs.length; i++) {
        if (paragraphs[i].trim()) {
          lines.push(paragraphs[i])
          // Add blank line between paragraphs to preserve paragraph breaks in markdown
          if (i < paragraphs.length - 1) {
            lines.push('')
          }
        }
      }
    }
  }
  
  return lines
}

/**
 * Split content into code block and text segments
 */
function splitContentSegments(content: string): Array<{ type: 'text' | 'code'; content: string }> {
  const segments: Array<{ type: 'text' | 'code'; content: string }> = []
  const codeBlockRegex = /(```[\s\S]*?```)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  
  while ((match = codeBlockRegex.exec(content)) !== null) {
    // Add text before code block
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index)
      if (text.trim()) {
        segments.push({ type: 'text', content: text })
      }
    }
    // Add code block
    segments.push({ type: 'code', content: match[1] })
    lastIndex = match.index + match[1].length
  }
  
  // Add remaining text
  if (lastIndex < content.length) {
    const text = content.slice(lastIndex)
    if (text.trim()) {
      segments.push({ type: 'text', content: text })
    }
  }
  
  // If no segments found, treat entire content as text
  if (segments.length === 0 && content.trim()) {
    segments.push({ type: 'text', content })
  }
  
  return segments
}

/**
 * Format a code block
 * @param block - The code block
 * @returns Array of formatted lines
 */
function formatCodeBlock(block: CodeBlock): string[] {
  const lines: string[] = []
  const language = block.language || ''
  
  lines.push(`\`\`\`${language}`)
  lines.push(block.code)
  lines.push('```')
  
  return lines
}

/**
 * Generate a filename for the markdown export
 * @param conversation - The conversation
 * @returns Sanitized filename
 */
export function generateMarkdownFilename(conversation: Conversation): string {
  const title = conversation.title || 'conversation'
  const sanitized = title
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')  // Remove filesystem-unsafe chars only
    .replace(/\s+/g, '-')                      // Replace spaces with hyphens
    .replace(/-+/g, '-')                       // Collapse multiple hyphens
    .replace(/^-|-$/g, '')                     // Remove leading/trailing hyphens
    .substring(0, 200)                         // Truncate
  
  return sanitized ? `${sanitized}.md` : 'conversation.md'
}
