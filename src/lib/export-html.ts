/** Safe HTML representation shared by preview and PDF rendering. */
import { collectArtifactReferences, collectInlineArtifacts, shouldIncludeAttachment } from './export-assets'
import { toolSummary } from './execution-trace'
import { transcriptMetadata, isoTimestamp } from './transcript-metadata'
import { renderCitationContent, isPrivateReferenceUrl, renderableExportUrl, renderableMessageReferences } from './message-references'
import type { Conversation, ExportOptions, ChatMessage, PdfStyle } from './types'
import { cleanText, escapeHtml, stripProviderArtifacts } from './dom-utils'
import { embedInlineImageAttachments, isInlineImageAttachment, removeInlineMarkdownCodeBlocks, removeInlineMarkdownImages } from './inline-media'
import { isTranscriptVerified } from './conversation-integrity'
import { localeTag, t, type Locale } from './i18n'
import { sanitizePreviewHtml } from './preview-sanitize'
import { renderToString as renderLatexToString } from 'katex'

export function safePdfLinkTarget(value: string): string | null {
  const trimmed = value.trim()
  return /^(https?:|mailto:)/i.test(trimmed) ? trimmed : null
}

/** Stable human-facing platform labels used by both the PDF and preview. */
export function platformDisplayName(platform: Conversation['platform']): string {
  switch (platform) {
    case 'chatgpt': return 'ChatGPT'
    case 'gemini': return 'Google Gemini'
    case 'claude': return 'Claude'
    case 'deepseek': return 'DeepSeek'
    case 'grok': return 'Grok'
    default: return platform
  }
}

/**
 * Turn the common provider model slugs into a compact document label. Keep
 * custom labels verbatim: they are a deliberate user setting, not a slug to
 * reinterpret.
 */
export function formatModelDisplayName(value: string): string {
  const model = value.trim()
  if (!model) return ''

  // `gpt-5-6-thinking` is what the ChatGPT API commonly returns. It is useful
  // as data, but its kebab-case form looks like a build identifier in a PDF.
  const gptTokens = model.split(/[-_]+/)
  if (gptTokens[0]?.toLowerCase() === 'gpt' && gptTokens.length > 1) {
    const tokens = gptTokens.slice(1)
    const version: string[] = []
    while (tokens.length > 0 && /^(?:\d+(?:\.\d+)?|\d+[a-z]+)$/i.test(tokens[0])) {
      version.push(tokens.shift()!)
      if (version.length === 3) break
    }
    if (version.length > 0) {
      const suffix = tokens
        .map(token => token ? `${token.slice(0, 1).toUpperCase()}${token.slice(1)}` : '')
        .filter(Boolean)
        .join(' ')
      return `GPT-${version.join('.')}${suffix ? ` ${suffix}` : ''}`
    }
  }

  return model
}

/** Resolve the assistant heading without pretending a model slug is known. */
export function getAssistantDisplayName(
  conversation: Conversation,
  options: Pick<ExportOptions, 'assistantDisplayName'> = {}
): string {
  const override = options.assistantDisplayName?.trim()
  if (override) return override
  if (conversation.modelName?.trim()) return formatModelDisplayName(conversation.modelName)
  return platformDisplayName(conversation.platform)
}

/** Compact message time for a quiet conversation header. */
export function formatMessageTimestamp(value: number | Date, locale: Locale = 'en'): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  if (locale !== 'en') {
    return date.toLocaleString(localeTag(locale), {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    })
  }
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} · ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Generate HTML content from a conversation
 * @param conversation - The conversation to convert
 * @param options - Export options
 * @returns HTML string
 */
export function conversationToHtml(
  conversation: Conversation,
  options: ExportOptions
): string {
  const locale = options.locale ?? 'en'
  const title = escapeHtml(stripProviderArtifacts(conversation.title || t('Untitled Conversation', locale)))
  const platform = platformDisplayName(conversation.platform)
  const pdfStyle: PdfStyle = options.pdfStyle === 'classic' ? 'classic' : 'minimal'
  
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    ${getPrintStyles(pdfStyle)}
  </style>
</head>
<body class="pdf-document-root pdf-style-${pdfStyle}">
  <div class="conversation">
    ${options.includeMetadata ? generateMetadataSection(conversation, platform, locale) : ''}
    
    <div class="messages">
      ${conversation.messages.map(msg => generateMessageHtml(msg, conversation, options)).join('\n')}
    </div>
    
    ${options.exportArtifacts ? generateArtifactsHtml(conversation, options) : ''}
    
    ${options.includeToolTrace ? `<section><h2>Tool activity</h2>${toolSummary(conversation.events).map(line => `<p>${escapeHtml(line)}</p>`).join('')}<p>Coverage: ${escapeHtml(conversation.traceCoverage || 'unavailable')}; provider-exposed events only.</p></section>` : ''}
    <footer>
      <hr>
      <p>${escapeHtml(t(
        'Exported from {0} on {1}',
        locale,
        platform,
        new Date().toISOString()
      ))}</p>
    </footer>
  </div>
</body>
</html>`
}

/**
 * Generate metadata HTML section
 * @param conversation - The conversation
 * @param platform - Platform name
 * @returns HTML string
 */
function generateMetadataSection(conversation: Conversation, platform: string, locale: Locale): string {
  const createdInfo = Object.entries(transcriptMetadata(conversation)).filter(([, v]) => v && (!Array.isArray(v) || v.length)).map(([k, v]) => `<p><strong>${k}:</strong> ${escapeHtml(Array.isArray(v) ? v.join(', ') : String(v))}</p>`).join('')
  const safeConversationUrl = safePdfLinkTarget(conversation.url)
  const conversationUrl = safeConversationUrl
    ? `<a href="${escapeHtml(safeConversationUrl)}">${escapeHtml(conversation.url)}</a>`
    : escapeHtml(conversation.url)
  
  return `
    <header>
      <h1>${escapeHtml(stripProviderArtifacts(conversation.title || t('Untitled Conversation', locale)))}</h1>
      <div class="metadata">
        <p><strong>${escapeHtml(t('Platform', locale))}:</strong> ${platform}</p>
        ${conversation.modelName ? `<p><strong>${escapeHtml(t('Model', locale))}:</strong> ${escapeHtml(formatModelDisplayName(conversation.modelName))}</p>` : ''}
        <p><strong>${escapeHtml(t('URL', locale))}:</strong> ${conversationUrl}</p>
        <p><strong>${escapeHtml(t('Visible messages', locale))}:</strong> ${conversation.messages.length}</p>
        ${conversation.source ? `<p><strong>${escapeHtml(t('Transcript source', locale))}:</strong> ${escapeHtml(t(conversation.source === 'api' ? 'Provider API' : conversation.source === 'dom' ? 'Rendered page' : 'Provider API + rendered media', locale))}</p>` : ''}
        ${(conversation.sourceCompleteness || conversation.verification) ? `<p><strong>${escapeHtml(t('Source verification', locale))}:</strong> ${escapeHtml(t(isTranscriptVerified(conversation) === true ? 'Verified by provider structure' : 'Not verified', locale))}</p>` : ''}
        ${createdInfo}
      </div>
    </header>
    <hr>`
}

/**
 * Generate HTML for a single message
 * @param message - The message
 * @param options - Export options
 * @returns HTML string
 */
function generateMessageHtml(message: ChatMessage, conversation: Conversation, options: ExportOptions): string {
  const locale = options.locale ?? 'en'
  const roleClass = message.role
  const roleLabel = message.authorName || (
    message.role === 'user'
      ? t('User', locale)
      : message.role === 'system'
        ? t('System', locale)
        : getAssistantDisplayName({ ...conversation, modelName: message.modelName || conversation.modelName }, options)
  )
  let content = ''
  let timestampHtml = ''

  // Keep the name and time in one compact heading. Separate stacked labels
  // looked sparse on a page and amplified letter-spacing at high zoom.
  if (isoTimestamp(message.timestamp) && options.includeMetadata && options.showMessageTimestamps !== false) {
    const date = new Date(message.timestamp!)
    const iso = Number.isNaN(date.getTime()) ? '' : date.toISOString()
    const time = date.toISOString()
    if (time) timestampHtml = `<span class="meta-separator" aria-hidden="true">·</span><time class="timestamp" datetime="${iso}">${escapeHtml(time)}</time>`
  }
  
  const attachments = (message.attachments || []).filter(attachment => shouldIncludeAttachment(attachment, options))
  // An image returned as a provider handle must be placed where that handle
  // appeared in the transcript, not appended after the entire answer. DOM
  // parsers also emit Markdown images at their original node position.
  const inlineImages = embedInlineImageAttachments(renderCitationContent(message, options.referenceExportMode), attachments)
  const contentWithImageSetting = options.includeCodeBlocks === false
    ? removeInlineMarkdownCodeBlocks(
        options.includeImages === false
          ? removeInlineMarkdownImages(inlineImages.content)
          : inlineImages.content
      )
    : options.includeImages === false
      ? removeInlineMarkdownImages(inlineImages.content)
      : inlineImages.content

  // Add content
  if (contentWithImageSetting) {
    content += `<div class="content">${formatHtmlContent(cleanText(contentWithImageSetting))}</div>\n`
  }
  
  const references = renderableMessageReferences(message.references, options.referenceExportMode)
  if (references.length > 0) {
    content += `<div class="attachments references"><strong>${escapeHtml(t('Sources', locale))}:</strong><ul>`
    for (const reference of references) {
      const title = escapeHtml(reference.title)
      const safeUrl = reference.url ? safePdfLinkTarget(reference.url) : null
      content += safeUrl ? `<li><a href="${escapeHtml(safeUrl)}">${title}</a></li>` : `<li>${title}</li>`
    }
    content += '</ul></div>\n'
  }

  // Add code blocks
  if (options.includeCodeBlocks && message.codeBlocks?.length) {
    message.codeBlocks.forEach(block => {
      const lang = block.language ? ` data-language="${escapeHtml(block.language)}"` : ''
      content += `<pre${lang}><code>${escapeHtml(block.code)}</code></pre>\n`
    })
  }
  
  // Add images
  if (attachments.length) {
    const images = options.includeImages !== false
      ? attachments.filter(attachment => attachment.type === 'image' && !isInlineImageAttachment(attachment, inlineImages.usedImageUrls))
      : []
    images.forEach(img => {
      content += `<figure class="image" data-pdf-block="image"><img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.name || t('Image', locale))}" /></figure>\n`
    })

    const otherAttachments = attachments.filter(a => a.type !== 'image')
    if (otherAttachments.length > 0) {
      content += `<div class="attachments"><strong>${escapeHtml(t('Attachments', locale))}:</strong><ul>`
      for (const attachment of otherAttachments) {
        const name = escapeHtml(attachment.name || attachment.url || t('Attachment', locale))
        const rendered = renderableExportUrl(
          attachment.name || attachment.url || t('Attachment', locale),
          attachment.url,
          options.referenceExportMode,
          { private: attachment.url ? isPrivateReferenceUrl(attachment.url) : true }
        )
        const rawUrl = String(rendered?.url || '').trim()
        const safeUrl = /^(https?:|mailto:)/i.test(rawUrl) ? escapeHtml(rawUrl) : ''
        content += safeUrl
          ? `<li><a href="${safeUrl}">${name}</a></li>`
          : `<li>${name}</li>`
      }
      content += '</ul></div>\n'
    }
  }
  
  return `\n    <div class="message ${roleClass}">\n      <div class="message-meta"><span class="role">${escapeHtml(roleLabel)}</span>${timestampHtml}</div>\n      ${content}\n    </div>`
}

/**
 * Generate an "Artifacts" HTML section for PDF export (mirrors the markdown
 * "## Artifacts" block). Lists AI-generated artifacts and research-doc URLs
 * that parsers attached to `conversation.artifacts` or to individual messages.
 * User-uploaded document artifacts honor `includeUploadedFiles`.
 */
export function generateArtifactsHtml(conversation: Conversation, options: ExportOptions): string {
  const locale = options.locale ?? 'en'
  const refs = collectArtifactReferences(conversation, options)
  const inlineArtifacts = collectInlineArtifacts(conversation, options)

  if (refs.length === 0 && inlineArtifacts.length === 0) return ''

  const items = refs.map(ref => {
    const name = escapeHtml(ref.title)
    const safe = ref.url && /^(https?:|mailto:)/i.test(ref.url.trim()) ? ref.url.trim() : ''
    return safe ? `<li><a href="${escapeHtml(safe)}">${name}</a></li>` : `<li>${name}</li>`
  }).join('\n')

  const inline = inlineArtifacts.map(artifact => {
    const title = escapeHtml(artifact.title || t('Artifact', locale))
    const language = artifact.language ? ` data-language="${escapeHtml(artifact.language)}"` : ''
    const details = [
      `<h3>${title}</h3>`,
      `<p><strong>${escapeHtml(t('Type', locale))}:</strong> ${escapeHtml(artifact.type)}</p>`,
      artifact.language ? `<p><strong>${escapeHtml(t('Language', locale))}:</strong> ${escapeHtml(artifact.language)}</p>` : '',
      artifact.mimeType ? `<p><strong>${escapeHtml(t('MIME type', locale))}:</strong> ${escapeHtml(artifact.mimeType)}</p>` : '',
      (() => {
        const openLink = renderableExportUrl(
          artifact.url || artifact.title || t('Artifact', locale),
          artifact.url,
          options.referenceExportMode,
          { private: artifact.url ? isPrivateReferenceUrl(artifact.url) : true }
        )
        return openLink?.url && /^(https?:|mailto:)/i.test(openLink.url.trim())
          ? `<p><strong>${escapeHtml(t('Open', locale))}:</strong> <a href="${escapeHtml(openLink.url.trim())}">${escapeHtml(openLink.url.trim())}</a></p>`
          : ''
      })(),
      artifact.content
        ? `<pre${language}><code>${escapeHtml(artifact.content)}</code></pre>`
        : ''
    ].filter(Boolean).join('\n')
    return `<section class="artifact">${details}</section>`
  }).join('\n')

  const referenceList = refs.length > 0
    ? `<ul>\n${items}\n      </ul>`
    : ''
  // Artifact titles, URLs, and inline content all come from provider payloads,
  // so this fragment is sanitized here rather than at each consumer.
  return sanitizePreviewHtml(`\n    <div class="artifacts">\n      <h2>${escapeHtml(t('Artifacts', locale))}</h2>\n      <p><em>${escapeHtml(t('AI-generated artifacts and research documents referenced in this conversation:', locale))}</em></p>\n      ${referenceList}\n      ${inline}\n    </div>`)
}

/**
 * Convert a single line of markdown inline formatting to HTML.
 * Handles bold, italic, inline code, links, and inline LaTeX.
 */
function inlineMarkdownToHtml(line: string): string {
  // Inline code `code`
  let result = line.replace(/`([^`]+)`/g, '<code>$1</code>')
  const autoLinkTokens: string[] = []
  // Plain URLs are common in provider transcripts. Reserve them before the
  // Markdown emphasis pass so underscores in a URL cannot become formatting,
  // and so the later Markdown-link pass cannot create nested anchors.
  result = result.replace(/(^|[\s>])((?:https?:\/\/|mailto:)[^\s<>"'()]+)/g, (_match, prefix, url) => {
    const token = `§§AI_URL_${autoLinkTokens.length}§§`
    autoLinkTokens.push(url)
    return `${prefix}${token}`
  })
  // Markdown images. Keep only remote images or local data/blob image URLs;
  // arbitrary protocols must never become live image requests.
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, url) => {
    const rawUrl = unescapeHtmlAttribute(String(url || '').trim())
    if (!isUsefulMarkdownImageUrl(rawUrl)) return ''
    return `<img class="markdown-image" data-pdf-block="image" src="${escapeHtml(rawUrl)}" alt="${escapeHtml(unescapeHtmlAttribute(String(alt || '')))}" />`
  })
  // Bold **text** or __text__
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  result = result.replace(/__(.+?)__/g, '<strong>$1</strong>')
  // Italic *text* or _text_ (but not inside ** or __). Require a non-word
  // boundary before underscore emphasis so URL slugs such as
  // `crescendo_heres_the_sources` cannot italicize the remainder of a page.
  result = result.replace(/(^|[^\w*])\*(?!\*)([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
  result = result.replace(/(^|[^\w_])_(?!_)([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
  // Links [text](url) — block javascript:/data: URIs for safety
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text, url) => {
    const safeUrl = safePdfLinkTarget(unescapeHtmlAttribute(url.trim()))
    if (!safeUrl) {
      return text
    }
    return `<a href="${escapeHtml(safeUrl)}">${text}</a>`
  })
  result = result.replace(/§§AI_URL_(\d+)§§/g, (_match, index) => {
    const url = autoLinkTokens[Number(index)]
    const safeUrl = url ? safePdfLinkTarget(unescapeHtmlAttribute(url)) : null
    return safeUrl ? `<a href="${escapeHtml(safeUrl)}">${escapeHtml(unescapeHtmlAttribute(url))}</a>` : ''
  })
  return result
}

function unescapeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
}

function isUsefulMarkdownImageUrl(url: string): boolean {
  if (!/^(https?:|data:image\/|blob:)/i.test(url)) return false
  // Gemini Maps often appends decorative marker sprites/placeholders to an
  // answer. They are not content and otherwise become large blank boxes.
  return !/(?:default_geocode|(?:^|\/)star\.png(?:$|[?#]))/i.test(url)
}

/** Split a Markdown table row while preserving escaped pipe characters. */
function splitMarkdownTableRow(line: string): string[] {
  let value = line.trim()
  if (value.startsWith('|')) value = value.slice(1)
  if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1)

  const cells: string[] = []
  let cell = ''
  let escaped = false
  for (const character of value) {
    if (escaped) {
      cell += character
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === '|') {
      cells.push(cell.trim())
      cell = ''
      continue
    }
    cell += character
  }
  if (escaped) cell += '\\'
  cells.push(cell.trim())
  return cells
}

function isMarkdownTableDelimiter(line: string): boolean {
  const cells = splitMarkdownTableRow(line)
  return cells.length >= 2 && cells.every(cell => /^:?-{1,}:?$/.test(cell.replace(/\s+/g, '')))
}

function tableAlignment(cell: string): 'left' | 'center' | 'right' | undefined {
  const value = cell.replace(/\s+/g, '')
  if (value.startsWith(':') && value.endsWith(':')) return 'center'
  if (value.endsWith(':')) return 'right'
  if (value.startsWith(':')) return 'left'
  return undefined
}

function renderMarkdownTable(lines: string[], start: number): { html: string; nextIndex: number } {
  const headers = splitMarkdownTableRow(lines[start])
  const delimiters = splitMarkdownTableRow(lines[start + 1])
  const alignments = headers.map((_header, index) => tableAlignment(delimiters[index] || ''))
  const rows: string[][] = []
  let index = start + 2

  while (index < lines.length) {
    const line = lines[index].trim()
    if (!line || !line.includes('|')) break
    const row = splitMarkdownTableRow(line)
    if (row.length === 0) break
    rows.push(row)
    index++
  }

  const renderCell = (value: string, cellIndex: number) => {
    const alignment = alignments[cellIndex]
    const style = alignment ? ` style="text-align:${alignment}"` : ''
    return `<td${style}>${inlineMarkdownToHtml(escapeHtml(value))}</td>`
  }
  const renderHeader = (value: string, cellIndex: number) => {
    const alignment = alignments[cellIndex]
    const style = alignment ? ` style="text-align:${alignment}"` : ''
    return `<th${style}>${inlineMarkdownToHtml(escapeHtml(value))}</th>`
  }

  const html = [
    '<table>',
    '<thead>',
    `<tr>${headers.map(renderHeader).join('')}</tr>`,
    '</thead>',
    rows.length > 0 ? '<tbody>' : '',
    ...rows.map(row => `<tr>${headers.map((_header, cellIndex) => renderCell(row[cellIndex] || '', cellIndex)).join('')}</tr>`),
    rows.length > 0 ? '</tbody>' : '',
    '</table>\n'
  ].filter(Boolean).join('\n')

  return { html, nextIndex: index }
}

/**
 * Convert markdown text segment to HTML, handling headings, lists, blockquotes, HRs, paragraphs.
 */
function markdownTextToHtml(text: string): string {
  const lines = text.split('\n')
  let html = ''
  let inList = false
  let listType: 'ul' | 'ol' | null = null
  let inBlockquote = false
  let blockquoteLines: string[] = []

  function closeBlockquote() {
    if (inBlockquote && blockquoteLines.length > 0) {
      html += `<blockquote>${blockquoteLines.map(l => `<p>${inlineMarkdownToHtml(escapeHtml(l))}</p>`).join('\n')}</blockquote>\n`
      blockquoteLines = []
      inBlockquote = false
    }
  }

  function closeList() {
    if (inList) {
      html += listType === 'ol' ? '</ol>\n' : '</ul>\n'
      inList = false
      listType = null
    }
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const trimmed = line.trim()

    // Empty line = paragraph break
    if (!trimmed) {
      closeBlockquote()
      continue
    }

    // GitHub-style tables need to be recognised before the horizontal-rule
    // check, because their delimiter row is made of dashes. Rendering the
    // table here keeps PDF/preview output semantic instead of showing raw
    // pipes and `---` markers.
    if (
      index + 1 < lines.length &&
      trimmed.includes('|') &&
      isMarkdownTableDelimiter(lines[index + 1])
    ) {
      closeBlockquote()
      closeList()
      const table = renderMarkdownTable(lines, index)
      html += table.html
      index = table.nextIndex - 1
      continue
    }

    // Horizontal rule: ---, ***, ___
    if (/^[-*_]{3,}$/.test(trimmed)) {
      closeBlockquote()
      closeList()
      html += '<hr>\n'
      continue
    }

    // Standalone Markdown images become figures so they can be centered and
    // kept together during pagination rather than showing the literal `![]`.
    const imageMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
    if (imageMatch) {
      const safeUrl = imageMatch[2].trim()
      if (isUsefulMarkdownImageUrl(safeUrl)) {
        closeBlockquote()
        closeList()
        html += `<figure class="image" data-pdf-block="image"><img class="markdown-image" src="${escapeHtml(safeUrl)}" alt="${escapeHtml(imageMatch[1])}" /></figure>\n`
      }
      // Decorative or unsafe image references are omitted rather than
      // rendered as literal alt text or an empty paragraph.
      continue
    }

    // Headings: # ## ### etc.
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      closeBlockquote()
      closeList()
      const level = headingMatch[1].length
      html += `<h${level}>${inlineMarkdownToHtml(escapeHtml(headingMatch[2]))}</h${level}>\n`
      continue
    }

    // Blockquote: > text
    if (trimmed.startsWith('> ')) {
      closeList()
      if (!inBlockquote) inBlockquote = true
      blockquoteLines.push(trimmed.slice(2))
      continue
    }

    // Unordered list: - item, * item, + item
    const ulMatch = trimmed.match(/^[-*+]\s+(.+)$/)
    if (ulMatch) {
      closeBlockquote()
      if (!inList || listType !== 'ul') {
        closeList()
        html += '<ul>\n'
        inList = true
        listType = 'ul'
      }
      html += `<li>${inlineMarkdownToHtml(escapeHtml(ulMatch[1]))}</li>\n`
      continue
    }

    // Ordered list: 1. item
    const olMatch = trimmed.match(/^\d+\.\s+(.+)$/)
    if (olMatch) {
      closeBlockquote()
      if (!inList || listType !== 'ol') {
        closeList()
        html += '<ol>\n'
        inList = true
        listType = 'ol'
      }
      html += `<li>${inlineMarkdownToHtml(escapeHtml(olMatch[1]))}</li>\n`
      continue
    }

    // Regular text — close list/blockquote if open, then paragraph
    closeBlockquote()
    closeList()
    html += `<p>${inlineMarkdownToHtml(escapeHtml(trimmed))}</p>\n`
  }

  closeBlockquote()
  closeList()
  return html
}

/**
 * Format content with HTML, preserving LaTeX notation and converting markdown
 * @param content - Markdown content
 * @returns HTML formatted content
 */
export function formatHtmlContent(content: string): string {
  // The preview path calls this function directly (without the PDF message
  // wrapper), so provider-only citation markup must be removed here as well.
  content = stripProviderArtifacts(content)

  // Split into segments: code blocks, LaTeX, and regular text
  const segments = splitHtmlContentSegments(content)
  let html = ''
  
  for (const segment of segments) {
    if (segment.type === 'code') {
      // Preserve code blocks
      const langMatch = segment.content.match(/```(\w*)\n/)
      const lang = langMatch ? langMatch[1] : ''
      const code = segment.content.replace(/```\w*\n?/, '').replace(/\n?```$/, '')
      const langAttr = lang ? ` data-language="${escapeHtml(lang)}"` : ''
      html += `<pre${langAttr}><code>${escapeHtml(code)}</code></pre>\n`
    } else if (segment.type === 'latex') {
      html += renderLatexSegment(segment.content)
    } else {
      // Regular text: convert markdown to HTML
      html += markdownTextToHtml(segment.content)
    }
  }
  
  // Single sanitization point for provider text turned into HTML. Both
  // consumers — the preview page's innerHTML and the offscreen PDF render
  // container — receive already-sanitized message bodies, so neither has to
  // remember to do it.
  return sanitizePreviewHtml(html)
}

function unwrapLatexSegment(value: string): { source: string; displayMode: boolean } {
  const trimmed = value.trim()
  const wrappers: Array<[string, string, boolean]> = [
    ['\\[', '\\]', true],
    ['$$', '$$', true],
    ['\\(', '\\)', false],
    ['$', '$', false]
  ]
  for (const [open, close, displayMode] of wrappers) {
    if (trimmed.startsWith(open) && trimmed.endsWith(close) && trimmed.length >= open.length + close.length) {
      return {
        source: trimmed.slice(open.length, trimmed.length - close.length).trim(),
        displayMode
      }
    }
  }
  return { source: trimmed, displayMode: true }
}

function renderLatexSegment(value: string): string {
  const { source, displayMode } = unwrapLatexSegment(value)
  if (!source) return ''

  try {
    // MathML keeps the result self-contained: it does not depend on a remote
    // stylesheet or a bundled webfont, and Chrome/Preview can still expose
    // the equation as selectable/searchable semantic text.
    const rendered = renderLatexToString(source, {
      displayMode,
      output: 'mathml',
      throwOnError: false,
      errorColor: '#374151'
    })
    return `<div class="latex${displayMode ? ' latex-display' : ''}" data-latex-source="${escapeHtml(source)}">${rendered}</div>\n`
  } catch {
    // A malformed provider formula should remain readable rather than abort
    // the entire export. Keep only the source, without raw delimiters.
    return `<div class="latex${displayMode ? ' latex-display' : ''}">${escapeHtml(source)}</div>\n`
  }
}

/**
 * Split content into code, LaTeX, and text segments for HTML generation
 */
function splitHtmlContentSegments(content: string): Array<{ type: 'text' | 'code' | 'latex'; content: string }> {
  const segments: Array<{ type: 'text' | 'code' | 'latex'; content: string }> = []
  
  // Match code blocks, display LaTeX ($$...$$), and inline LaTeX ($...$ or \(...\) or \[...\])
  // Do not treat currency such as `$60M / $40M` as LaTeX. Requiring the
  // opening dollar sign to be followed by a non-digit/non-space is a small
  // heuristic, but it preserves ordinary scientific notation (`$x^2$`,
  // `\\alpha`) while keeping financial prose in one paragraph.
  const combinedRegex = /(```[\s\S]*?```|\$\$[\s\S]*?\$\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$(?![\d\s])[^$\n]+?\$(?!\d))/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  
  while ((match = combinedRegex.exec(content)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index)
      if (text.trim()) {
        segments.push({ type: 'text', content: text })
      }
    }
    
    // Determine type of match
    const matched = match[1]
    if (matched.startsWith('```')) {
      segments.push({ type: 'code', content: matched })
    } else {
      // LaTeX: $...$, $$...$$, \(...\), \[...\]
      segments.push({ type: 'latex', content: matched })
    }
    
    lastIndex = match.index + matched.length
  }
  
  // Add remaining text
  if (lastIndex < content.length) {
    const text = content.slice(lastIndex)
    if (text.trim()) {
      segments.push({ type: 'text', content: text })
    }
  }
  
  // If no segments found, treat as text
  if (segments.length === 0 && content.trim()) {
    segments.push({ type: 'text', content })
  }
  
  return segments
}

/**
 * Get print-specific CSS styles
 * @returns CSS string
 */
function getPrintStyles(_pdfStyle: PdfStyle = 'minimal'): string {
  return `
    @page {
      margin: 10mm;
      size: A4;
    }

    *, *::before, *::after {
      box-sizing: border-box;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }

    .pdf-document-root {
      font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Microsoft YaHei', 'Segoe UI', sans-serif;
      font-size: 11pt;
      line-height: 1.75;
      color: #202124;
      background: #fff;
      max-width: 760px;
      margin: 0 auto;
      padding: 28px 24px 40px;
    }

    .conversation {
      width: 100%;
      max-width: 720px;
      margin: 0 auto;
    }

    header {
      max-width: 720px;
      margin: 0 auto 30px;
      text-align: center;
    }

    h1 {
      color: #202124;
      font-size: 26px;
      font-weight: 650;
      letter-spacing: -0.01em;
      margin: 0 auto 12px;
      line-height: 1.25;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .metadata {
      padding: 0;
      color: #6b7280;
      font-size: 10px;
      overflow-wrap: anywhere;
    }

    .metadata p {
      margin: 2px 0;
    }

    .metadata strong {
      color: #4b5563;
      font-weight: 600;
    }

    hr {
      border: none;
      border-top: 1px solid #e5e7eb;
      margin: 0 0 2px;
    }

    .message {
      max-width: 720px;
      margin: 0 auto;
      padding: 18px 0 22px;
      background: transparent;
      border: 0;
      border-bottom: 1px solid #e5e7eb;
      border-radius: 0;
      break-inside: auto;
      page-break-inside: auto;
    }

    .messages .message:first-child {
      padding-top: 14px;
    }

    .message-meta {
      display: flex;
      align-items: baseline;
      justify-content: center;
      gap: 7px;
      line-height: 1.3;
      margin: 0 0 11px;
      text-align: center;
      break-after: avoid;
      page-break-after: avoid;
    }

    .role {
      color: #4f5661;
      font-size: 10.5px;
      font-weight: 600;
      letter-spacing: normal;
      margin: 0;
      text-align: center;
      text-transform: none;
    }

    .message.user .role {
      color: #69707b;
    }

    .message.system {
      background: #fffaf0;
      border-bottom-color: #eadfc8;
      padding-left: 14px;
      padding-right: 14px;
    }

    .message.system .role {
      color: #8a5a16;
    }

    .content {
      max-width: 680px;
      margin: 0 auto;
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .content h2, .content h3, .content h4, .content h5, .content h6 {
      color: #202124;
      line-height: 1.35;
      margin: 20px 0 8px;
      break-after: avoid;
      page-break-after: avoid;
    }

    .content h2 { font-size: 18px; }
    .content h3 { font-size: 15px; }

    .content p {
      margin: 10px 0;
    }

    .content ul, .content ol {
      margin: 10px 0;
      padding-left: 24px;
    }

    .content li {
      margin: 4px 0;
    }

    .content blockquote {
      margin: 14px 0;
      padding: 2px 0 2px 14px;
      border-left: 2px solid #b8bdc5;
      color: #5f6368;
      background: transparent;
    }

    .timestamp {
      color: #8a8f98;
      font-size: 10px;
      display: inline;
      margin: 0;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }

    .meta-separator {
      color: #b1b5bc;
      font-size: 11px;
      line-height: 1;
    }

    pre {
      background: #f3f4f6;
      border: 1px solid #e5e7eb;
      color: #202124;
      padding: 13px 15px;
      border-radius: 4px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      margin: 14px auto;
      max-width: 680px;
      page-break-inside: avoid;
      break-inside: avoid;
    }

    code {
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      font-size: 0.88em;
    }

    :not(pre) > code {
      background: #f3f4f6;
      border: 1px solid #e5e7eb;
      border-radius: 3px;
      padding: 1px 4px;
    }

    .latex {
      max-width: 680px;
      margin: 14px auto;
      overflow-x: auto;
      color: #202124;
      font-family: 'Times New Roman', 'STIX Two Math', 'Cambria Math', serif;
      line-height: 1.35;
      text-align: left;
    }

    .latex-display {
      margin: 20px auto;
      text-align: center;
    }

    .latex math {
      font-size: 1.08em;
      max-width: 100%;
    }

    .image {
      width: min(680px, 100%);
      margin: 18px auto 22px;
      text-align: center;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .image img {
      max-width: 100%;
      max-height: 1040px;
      width: auto;
      height: auto;
      object-fit: contain;
      display: block;
      margin: 0 auto;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      image-rendering: auto;
    }

    .markdown-image {
      max-width: 100%;
      max-height: 1040px;
      width: auto;
      height: auto;
      display: block;
      margin: 18px auto 22px;
      object-fit: contain;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    table {
      max-width: 680px;
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      margin: 14px auto;
      break-inside: auto;
      page-break-inside: auto;
    }

    thead {
      display: table-header-group;
    }

    th, td {
      border: 1px solid #d9dde3;
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    th {
      background: #f7f7f7;
      font-weight: 600;
    }

    tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    
    footer {
      margin-top: 40px;
      text-align: center;
      color: #6b7280;
      font-size: 10px;
    }

    .pdf-style-minimal footer {
      display: none;
    }

    .artifacts {
      max-width: 680px;
      margin: 24px auto 0;
      padding-top: 18px;
      border-top: 1px solid #e5e7eb;
    }

    a {
      color: #4b5563;
      text-decoration: underline;
      text-decoration-thickness: 1px;
      text-underline-offset: 2px;
    }

    /* Opt-in legacy card treatment for users who need the old conversation look. */
    .pdf-document-root.pdf-style-classic {
      max-width: 800px;
      padding: 20px;
      line-height: 1.6;
      color: #333;
    }

    .pdf-document-root.pdf-style-classic .conversation {
      max-width: none;
    }

    .pdf-document-root.pdf-style-classic header {
      margin-bottom: 30px;
      text-align: left;
    }

    .pdf-document-root.pdf-style-classic h1 {
      color: #1a1a1a;
      font-size: 2em;
      margin-bottom: 10px;
      text-align: left;
    }

    .pdf-document-root.pdf-style-classic .metadata {
      background: #f5f5f5;
      padding: 15px;
      border-radius: 8px;
      font-size: 0.9em;
    }

    .pdf-document-root.pdf-style-classic .message {
      margin-bottom: 25px;
      padding: 15px;
      border: 0;
      border-radius: 8px;
    }

    .pdf-document-root.pdf-style-classic .message.user {
      background: #e3f2fd;
      border-left: 4px solid #2196f3;
    }

    .pdf-document-root.pdf-style-classic .message.assistant {
      background: #f5f5f5;
      border-left: 4px solid #4caf50;
    }

    .pdf-document-root.pdf-style-classic .message.system {
      background: #fff8e1;
      border-left: 4px solid #ff9800;
    }

    .pdf-document-root.pdf-style-classic .role {
      color: #555;
      font-size: inherit;
      letter-spacing: normal;
      margin: 0;
      text-align: left;
      text-transform: none;
    }

    .pdf-document-root.pdf-style-classic .message-meta {
      justify-content: flex-start;
      margin-bottom: 10px;
      text-align: left;
    }

    .pdf-document-root.pdf-style-classic .content,
    .pdf-document-root.pdf-style-classic pre,
    .pdf-document-root.pdf-style-classic .image,
    .pdf-document-root.pdf-style-classic table,
    .pdf-document-root.pdf-style-classic .artifacts {
      max-width: none;
    }

    .pdf-document-root.pdf-style-classic .image {
      margin: 15px 0;
      text-align: left;
    }

    .pdf-document-root.pdf-style-classic .image img {
      margin: 0;
      border: 0;
    }

    .pdf-document-root.pdf-style-classic .markdown-image {
      margin: 15px 0;
      border: 0;
    }

    .pdf-document-root.pdf-style-classic pre {
      background: #1e1e1e;
      color: #d4d4d4;
      border: 0;
      border-radius: 6px;
    }

    .pdf-document-root.pdf-style-classic a {
      color: #2196f3;
      text-decoration: none;
    }

    @media print {
      .pdf-document-root {
        padding: 0;
      }

      .message {
        break-inside: auto;
      }

      .role {
        break-after: avoid;
        page-break-after: avoid;
      }
    }
  `
}
