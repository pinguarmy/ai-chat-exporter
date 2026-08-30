/**
 * Markdown export functionality for conversations
 */

import type { Conversation, ExportOptions, ChatMessage, CodeBlock, Attachment } from './types'
import { stripProviderArtifacts } from './dom-utils'
import { renderableMessageReferences } from './message-references'
import { sanitizeFilename } from './filename'
import { embedInlineImageAttachments, isInlineImageAttachment, removeInlineMarkdownImages } from './inline-media'
import { isTranscriptVerified } from './conversation-integrity'
import { localeTag, t, type Locale } from './i18n'

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
  const locale = options.locale ?? 'en'
  
  // Add header with metadata if enabled
  if (options.includeMetadata) {
    lines.push(...generateMetadataHeader(conversation, locale))
    lines.push('')
  }
  
  // Process each message
  conversation.messages.forEach((message, index) => {
    lines.push(...formatMessage(message, conversation, options, index))
    lines.push('')
  })

  // Separate "Artifacts" section when requested. Real artifacts are stored on
  // `conversation.artifacts` (populated by parsers — e.g. Claude's tool_use
  // blocks). We ALSO surface any artifact/research-document URLs that parsers
  // attached to individual messages, so the toggle is never silently dead.
  if (options.exportArtifacts) {
    const artifactRefs = collectArtifactReferences(conversation, options)
    const inlineArtifacts = collectInlineArtifacts(conversation, options)
    if (artifactRefs.length > 0 || inlineArtifacts.length > 0) {
      lines.push(`## ${t('Artifacts', locale)}`)
      lines.push('')
      lines.push(`_${t('AI-generated artifacts and research documents referenced in this conversation:', locale)}_`)
      lines.push('')
      artifactRefs.forEach(ref => {
        // Escape markdown link syntax so a crafted title/url cannot inject
        // markup or a javascript: link.
        const name = escapeMarkdownLinkText(ref.name)
        const url = sanitizeUrl(ref.url)
        lines.push(`- [${name}](${url})`)
      })
      for (const artifact of inlineArtifacts) {
        lines.push('')
        lines.push(`### ${escapeMarkdownLinkText(artifact.title || t('Artifact', locale)).replace(/[\r\n]+/g, ' ')}`)
        lines.push('')
        lines.push(`- **${t('Type', locale)}:** ${escapeMarkdownLinkText(artifact.type)}`)
        if (artifact.language) lines.push(`- **${t('Language', locale)}:** ${escapeMarkdownLinkText(artifact.language)}`)
        if (artifact.mimeType) lines.push(`- **${t('MIME type', locale)}:** ${escapeMarkdownLinkText(artifact.mimeType)}`)
        if (artifact.url && sanitizeUrl(artifact.url)) {
          lines.push(`- **${t('Open', locale)}:** [${escapeMarkdownLinkText(artifact.url)}](${sanitizeUrl(artifact.url)})`)
        }
        if (artifact.content) {
          const fence = markdownFence(artifact.content)
          const language = artifact.language || (artifact.type === 'html' ? 'html' : '')
          lines.push('')
          lines.push(`${fence}${language}`)
          lines.push(artifact.content)
          lines.push(fence)
        }
      }
      lines.push('')
    }
  }
  
  // Add footer
  lines.push('---')
  lines.push(`*${t(
    'Exported from {0} on {1}',
    locale,
    platformLabels[conversation.platform] || conversation.platform,
    new Date().toLocaleDateString(localeTag(locale))
  )}*`)
  lines.push('')
  
  return lines.join('\n')
}

/**
 * Generate the metadata header
 * @param conversation - The conversation
 * @returns Array of header lines
 */
function generateMetadataHeader(conversation: Conversation, locale: Locale): string[] {
  const lines: string[] = []
  
  lines.push(`# ${stripProviderArtifacts(conversation.title || t('Untitled Conversation', locale))}`)
  lines.push('')
  
  // Add metadata section
  lines.push(`## ${t('Metadata', locale)}`)
  lines.push('')
  lines.push(`- **${t('Platform', locale)}:** ${platformLabels[conversation.platform] || conversation.platform}`)
  if (conversation.modelName) {
    lines.push(`- **${t('Model', locale)}:** ${conversation.modelName}`)
  }
  lines.push(`- **${t('URL', locale)}:** ${conversation.url}`)
  lines.push(`- **${t('Visible messages', locale)}:** ${conversation.messages.length}`)
  if (conversation.source) {
    const sourceLabel = conversation.source === 'api'
      ? t('Provider API', locale)
      : conversation.source === 'dom'
        ? t('Rendered page', locale)
        : t('Provider API + rendered media', locale)
    lines.push(`- **${t('Transcript source', locale)}:** ${sourceLabel}`)
  }
  if (conversation.sourceCompleteness || conversation.verification) {
    lines.push(`- **${t('Source verification', locale)}:** ${t(
      isTranscriptVerified(conversation) === true ? 'Verified by provider structure' : 'Not verified',
      locale
    )}`)
  }
  
  if (conversation.createdAt) {
    const date = new Date(conversation.createdAt)
    lines.push(`- **${t('Created', locale)}:** ${date.toLocaleString(localeTag(locale))}`)
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
  conversation: Conversation,
  options: ExportOptions,
  index: number
): string[] {
  const lines: string[] = []
  
  // Add role header
  const roleLabel = formatRoleLabel(message.role, conversation, options)
  const authorInfo = message.authorName ? ` (${message.authorName})` : ''
  lines.push(`### ${roleLabel}${authorInfo}`)
  lines.push('')
  
  // Add timestamp if available
  if (message.timestamp && options.includeMetadata && options.showMessageTimestamps !== false) {
    const date = new Date(message.timestamp)
    if (!Number.isNaN(date.getTime())) {
      lines.push(`*${date.toLocaleString(localeTag(options.locale))}*`)
      lines.push('')
    }
  }
  
  const attachments = (message.attachments || []).filter(attachment =>
    shouldIncludeAttachment(attachment, options)
  )
  const inlineImages = embedInlineImageAttachments(message.content, attachments)

  // Add main content. Provider image handles are converted before generic
  // artifact stripping, so the Markdown transcript keeps images in turn order.
  const exportContent = stripProviderArtifacts(
    options.includeImages === false
      ? removeInlineMarkdownImages(inlineImages.content)
      : inlineImages.content
  )
  if (exportContent) {
    lines.push(...formatContent(exportContent))
  }

  const references = renderableMessageReferences(message.references, options.referenceExportMode)
  if (references.length > 0) {
    if (exportContent) lines.push('')
    lines.push(`**${t('Sources', options.locale ?? 'en')}:**`)
    for (const reference of references) {
      const title = escapeMarkdownLinkText(reference.title)
      const url = reference.url ? sanitizeUrl(reference.url) : ''
      lines.push(url ? `- [${title}](${url})` : `- ${title}`)
    }
  }
  
  // Add code blocks if enabled (avoid duplicates with content)
  if (options.includeCodeBlocks && message.codeBlocks?.length) {
    const contentLower = exportContent.toLowerCase()
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
  if (attachments.length) {
    // When includeUploadedFiles is OFF, drop references to FILES the user
    // uploaded into the chat — but NEVER strip genuine images, which are
    // conversational content (fixes the previous bug where every image was
    // removed when the toggle was off). Images are only excluded if they are
    // explicitly flagged as `uploaded` AND typed as an image by the parser.
    const images = options.includeImages !== false
      ? attachments.filter(attachment => attachment.type === 'image' && !isInlineImageAttachment(attachment, inlineImages.usedImageUrls))
      : []
    if (images.length > 0) {
      lines.push('')
      images.forEach(img => {
        lines.push(`![${escapeMarkdownLinkText(img.name || t('Image', options.locale ?? 'en'))}](${img.url})`)
        lines.push('')
      })
    }
    
    // Add other (non-image) attachments
    const otherAttachments = attachments.filter(a => a.type !== 'image')
    if (otherAttachments.length > 0) {
      lines.push(`**${t('Attachments', options.locale ?? 'en')}:**`)
      otherAttachments.forEach(att => {
        const locale = options.locale ?? 'en'
        // Do not leave an unsafe scheme as plain Markdown either: some
        // renderers autolink it even without explicit [label](target) syntax.
        const name = escapeMarkdownLinkText(
          att.name || (att.type === 'link' ? t('Attachment', locale) : att.url) || t('Attachment', locale)
        )
        if (att.type === 'link') {
          const safeUrl = sanitizeUrl(att.url)
          lines.push(safeUrl ? `- [${name}](${safeUrl})` : `- ${name}`)
        } else {
          lines.push(`- ${name}`)
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
    if (url && sanitizeUrl(url) && !seen.has(url)) {
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
    if (art.content) continue
    const url = art.url
    if (url) add(art.title || art.type, url)
  }

  for (const message of conversation.messages) {
    for (const att of message.attachments || []) {
      if (att.url && att.type !== 'image' && shouldIncludeAttachment(att, options)) {
        add(att.name || att.url, att.url)
      }
    }
  }

  return refs
}

/** Keep user-upload filtering identical in the transcript and artifact list. */
function shouldIncludeAttachment(attachment: Attachment, options: ExportOptions): boolean {
  return !(
    options.includeUploadedFiles === false &&
    attachment.uploaded === true &&
    attachment.type !== 'image'
  )
}

/** Return inline artifacts that would otherwise disappear when tool blocks are hidden. */
function collectInlineArtifacts(
  conversation: Conversation,
  options: ExportOptions
): NonNullable<Conversation['artifacts']> {
  return (conversation.artifacts || []).filter(artifact => {
    const isUploadedFile = artifact.type === 'document' && !artifact.content
    if (isUploadedFile && options.includeUploadedFiles === false) return false
    return Boolean(artifact.content || artifact.title || artifact.url)
  })
}

function markdownFence(content: string): string {
  const longestRun = Math.max(...Array.from(content.matchAll(/`+/g), match => match[0].length), 2)
  return '`'.repeat(Math.max(3, longestRun + 1))
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
function formatRoleLabel(
  role: ChatMessage['role'],
  conversation: Conversation,
  options: ExportOptions
): string {
  const locale = options.locale ?? 'en'
  switch (role) {
    case 'user':
      // Keep astral emoji out of the source literal. Plasmo 0.90.5's production
      // optimizer can otherwise emit only the high surrogate ("\ud83d"), which
      // downloads as the replacement character �.
      return `${String.fromCodePoint(0x1F464)} ${t('User', locale)}`
    case 'assistant':
      return `${String.fromCodePoint(0x1F916)} ${options.assistantDisplayName?.trim() || conversation.modelName?.trim() || t('Assistant', locale)}`
    case 'system':
      return `⚙️ ${t('System', locale)}`
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
  const sanitized = sanitizeFilename(conversation.title || 'conversation')
  
  return sanitized ? `${sanitized}.md` : 'conversation.md'
}
