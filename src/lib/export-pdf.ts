/**
 * PDF export functionality using html2canvas + jsPDF
 */

import type { Conversation, ExportOptions, ChatMessage, PdfStyle } from './types'
import { cleanText, stripProviderArtifacts } from './dom-utils'
import { isPrivateReferenceUrl, renderableExportUrl, renderableMessageReferences } from './message-references'
import { embedInlineImageAttachments, isInlineImageAttachment, removeInlineMarkdownImages } from './inline-media'
import { downloadAndWait } from './download-completion'
import type { DownloadWaitControl } from './download-completion'
import { throwIfExportCancelled } from './export-cancel'
import { isTranscriptVerified } from './conversation-integrity'
import { localeTag, t, type Locale } from './i18n'
import { sanitizePreviewHtml } from './preview-sanitize'
import { renderToString as renderLatexToString } from 'katex'

// Dynamic imports for jspdf and html2canvas
let jsPDFModule: any = null
let html2canvasModule: any = null

async function loadJsPDF() {
  if (!jsPDFModule) {
    jsPDFModule = await import('jspdf')
  }
  return jsPDFModule.jsPDF || jsPDFModule.default.jsPDF
}

async function loadHtml2Canvas() {
  if (!html2canvasModule) {
    html2canvasModule = await import('html2canvas')
  }
  return html2canvasModule.default || html2canvasModule
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
    
    <footer>
      <hr>
      <p>${escapeHtml(t(
        'Exported from {0} on {1}',
        locale,
        platform,
        new Date().toLocaleDateString(localeTag(locale))
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
  const createdInfo = conversation.createdAt
    ? `<p><strong>${escapeHtml(t('Created', locale))}:</strong> ${formatMessageTimestamp(conversation.createdAt, locale)}</p>`
    : ''
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
        : getAssistantDisplayName(conversation, options)
  )
  let content = ''
  let timestampHtml = ''

  // Keep the name and time in one compact heading. Separate stacked labels
  // looked sparse on a page and amplified letter-spacing at high zoom.
  if (message.timestamp && options.includeMetadata && options.showMessageTimestamps !== false) {
    const date = new Date(message.timestamp)
    const iso = Number.isNaN(date.getTime()) ? '' : date.toISOString()
    const time = formatMessageTimestamp(date, locale)
    if (time) timestampHtml = `<span class="meta-separator" aria-hidden="true">·</span><time class="timestamp" datetime="${iso}">${escapeHtml(time)}</time>`
  }
  
  const attachments = (message.attachments || []).filter(attachment =>
    !(options.includeUploadedFiles === false && attachment.uploaded === true && attachment.type !== 'image')
  )
  // An image returned as a provider handle must be placed where that handle
  // appeared in the transcript, not appended after the entire answer. DOM
  // parsers also emit Markdown images at their original node position.
  const inlineImages = embedInlineImageAttachments(message.content, attachments)
  const contentWithImageSetting = options.includeImages === false
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
  const refs: { title: string; url?: string }[] = []
  const seen = new Set<string>()
  const add = (name: string, url: string, isPrivate?: boolean) => {
    const rendered = renderableExportUrl(name, url, options.referenceExportMode, { private: isPrivate })
    if (!rendered) return
    const key = `${rendered.title}\u0000${rendered.url || ''}`
    if (seen.has(key)) return
    seen.add(key)
    refs.push(rendered)
  }

  for (const art of conversation.artifacts || []) {
    const isUploadedFile = art.uploaded === true || (art.type === 'document' && !art.content)
    if (isUploadedFile && options.includeUploadedFiles === false) continue
    if (art.content) continue
    const url = art.url
    if (url) add(art.title || art.type, url, isPrivateReferenceUrl(url))
  }

  for (const message of conversation.messages) {
    for (const att of message.attachments || []) {
      if (att.url && att.type !== 'image' && !(options.includeUploadedFiles === false && att.uploaded === true)) {
        add(att.name || att.url, att.url, isPrivateReferenceUrl(att.url))
      }
    }
  }

  const inlineArtifacts = (conversation.artifacts || []).filter(artifact => {
    const isUploadedFile = artifact.uploaded === true || (artifact.type === 'document' && !artifact.content)
    if (isUploadedFile && options.includeUploadedFiles === false) return false
    return Boolean(artifact.content || artifact.title || artifact.url)
  })

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
 * Escape HTML special characters
 * @param text - Text to escape
 * @returns Escaped text
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }
  return text.replace(/[&<>"']/g, char => map[char])
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

/**
 * Get PDF page dimensions based on page size
 * @param pageSize - Page size (A4 or Letter)
 * @returns Page dimensions in mm
 */
function getPageSizeDimensions(pageSize: 'A4' | 'Letter' = 'A4'): { width: number; height: number } {
  if (pageSize === 'Letter') {
    return { width: 216, height: 279 } // Letter in mm
  }
  return { width: 210, height: 297 } // A4 in mm
}

export interface PdfPageSlice {
  start: number
  height: number
}

export interface PdfRenderChunk {
  start: number
  height: number
  slices: PdfPageSlice[]
}

export interface PdfTextRun {
  text: string
  left: number
  top: number
  bottom: number
  right: number
  fontSize: number
  /** Browser-computed font styling is required for a faithful visible layer. */
  fontWeight?: number
  fontStyle?: string
  glyphs?: PdfTextGlyph[]
  /** Keep semantic source searchable while leaving a richer visual block alone. */
  searchOnly?: boolean
}

interface PdfTextGlyph {
  text: string
  left: number
  right: number
  top: number
  bottom: number
}

export interface PdfLinkRegion {
  url: string
  left: number
  top: number
  right: number
  bottom: number
}

function safePdfLinkTarget(value: string): string | null {
  const trimmed = value.trim()
  return /^(https?:|mailto:)/i.test(trimmed) ? trimmed : null
}

/** Read link rectangles from the same DOM used to rasterize each PDF page. */
export function collectPdfLinkRegions(container: HTMLElement): PdfLinkRegion[] {
  const containerRect = container.getBoundingClientRect()
  const regions: PdfLinkRegion[] = []

  container.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(anchor => {
    const url = safePdfLinkTarget(anchor.getAttribute('href') || anchor.href || '')
    if (!url) return

    const rects = Array.from(anchor.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0)
    for (const rect of rects) {
      regions.push({
        url,
        left: rect.left - containerRect.left,
        top: rect.top - containerRect.top,
        right: rect.right - containerRect.left,
        bottom: rect.bottom - containerRect.top
      })
    }
  })

  return regions
}

/**
 * Wait for image dimensions before measuring the document. A failed remote
 * image must not block export forever, so each image has a bounded timeout.
 */
async function waitForPdfImages(container: HTMLElement, timeoutMs = 6000, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return
  const images = Array.from(container.querySelectorAll<HTMLImageElement>('[data-pdf-block="image"] img, img[data-pdf-block="image"], .image img'))
  if (images.length === 0) return

  await Promise.all(images.map(image => {
    const removeIfUnavailable = () => {
      // Broken remote image URLs should not leave an empty framed box in the
      // PDF. Removing the figure also removes its pagination breakpoint.
      const renderedRect = image.getBoundingClientRect()
      const isTinyMarkdownAsset = image.classList.contains('markdown-image')
        && image.naturalWidth > 0
        && image.naturalHeight > 0
        && Math.max(image.naturalWidth, image.naturalHeight) < 120
        && Math.max(renderedRect.width, renderedRect.height) < 120
      if (image.complete && (image.naturalWidth === 0 || isTinyMarkdownAsset)) {
        const figure = image.closest('figure.image')
        if (figure) figure.remove()
        else image.remove()
        return true
      }
      return false
    }

    if (image.complete) {
      removeIfUnavailable()
      return Promise.resolve()
    }

    return new Promise<void>(resolve => {
      let settled = false
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      const finish = () => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', finish)
        image.removeEventListener('load', finish)
        image.removeEventListener('error', finish)
        if (timeoutId !== undefined) clearTimeout(timeoutId)
        removeIfUnavailable()
        resolve()
      }
      signal?.addEventListener('abort', finish, { once: true })
      image.addEventListener('load', finish, { once: true })
      image.addEventListener('error', finish, { once: true })
      timeoutId = setTimeout(finish, timeoutMs)
    })
  }))
}

/** Size figures from the actual page budget instead of a fixed pixel cap. */
export function fitPdfImages(container: HTMLElement, maxPageHeightPx: number): number {
  // A media block should read as media, not as a tiny thumbnail in a mostly
  // empty page. Keep enough headroom for the heading/caption while allowing a
  // portrait screenshot to use most of a dedicated page when needed.
  const maxHeight = Math.max(220, Math.floor(maxPageHeightPx * 0.72))
  const images = Array.from(container.querySelectorAll<HTMLImageElement>('[data-pdf-block="image"] img, img[data-pdf-block="image"], .image img'))
  images.forEach(image => {
    image.style.maxWidth = '100%'
    image.style.maxHeight = `${maxHeight}px`
    image.style.width = 'auto'
    image.style.height = 'auto'
  })

  // If the image would otherwise leave only a small remainder at the bottom
  // of its current page, use that remainder as the cap. This keeps a useful
  // image on the current page instead of manufacturing a mostly blank page.
  if (maxPageHeightPx > 0) {
    const containerTop = container.getBoundingClientRect().top
    images.forEach(image => {
      const rect = image.getBoundingClientRect()
      if (rect.height <= 0) return
      const top = rect.top - containerTop
      const nextPage = (Math.floor(top / maxPageHeightPx) + 1) * maxPageHeightPx
      const available = Math.floor(nextPage - top - 32)
      if (available >= 240 && rect.height > available) {
        image.style.maxHeight = `${available}px`
      }
    })
  }
  return maxHeight
}

function searchablePdfText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
    // STSong-Light is a BMP CJK font. Keeping surrogate pairs out of the
    // hidden layer avoids emitting invalid UCS-2 CIDs for emoji while leaving
    // the original emoji untouched in the raster visual layer.
    .replace(/[\uD800-\uDFFF]/g, '')
    .replace(/\u00A0/g, ' ')
}

/**
 * Keep the page image for backgrounds, rules, table fills, and image
 * attachments, but draw transcript text as PDF text on top. This prevents
 * zoom blur without changing the existing HTML pagination model.
 */
function hidePdfTextForVectorOverlay(container: HTMLElement): () => void {
  const style = document.createElement('style')
  style.textContent = `
    .pdf-vector-base, .pdf-vector-base * {
      color: transparent !important;
      text-shadow: none !important;
    }
    .pdf-vector-base a {
      text-decoration-color: transparent !important;
    }
    .pdf-vector-base ::marker {
      color: transparent !important;
    }
    /* MathML has its own glyph painting path. Keep the browser-rendered
       equation visible and add only its plain source to the searchable layer. */
    .pdf-vector-base .latex,
    .pdf-vector-base .latex * {
      color: #202124 !important;
    }
  `
  container.classList.add('pdf-vector-base')
  container.appendChild(style)
  return () => {
    style.remove()
    container.classList.remove('pdf-vector-base')
  }
}

function isIgnoredPdfTextElement(element: Element): boolean {
  return Boolean(element.closest('style, script, head, title, annotation, math, .latex, [aria-hidden="true"]'))
}

/**
 * Decide whether the browser text may safely be replaced by the visible PDF
 * vector layer. This must be stricter than "BMP only": Helvetica is written
 * as WinAnsi and the bundled CID path is deliberately limited to Chinese.
 * Any other script keeps the browser-rendered raster text visible.
 */
export function selectPdfVisualTextMode(
  container: HTMLElement,
  runs: PdfTextRun[]
): 'vector' | 'raster' {
  if (runs.length === 0) return 'raster'

  const showText = typeof NodeFilter === 'undefined' ? 4 : NodeFilter.SHOW_TEXT
  const walker = document.createTreeWalker(container, showText)
  let node: Node | null
  while ((node = walker.nextNode())) {
    const parent = node.parentElement
    if (!parent || isIgnoredPdfTextElement(parent)) continue
    try {
      const style = getComputedStyle(parent)
      if (style.display === 'none' || style.visibility === 'hidden') continue
    } catch {
      // A DOM shim without computed style still benefits from the conservative
      // encoding check below.
    }

    for (const character of node.textContent || '') {
      if (!isSupportedVisiblePdfCharacter(character)) return 'raster'
    }
  }
  return 'vector'
}

function shouldSeparatePdfRuns(previous: string, next: string): boolean {
  const left = previous.slice(-1)
  const right = next.slice(0, 1)
  return /[A-Za-z0-9)]/.test(left) && /[A-Za-z0-9(]/.test(right)
}

function pdfFontWeight(value: string | undefined): number {
  const parsed = Number.parseInt(value || '', 10)
  if (Number.isFinite(parsed)) return parsed
  return /bold|bolder/i.test(value || '') ? 700 : 400
}

function isPdfBold(weight: number | undefined): boolean {
  return (weight || 400) >= 600
}

function isPdfItalic(style: string | undefined): boolean {
  return /italic|oblique/i.test(style || '')
}

function helveticaStyle(weight: number | undefined, style: string | undefined): 'normal' | 'bold' | 'italic' | 'bolditalic' {
  if (isPdfBold(weight) && isPdfItalic(style)) return 'bolditalic'
  if (isPdfBold(weight)) return 'bold'
  if (isPdfItalic(style)) return 'italic'
  return 'normal'
}

function latexSearchText(value: string): string {
  return value
    .replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g, '$1')
    .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1 / $2')
    .replace(/\\(?:left|right|,|;|!|\s+)/g, ' ')
    .replace(/\\[A-Za-z]+/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extract browser line boxes into a lightweight text layer model. Character
 * ranges are used because a single Range rect does not tell us which text
 * belongs to which wrapped line.
 */
export function collectPdfTextRuns(container: HTMLElement): PdfTextRun[] {
  // Per-character Range measurement is the accurate way to preserve wrapped
  // lines, but it can monopolize the extension page for enormous transcripts.
  // In that exceptional case, returning no runs keeps the complete browser
  // rendering as the visual source instead of approximating layout.
  const MAX_RANGE_LAYOUT_CHARACTERS = 250_000
  if ((container.textContent || '').length > MAX_RANGE_LAYOUT_CHARACTERS) return []

  const containerRect = container.getBoundingClientRect()
  const showText = typeof NodeFilter === 'undefined' ? 4 : NodeFilter.SHOW_TEXT
  const walker = document.createTreeWalker(container, showText)
  const runs: PdfTextRun[] = []
  let node: Node | null

  while ((node = walker.nextNode())) {
    const parent = node.parentElement
    const value = node.textContent || ''
    if (!parent || !value.trim()) continue
    // MathML contains an <annotation> child carrying the original TeX source.
    // It is useful for accessibility in the HTML preview, but emitting that
    // hidden source into the PDF text layer would duplicate the equation and
    // make search results look like raw `\\[...\\]` markup.
    if (parent.closest('style, script, head, title, annotation, math, .latex, [aria-hidden="true"]')) continue

    let style: CSSStyleDeclaration | null = null
    try {
      style = getComputedStyle(parent)
      if (style.display === 'none' || style.visibility === 'hidden') continue
    } catch {
      // A DOM shim may not implement computed styles. Layout rects remain
      // sufficient for the optional text layer in that environment.
    }
    const fontSize = Math.max(1, Number.parseFloat(style?.fontSize || '16') || 16)
    const fontWeight = pdfFontWeight(style?.fontWeight)
    const fontStyle = style?.fontStyle || 'normal'
    const lineRuns = new Map<number, PdfTextRun>()
    const range = document.createRange()
    let pendingSpaces = 0

    for (let index = 0; index < value.length; index++) {
      const character = value[index]
      if (character === '\n' || character === '\r' || /[\uD800-\uDFFF]/.test(character)) continue
      try {
        range.setStart(node, index)
        range.setEnd(node, index + 1)
        const rect = Array.from(range.getClientRects()).find(item => item.width > 0 && item.height > 0)
        if (!rect) {
          // Browsers commonly omit collapsed whitespace from Range rects.
          // Hold it until the next visible glyph so copy/search preserves the
          // spaces that separate Latin identifiers and CJK text.
          if (character === ' ' || character === '\u00a0') pendingSpaces++
          continue
        }

        const top = rect.top - containerRect.top
        const bottom = rect.bottom - containerRect.top
        const lineKey = Math.round(top * 2) / 2
        const existing = lineRuns.get(lineKey)
        if (existing) {
          if (pendingSpaces > 0) {
            const spaceStart = existing.right
            const spaceEnd = Math.max(spaceStart, rect.left - containerRect.left)
            const spaceWidth = Math.max(fontSize * 0.22, (spaceEnd - spaceStart) / pendingSpaces)
            for (let spaceIndex = 0; spaceIndex < pendingSpaces; spaceIndex++) {
              const left = spaceStart + spaceIndex * spaceWidth
              existing.glyphs?.push({
                text: ' ',
                left,
                right: left + spaceWidth,
                top,
                bottom
              })
            }
            existing.text += ' '.repeat(pendingSpaces)
          }
          pendingSpaces = 0
          existing.text += character
          existing.left = Math.min(existing.left, rect.left - containerRect.left)
          existing.right = Math.max(existing.right, rect.right - containerRect.left)
          existing.bottom = Math.max(existing.bottom, bottom)
          existing.glyphs?.push({
            text: character,
            left: rect.left - containerRect.left,
            right: rect.right - containerRect.left,
            top,
            bottom
          })
        } else {
          pendingSpaces = 0
          lineRuns.set(lineKey, {
            text: character,
            left: rect.left - containerRect.left,
            top,
            bottom,
            right: rect.right - containerRect.left,
            fontSize,
            fontWeight,
            fontStyle,
            glyphs: [{
              text: character,
              left: rect.left - containerRect.left,
              right: rect.right - containerRect.left,
              top,
              bottom
            }]
          })
        }
      } catch {
        // Detached or otherwise malformed text nodes are safe to skip.
      }
    }

    runs.push(...lineRuns.values())
  }

  // MathML token nodes are intentionally excluded from the visible vector
  // layer. Keep a plain source string at the same location so search/copy
  // still finds the equation while browser-rendered MathML remains the visual
  // source (and does not get split into overlapping glyph runs).
  container.querySelectorAll<HTMLElement>('.latex[data-latex-source]').forEach(element => {
    const source = searchablePdfText(latexSearchText(element.getAttribute('data-latex-source') || ''))
    if (!source.trim()) return
    const rect = element.getBoundingClientRect()
    let style: CSSStyleDeclaration | null = null
    try {
      style = getComputedStyle(element)
    } catch {
      // A DOM shim may not expose computed style; the default is adequate.
    }
    const fontSize = Math.max(1, Number.parseFloat(style?.fontSize || '16') || 16)
    runs.push({
      text: source,
      left: rect.left - containerRect.left,
      top: rect.top - containerRect.top,
      bottom: rect.bottom - containerRect.top,
      right: rect.right - containerRect.left,
      fontSize,
      fontWeight: pdfFontWeight(style?.fontWeight),
      fontStyle: style?.fontStyle || 'normal',
      searchOnly: true
    })
  })

  const ordered = runs
    .map(run => ({
      ...run,
      text: searchablePdfText(run.text),
      glyphs: run.glyphs?.filter(glyph => searchablePdfText(glyph.text))
    }))
    .filter(run => run.text.trim())
    .sort((a, b) => a.top - b.top || a.left - b.left)

  // Merge adjacent inline nodes (for example <strong> and plain text) back
  // into one PDF line without joining separate table cells or columns.
  const merged: PdfTextRun[] = []
  for (const run of ordered) {
    const previous = merged.at(-1)
    const joinDistance = Math.max(8, run.fontSize * 2)
    if (
      previous &&
      previous.searchOnly === run.searchOnly &&
      previous.fontWeight === run.fontWeight &&
      previous.fontStyle === run.fontStyle &&
      Math.abs(previous.top - run.top) <= 2 &&
      run.left >= previous.left - 1 &&
      run.left <= previous.right + joinDistance
    ) {
      const separator = shouldSeparatePdfRuns(previous.text, run.text) ? ' ' : ''
      previous.text += separator + run.text
      if (separator && previous.glyphs) {
        previous.glyphs.push({
          text: separator,
          left: previous.right,
          right: run.left,
          top: run.top,
          bottom: run.bottom
        })
      }
      if (previous.glyphs && run.glyphs) previous.glyphs.push(...run.glyphs)
      previous.right = Math.max(previous.right, run.right)
      previous.bottom = Math.max(previous.bottom, run.bottom)
    } else {
      merged.push(run)
    }
  }
  return merged
}

function pdfUnicodeCmap(font: any): string {
  const entries = Object.keys(font.metadata.toUnicode || {})
    .map(Number)
    .sort((a, b) => a - b)
    .map(code => {
      const target = Number(font.metadata.toUnicode[code])
      return `<${code.toString(16).padStart(4, '0')}><${target.toString(16).padStart(4, '0')}>`
    })
  const chunks: string[] = []
  for (let index = 0; index < entries.length; index += 100) {
    const chunk = entries.slice(index, index + 100)
    chunks.push(`${chunk.length} beginbfchar\n${chunk.join('\n')}\nendbfchar`)
  }
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000><ffff>',
    'endcodespacerange',
    ...chunks,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end'
  ].join('\n')
}

/**
 * Install a tiny PDF-standard CJK font definition. STSong-Light is a
 * standard PDF CID font, so the extension does not need to ship a 5–20 MB
 * Chinese font file. The raster page remains the source for non-text visuals;
 * this font is used for the sharp visible/searchable text overlay.
 */
function installSearchablePdfFont(pdf: any, runs: PdfTextRun[]): { name: string; style: string; id: string } | null {
  if (typeof pdf?.addFont !== 'function' || !pdf.internal?.events?.getTopics) return null

  // jsPDF's bundled TTF listeners try to load a file whenever addFont is
  // called. Remove those per-document listeners before registering the
  // standard CID font; no later custom fonts are added to this document.
  const topics = pdf.internal.events.getTopics()
  for (const token of Object.keys(topics.addFont || {})) {
    pdf.internal.events.unsubscribe(token)
  }

  const name = '__ai_chat_exporter_cjk'
  // jsPDF 4.x treats the fourth argument as a font weight unless it is one
  // of its small set of legacy encodings. Pass the CJK encoding in the fifth
  // slot explicitly; UniGB-UCS2-H maps Unicode code points to the standard
  // STSong-Light CID font and is understood by Preview, Chrome and Poppler.
  pdf.addFont('STSong-Light', name, 'normal', undefined, 'UniGB-UCS2-H')
  const font = pdf.internal.getFont(name, 'normal')
  const widths: any = []
  widths.fof = 1000
  widths[0] = 1000
  // pdfEscape16 only needs to know whether a glyph has already been added;
  // using a constant-time lookup avoids scanning a huge array for every CJK
  // character in a long conversation.
  widths.indexOf = () => -1
  const codeMap: Record<string, number> = {}
  const toUnicode: Record<string, number> = {}
  for (const run of runs) {
    for (const character of run.text) {
      const code = character.charCodeAt(0)
      codeMap[code] = 1
      // Raw UniGB operators bypass jsPDF's pdfEscape16 helper, so populate
      // the ToUnicode map ourselves instead of relying on a later `text()`
      // call to discover the glyphs.
      toUnicode[code] = code
      // Match the browser's approximate advance widths so PDF extraction
      // does not invent a large gap between Latin words and CJK glyphs.
      if (code < 256) widths[code] = code === 32 ? 250 : 500
    }
  }
  font.metadata = {
    Unicode: { widths, kerning: { fof: 1000 } },
    cmap: { unicode: { codeMap } },
    glyIdsUsed: [0],
    toUnicode,
    characterToGlyph: (code: number) => code,
    widthOfGlyph: () => 1000
  }

  pdf.internal.events.subscribe('putFont', (args: any) => {
    if (args.font !== font) return

    const cmapObject = args.newObject()
    args.putStream({
      data: pdfUnicodeCmap(font),
      addLength1: true,
      objectId: cmapObject
    })
    args.out('endobj')

    const asciiWidths = Array.from({ length: 224 }, (_value, index) => index === 0 ? 250 : 500).join(' ')
    const descendant = args.newObject()
    args.out('<<')
    args.out('/Type /Font')
    args.out('/Subtype /CIDFontType0')
    args.out('/BaseFont /STSong-Light')
    args.out('/CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >>')
    args.out('/DW 1000')
    args.out(`/W [32 [${asciiWidths}] ]`)
    args.out('>>')
    args.out('endobj')

    font.objectNumber = args.newObject()
    args.out('<<')
    args.out('/Type /Font')
    args.out('/Subtype /Type0')
    args.out('/BaseFont /STSong-Light')
    args.out(`/ToUnicode ${cmapObject} 0 R`)
    args.out('/Encoding /UniGB-UCS2-H')
    args.out(`/DescendantFonts [${descendant} 0 R]`)
    args.out('>>')
    args.out('endobj')
    font.isAlreadyPutted = true
  })

  return { name, style: 'normal', id: font.id }
}

const PDF_POINTS_PER_MM = 72 / 25.4

function pdfTextHex(value: string): string {
  let hex = ''
  for (const character of value) {
    const codePoint = character.codePointAt(0) || 0
    if (codePoint > 0xffff) continue
    hex += codePoint.toString(16).padStart(4, '0')
  }
  return hex
}

const PDF_WIN_ANSI_BYTES: Record<number, number> = {
  0x2018: 0x91, 0x2019: 0x92, 0x201a: 0x82,
  0x201c: 0x93, 0x201d: 0x94, 0x201e: 0x84,
  0x2020: 0x86, 0x2021: 0x87, 0x2022: 0x95,
  0x2026: 0x85, 0x2030: 0x89, 0x2039: 0x8b,
  0x203a: 0x9b, 0x20ac: 0x80, 0x2122: 0x99,
  0x2013: 0x96, 0x2014: 0x97, 0x02c6: 0x88,
  0x02dc: 0x98, 0x0160: 0x8a, 0x0161: 0x9a,
  0x017d: 0x8e, 0x017e: 0x9e, 0x0192: 0x83
}

function pdfWinAnsiByte(character: string): number | null {
  const codePoint = character.codePointAt(0) || 0
  if (codePoint >= 0x20 && codePoint <= 0x7e) return codePoint
  if (codePoint >= 0xa0 && codePoint <= 0xff) return codePoint
  return PDF_WIN_ANSI_BYTES[codePoint] ?? null
}

function pdfAsciiHex(value: string): string {
  let hex = ''
  for (const character of value) {
    const byte = pdfWinAnsiByte(character)
    if (byte === null) continue
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

/** Widths used by the lightweight STSong / UniGB resource above. */
function pdfGlyphWidthUnits(value: string): number {
  let units = 0
  for (const character of value) {
    const codePoint = character.charCodeAt(0)
    if (codePoint > 0xffff) continue
    units += character === ' ' ? 250 : codePoint < 256 ? 500 : 1000
  }
  return units
}

function pdfNumber(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) < 0.0001) return '0'
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

function isCjkPdfCharacter(value: string): boolean {
  const codePoint = value.codePointAt(0) || 0
  return (
    (codePoint >= 0x3000 && codePoint <= 0x303f) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff01 && codePoint <= 0xff5e) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6)
  )
}

function isSupportedVisiblePdfCharacter(character: string): boolean {
  // Layout/control characters have no glyph for the visible layer. Zero-width
  // formatting marks are stripped by searchablePdfText and must not force a
  // raster fallback on otherwise supported prose.
  if (/^[\t\n\r]$/.test(character) || /^[\u0000-\u001f\u007f\u200b-\u200d\ufeff]$/.test(character)) {
    return true
  }
  return pdfWinAnsiByte(character) !== null || isCjkPdfCharacter(character)
}

function addPdfTextLayer(
  pdf: any,
  font: { name: string; style: string; id: string },
  runs: PdfTextRun[],
  pageStart: number,
  pageHeight: number,
  contentWidth: number,
  imageWidth: number,
  margin: number,
  renderingMode: 'invisible' | 'fill' = 'invisible'
): void {
  const mmPerCssPixel = imageWidth / contentWidth
  const pageEnd = pageStart + pageHeight
  const fontEntry = pdf.internal?.getFont?.(font.name, font.style)
  const fontId = fontEntry?.id || font.id
  if (!fontId || typeof pdf.internal?.write !== 'function') return
  pdf.setTextColor(
    renderingMode === 'fill' ? 32 : 0,
    renderingMode === 'fill' ? 33 : 0,
    renderingMode === 'fill' ? 36 : 0
  )
  if (renderingMode === 'fill' && typeof pdf.setDrawColor === 'function') {
    pdf.setDrawColor(32, 33, 36)
  }

  const writeSegment = (
    text: string,
    left: number,
    right: number,
    currentY: number,
    fontSize: number,
    searchOnly = false,
    fontWeight?: number,
    fontStyle?: string
  ): void => {
    const clean = searchablePdfText(text)
    if (!clean) return
    const containsCjk = [...clean].some(isCjkPdfCharacter)
    const asciiStyle = helveticaStyle(fontWeight, fontStyle)
    const asciiFont = !containsCjk
      ? pdf.internal?.getFont?.('helvetica', asciiStyle)
      : null
    const useAsciiFont = Boolean(asciiFont?.id)
    const activeFontId = useAsciiFont ? asciiFont.id : fontId
    const encodedText = useAsciiFont ? pdfAsciiHex(clean) : pdfTextHex(clean)
    if (!encodedText) return
    const targetWidth = Math.max(0, right - left) * mmPerCssPixel * PDF_POINTS_PER_MM
    // Helvetica has proportional Latin metrics. The old fixed 500-unit
    // approximation made short labels such as `gpt-5-6-thinking` compensate
    // with very large PDF character spacing, which becomes especially ugly
    // when Preview is zoomed in. Ask jsPDF for the real Helvetica advance and
    // reserve the simple 1em CJK metric for the CJK resource.
    const measuredAsciiWidth = useAsciiFont && typeof pdf.getStringUnitWidth === 'function'
      ? pdf.getStringUnitWidth(clean, { font: asciiFont, fontSize, charSpace: 0 }) * fontSize
      : 0
    const naturalWidth = measuredAsciiWidth > 0
      ? measuredAsciiWidth
      : (pdfGlyphWidthUnits(clean) / 1000) * fontSize
    const characterCount = Array.from(clean).length
    // Keep the text layer visually faithful without using `Tc` as a layout
    // engine. Short metadata needs almost no correction; a tight cap leaves
    // it compact while longer prose can absorb small browser/font differences.
    const maxCharSpace = characterCount <= 40 ? fontSize * 0.025 : fontSize * 0.06
    const charSpace = characterCount > 1
      ? Math.max(-maxCharSpace, Math.min(maxCharSpace, (targetWidth - naturalWidth) / (characterCount - 1)))
      : 0
    const x = margin + Math.max(0, left) * mmPerCssPixel
    const fauxBoldCjk = renderingMode === 'fill' && !searchOnly && containsCjk && isPdfBold(fontWeight)

    pdf.internal.write('BT')
    pdf.internal.write(`/${activeFontId} ${pdfNumber(fontSize)} Tf`)
    pdf.internal.write(`${pdf.internal.getCoordinateString(x)} ${pdf.internal.getVerticalCoordinateString(currentY)} Td`)
    // The PDF-standard STSong resource has no bold face. Fill+stroke gives
    // CJK strong text a compact vector faux-bold while English uses genuine
    // Helvetica-Bold/BoldOblique. Both stay selectable and sharp at zoom.
    pdf.internal.write(`${renderingMode === 'invisible' || searchOnly ? 3 : fauxBoldCjk ? 2 : 0} Tr`)
    if (fauxBoldCjk) pdf.internal.write(`${pdfNumber(Math.max(0.14, fontSize * 0.022))} w`)
    if (Math.abs(charSpace) >= 0.01) pdf.internal.write(`${pdfNumber(charSpace)} Tc`)
    pdf.internal.write(`<${encodedText}> Tj`)
    if (Math.abs(charSpace) >= 0.01) pdf.internal.write('0 Tc')
    pdf.internal.write('ET')
    if (fauxBoldCjk) pdf.internal.write('0 w')
  }

  for (const run of runs) {
    if (run.top < pageStart - 1 || run.top >= pageEnd - 0.5) continue
    const text = searchablePdfText(run.text)
    if (!text.trim()) continue
    // jsPDF font sizes are points. The DOM measurements are CSS pixels, so
    // convert px -> mm using the page scale and then mm -> points. The old
    // implementation omitted the second conversion and produced a tiny,
    // visibly different overlay at normal zoom.
    const fontSize = Math.max(
      4.5,
      Math.min(36, run.fontSize * mmPerCssPixel * PDF_POINTS_PER_MM)
    )
    const currentY = margin + Math.min(pageHeight - 0.5, Math.max(1, run.bottom - pageStart)) * mmPerCssPixel
    // A range built from one DOM text node gives us exact per-character boxes.
    // Split CJK and Latin runs so identifiers and URLs keep a normal sans
    // face instead of inheriting the wide STSong CJK metrics.
    const glyphs = run.glyphs?.filter(glyph => searchablePdfText(glyph.text))
    if (!glyphs?.length) {
      writeSegment(text, run.left, run.right, currentY, fontSize, run.searchOnly, run.fontWeight, run.fontStyle)
      continue
    }

    let segmentText = ''
    let segmentLeft = glyphs[0].left
    let segmentRight = glyphs[0].right
    let segmentCjk = isCjkPdfCharacter(glyphs[0].text)
    for (const glyph of glyphs) {
      const glyphCjk = isCjkPdfCharacter(glyph.text)
      if (segmentText && glyphCjk !== segmentCjk) {
        writeSegment(segmentText, segmentLeft, segmentRight, currentY, fontSize, run.searchOnly, run.fontWeight, run.fontStyle)
        segmentText = ''
        segmentLeft = glyph.left
        segmentCjk = glyphCjk
      }
      if (!segmentText) segmentLeft = glyph.left
      segmentText += glyph.text
      segmentRight = glyph.right
    }
    if (segmentText) writeSegment(segmentText, segmentLeft, segmentRight, currentY, fontSize, run.searchOnly, run.fontWeight, run.fontStyle)
  }
}

function addPdfLinkLayer(
  pdf: any,
  links: PdfLinkRegion[],
  pageStart: number,
  pageHeight: number,
  contentWidth: number,
  imageWidth: number,
  margin: number
): void {
  if (typeof pdf?.link !== 'function') return

  const mmPerCssPixel = imageWidth / contentWidth
  const pageEnd = pageStart + pageHeight
  for (const link of links) {
    if (link.bottom <= pageStart || link.top >= pageEnd) continue

    const top = Math.max(pageStart, link.top)
    const bottom = Math.min(pageEnd, link.bottom)
    const left = Math.max(0, link.left)
    const right = Math.min(contentWidth, link.right)
    const width = Math.max(0, right - left) * mmPerCssPixel
    const height = Math.max(0, bottom - top) * mmPerCssPixel
    if (width < 0.5 || height < 0.5) continue

    pdf.link(
      margin + left * mmPerCssPixel,
      margin + (top - pageStart) * mmPerCssPixel,
      width,
      height,
      { url: link.url }
    )
  }
}

function collectPdfImageBreakpoints(container: HTMLElement, maxPageHeightPx: number): number[] {
  const containerTop = container.getBoundingClientRect().top
  return Array.from(container.querySelectorAll<HTMLElement>('[data-pdf-block="image"], .image'))
    .flatMap(element => {
      const rect = element.getBoundingClientRect()
      const top = rect.top - containerTop
      const bottom = rect.bottom - containerTop
      // Only force a new page when the image still crosses the next nominal
      // page boundary after dynamic fitting. Images that fit stay with the
      // preceding text and avoid a large blank remainder.
      const nextPage = Math.ceil((top + 1) / maxPageHeightPx) * maxPageHeightPx
      return bottom > nextPage ? [top] : []
    })
    .filter(point => point > 0)
}

function measurePdfContentHeight(container: HTMLElement): number {
  const containerTop = container.getBoundingClientRect().top
  const root = container.querySelector<HTMLElement>('.conversation')
  const rootBottom = root
    ? root.getBoundingClientRect().bottom - containerTop
    : container.scrollHeight
  const measured = Math.max(container.scrollHeight || 0, rootBottom)
  if (measured <= 0) return 0
  // The temporary wrapper has 40px of padding for canvas safety. Measuring
  // the conversation root avoids turning that trailing padding into an empty
  // final PDF page.
  return Math.max(1, Math.min(container.scrollHeight || rootBottom, rootBottom + 2))
}

/** Split a rendered document into bounded page crops. */
export function calculatePdfPageSlices(
  contentHeight: number,
  maxPageHeight: number,
  breakpoints: number[] = [],
  preferredBreakpoints: number[] = []
): PdfPageSlice[] {
  if (contentHeight <= 0 || maxPageHeight <= 0) return []

  const points = [...new Set(breakpoints)]
    .filter(point => point > 0 && point < contentHeight)
    .sort((a, b) => a - b)
  const slices: PdfPageSlice[] = []
  let start = 0

  while (start < contentHeight) {
    const remaining = contentHeight - start
    // Layout rounding and the hidden render wrapper can leave a few pixels
    // after the final real block. Do not turn that tail into a blank PDF page.
    if (slices.length > 0 && remaining <= 8) {
      slices[slices.length - 1].height += remaining
      break
    }
    const target = Math.min(start + maxPageHeight, contentHeight)
    let end = target

    if (target < contentHeight) {
      const minimumUsefulPage = start + maxPageHeight * 0.6
      const preferred = [...new Set(preferredBreakpoints)]
        .filter(point => point >= start + maxPageHeight * 0.25 && point <= target)
        .sort((a, b) => a - b)
        .at(-1)
      const safeBreak = points
        .filter(point => point >= minimumUsefulPage && point <= target)
        .at(-1)
      if (preferred !== undefined) end = preferred
      else if (safeBreak !== undefined) end = safeBreak
    }

    if (end <= start + 1) end = target
    slices.push({ start, height: end - start })
    start = end
  }

  return slices
}

/** Group adjacent pages into a canvas-safe render chunk. */
export function groupPdfPageSlices(
  slices: PdfPageSlice[],
  maxChunkHeight: number
): PdfRenderChunk[] {
  if (maxChunkHeight <= 0) return []

  const chunks: PdfRenderChunk[] = []
  let current: PdfRenderChunk | null = null

  for (const slice of slices) {
    const sliceEnd = slice.start + slice.height
    const nextHeight = current ? sliceEnd - current.start : slice.height

    if (current && nextHeight > maxChunkHeight) {
      chunks.push(current)
      current = null
    }

    if (!current) {
      current = { start: slice.start, height: slice.height, slices: [slice] }
    } else {
      current.slices.push(slice)
      current.height = sliceEnd - current.start
    }
  }

  if (current) chunks.push(current)
  return chunks
}

function isProbablyBlackCanvas(canvas: HTMLCanvasElement): boolean {
  if (typeof canvas.getContext !== 'function') return false
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context || canvas.width === 0 || canvas.height === 0) return false

  try {
    let black = 0
    let samples = 0
    for (let y = 0; y < canvas.height; y += Math.max(1, Math.floor(canvas.height / 12))) {
      for (let x = 0; x < canvas.width; x += Math.max(1, Math.floor(canvas.width / 12))) {
        const pixel = context.getImageData(x, y, 1, 1).data
        if (pixel[0] < 12 && pixel[1] < 12 && pixel[2] < 12) black++
        samples++
      }
    }
    return samples > 0 && black / samples > 0.9
  } catch {
    return false
  }
}

/**
 * Detect a crop that contains only a layout rule (or no ink at all). Browser
 * layout rounding can leave a final slice with a message border but no
 * readable content; emitting it creates a visually blank PDF page.
 */
function isLayoutOnlyCanvas(canvas: HTMLCanvasElement): boolean {
  if (typeof canvas.getContext !== 'function') return false
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context || canvas.width === 0 || canvas.height === 0) return false

  try {
    const stepX = Math.max(1, Math.floor(canvas.width / 160))
    const stepY = Math.max(1, Math.floor(canvas.height / 160))
    let minY = canvas.height
    let maxY = -1
    let hits = 0

    for (let y = 0; y < canvas.height; y += stepY) {
      for (let x = 0; x < canvas.width; x += stepX) {
        const pixel = context.getImageData(x, y, 1, 1).data
        if (pixel[3] > 0 && Math.min(pixel[0], pixel[1], pixel[2]) < 240) {
          minY = Math.min(minY, y)
          maxY = Math.max(maxY, y)
          hits++
        }
      }
    }

    if (hits === 0) return true
    return maxY - minY <= Math.max(10, Math.floor(canvas.height * 0.01))
  } catch {
    return false
  }
}

function collectPdfBreakpoints(container: HTMLElement): number[] {
  const containerTop = container.getBoundingClientRect().top
  const selectors = [
    'header',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    '.message', '.message-meta', '.role', '.timestamp',
    'p', 'li', 'pre', 'blockquote', 'table', 'tr',
    '.artifacts', 'footer'
  ].join(',')
  const points: number[] = []

  container.querySelectorAll<HTMLElement>(selectors).forEach(element => {
    const rect = element.getBoundingClientRect()
    points.push(rect.top - containerTop)
    // A conversation heading or timestamp is only a useful break point before it. A
    // break immediately after either one leaves an orphaned "Assistant"
    // heading at the bottom of a PDF page (a common failure in long chats).
    if (!/^H[1-6]$/.test(element.tagName) && !element.matches('.message-meta, .role, .timestamp')) {
      points.push(rect.bottom - containerTop)
    }
  })

  // Range rects expose the browser's actual line boxes. Their bottoms are safe
  // crop points even when one paragraph is taller than a whole PDF page.
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    const parent = node.parentElement
    if (!node.textContent?.trim() || !parent) continue
    if (parent.closest('style, script, h1, h2, h3, h4, h5, h6, .role')) continue

    const range = document.createRange()
    range.selectNodeContents(node)
    if (typeof range.getClientRects !== 'function') continue
    for (const rect of range.getClientRects()) {
      points.push(rect.bottom - containerTop + 1)
    }
  }

  return points
}

/**
 * Export conversation to PDF blob
 * @param conversation - The conversation
 * @param options - Export options
 * @returns PDF as Blob
 */
export async function exportToPdfBlob(
  conversation: Conversation,
  options: ExportOptions,
  signal?: AbortSignal
): Promise<Blob> {
  throwIfExportCancelled(signal)
  const html = conversationToHtml(conversation, options)
  
  // Create a hidden container for rendering
  const container = document.createElement('div')
  const pdfStyle: PdfStyle = options.pdfStyle === 'classic' ? 'classic' : 'minimal'
  // `innerHTML` parses this full document as a fragment, so the generated
  // <body> class does not become the render root's class. Mirror the document
  // root classes onto the actual element passed to html2canvas.
  container.classList.add('pdf-document-root', `pdf-style-${pdfStyle}`)
  container.style.cssText = `
    position: absolute;
    left: -9999px;
    top: 0;
    width: 800px;
    box-sizing: border-box;
    background: white;
    padding: 40px;
  `
  // The wrapper is our own trusted markup (layout plus the <style> block from
  // getPrintStyles), so it is inserted as-is. Sanitizing here instead would
  // strip that stylesheet and destroy the PDF layout — the untrusted parts are
  // already sanitized where they are produced, in formatHtmlContent() and
  // generateArtifactsHtml().
  container.innerHTML = html
  // The footer is useful in the HTML/preview representation, but in a
  // paginated PDF it can become the only element on a final otherwise blank
  // page. The document title/platform metadata already carries provenance.
  container.querySelector('footer')?.remove()
  document.body.appendChild(container)
  let restoreVectorBase: (() => void) | null = null
  
  try {
    await waitForPdfImages(container, 6000, signal)
    throwIfExportCancelled(signal)

    // Reading layout after insertion resolves current styles without adding a
    // fixed delay to every item in a bulk export.
    const contentWidth = container.scrollWidth || 800

    // Render bounded chunks. A single canvas for a long Gemini conversation
    // exceeds browser limits, while one html2canvas call per page is too slow.
    const html2canvas = await loadHtml2Canvas()
    throwIfExportCancelled(signal)

    // Load jsPDF and create PDF
    const jsPDF = await loadJsPDF()
    throwIfExportCancelled(signal)
    const pageSize = options.format === 'pdf' ? 'A4' : 'Letter'
    const dimensions = getPageSizeDimensions(pageSize as 'A4' | 'Letter')
    
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: pageSize.toLowerCase() as any,
      // The custom STSong resource is written by a PDF event hook while the
      // page text itself is emitted as raw UniGB operators. Keep resources
      // deterministic so the hook cannot be skipped by jsPDF's used-font
      // bookkeeping.
      putOnlyUsedFonts: false
    })
    
    const imgWidth = dimensions.width - 20 // 10mm margins
    const pageHeight = dimensions.height - 20 // 10mm top and bottom margins

    const maxPageHeightPx = (contentWidth * pageHeight) / imgWidth
    fitPdfImages(container, maxPageHeightPx)
    const contentHeight = measurePdfContentHeight(container)
    const textRuns = options.pdfTextLayer === false ? [] : collectPdfTextRuns(container)
    const linkRegions = collectPdfLinkRegions(container)
    const searchableFont = textRuns.length > 0 ? installSearchablePdfFont(pdf, textRuns) : null
    const useVectorText = Boolean(
      searchableFont && selectPdfVisualTextMode(container, textRuns) === 'vector'
    )
    restoreVectorBase = useVectorText ? hidePdfTextForVectorOverlay(container) : null
    const slices = calculatePdfPageSlices(
      contentHeight,
      maxPageHeightPx,
      collectPdfBreakpoints(container),
      collectPdfImageBreakpoints(container, maxPageHeightPx)
    )

    const bulkMode = options.pdfRenderMode === 'bulk'
    // 3x keeps the raster fallback and image-heavy pages readable when users
    // zoom in. Vector text is drawn separately below, so this is primarily an
    // image/background quality setting in the normal path.
    const renderScale = bulkMode ? 2 : 3
    const preferredPagesPerChunk = bulkMode ? 4 : 3
    const maxHeightByPixels = 8192 / renderScale
    const maxHeightByArea = 16_000_000 / (contentWidth * renderScale * renderScale)
    const maxChunkHeight = Math.max(
      maxPageHeightPx,
      Math.min(
        maxPageHeightPx * preferredPagesPerChunk,
        maxHeightByPixels,
        maxHeightByArea
      )
    )
    const chunks = groupPdfPageSlices(slices, maxChunkHeight)
    const jpegQuality = bulkMode ? 0.9 : 0.96
    let pageIndex = 0

    const renderChunk = (start: number, height: number) => html2canvas(container, {
      scale: renderScale,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      imageTimeout: 6000,
      y: start,
      width: contentWidth,
      height: Math.ceil(height),
      windowWidth: contentWidth,
      windowHeight: Math.ceil(height)
    })

    const appendPage = (
      sourceCanvas: HTMLCanvasElement,
      sourceY: number,
      sourceHeight: number,
      pageStart: number,
      pageCssHeight: number
    ): boolean => {
      const pageCanvas = document.createElement('canvas')
      pageCanvas.width = sourceCanvas.width
      pageCanvas.height = sourceHeight
      const context = pageCanvas.getContext('2d')
      if (!context) throw new Error('Unable to create PDF page canvas')
      context.drawImage(
        sourceCanvas,
        0, sourceY, sourceCanvas.width, sourceHeight,
        0, 0, sourceCanvas.width, sourceHeight
      )

      if (pageStart > 0 && isLayoutOnlyCanvas(pageCanvas) && !useVectorText) return false

      if (pageIndex > 0) pdf.addPage()
      pageIndex++
      const renderedHeight = Math.min(
        (pageCanvas.height * imgWidth) / pageCanvas.width,
        pageHeight
      )
      pdf.addImage(
        pageCanvas.toDataURL('image/jpeg', jpegQuality),
        'JPEG',
        10,
        10,
        imgWidth,
        renderedHeight,
        undefined,
        'FAST'
      )
      if (searchableFont) {
        addPdfTextLayer(
          pdf,
          searchableFont,
          textRuns,
          pageStart,
          pageCssHeight,
          contentWidth,
          imgWidth,
          10,
          useVectorText ? 'fill' : 'invisible'
        )
      }
      addPdfLinkLayer(
        pdf,
        linkRegions,
        pageStart,
        pageCssHeight,
        contentWidth,
        imgWidth,
        10
      )
      return true
    }

    for (const chunk of chunks) {
      // html2canvas does not expose an AbortSignal API. Check on both sides
      // of every bounded chunk so Stop takes effect before the next expensive
      // raster pass or PDF append.
      throwIfExportCancelled(signal)
      let chunkCanvas: HTMLCanvasElement | null = null
      try {
        chunkCanvas = await renderChunk(chunk.start, chunk.height)
        throwIfExportCancelled(signal)
        if (isProbablyBlackCanvas(chunkCanvas)) {
          throw new Error('PDF render chunk was black')
        }
      } catch (error) {
        // A failed or black multi-page chunk falls back to single-page renders
        // without restarting the whole bulk export.
        if (chunk.slices.length === 1) throw error
        for (const slice of chunk.slices) {
          throwIfExportCancelled(signal)
          const pageCanvas = await renderChunk(slice.start, slice.height)
          throwIfExportCancelled(signal)
          if (isProbablyBlackCanvas(pageCanvas)) {
            throw new Error('PDF page rendering failed')
          }
          appendPage(pageCanvas, 0, pageCanvas.height, slice.start, slice.height)
        }
        continue
      }

      const pixelsPerCssPixel = chunkCanvas.height / Math.ceil(chunk.height)
      for (const slice of chunk.slices) {
        throwIfExportCancelled(signal)
        const relativeStart = slice.start - chunk.start
        const sourceY = Math.round(relativeStart * pixelsPerCssPixel)
        const sourceEnd = Math.round(
          (relativeStart + slice.height) * pixelsPerCssPixel
        )
        appendPage(
          chunkCanvas,
          sourceY,
          Math.max(1, sourceEnd - sourceY),
          slice.start,
          slice.height
        )
      }
    }
    
    // Return as Blob
    return pdf.output('blob')
  } finally {
    // Clean up temporary DOM elements
    restoreVectorBase?.()
    document.body.removeChild(container)
  }
}

/**
 * Export conversation to PDF and auto-download
 * @param conversation - The conversation
 * @param options - Export options
 * @param filename - Filename for the downloaded file
 */
export async function exportToPdf(
  conversation: Conversation,
  options: ExportOptions,
  filename: string,
  downloadControl: DownloadWaitControl & { saveAs?: boolean } = {}
): Promise<void> {
  throwIfExportCancelled(downloadControl.signal)
  // Ensure filename has .pdf extension
  if (!filename.endsWith('.pdf')) {
    filename += '.pdf'
  }
  
  // Generate PDF blob
  const blob = await exportToPdfBlob(conversation, options, downloadControl.signal)
  throwIfExportCancelled(downloadControl.signal)
  
  // Create object URL
  const url = URL.createObjectURL(blob)
  
  try {
    // Auto-download using chrome.downloads API
    await downloadAndWait({
      url,
      filename,
      saveAs: downloadControl.saveAs ?? false
    }, 60_000, chrome.downloads, downloadControl)
  } finally {
    // Clean up object URL
    URL.revokeObjectURL(url)
  }
}

/**
 * Download conversation as HTML file
 * @param conversation - The conversation
 * @param options - Export options
 */
