/**
 * PDF export functionality using html2canvas + jsPDF
 */

import type { Conversation, ExportOptions, ChatMessage } from './types'
import { cleanText } from './dom-utils'

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
  const title = escapeHtml(conversation.title || 'Untitled Conversation')
  const platform = conversation.platform === 'chatgpt' ? 'ChatGPT' : conversation.platform === 'gemini' ? 'Google Gemini' : conversation.platform === 'claude' ? 'Claude' : conversation.platform === 'deepseek' ? 'DeepSeek' : conversation.platform === 'grok' ? 'Grok' : conversation.platform
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    ${getPrintStyles()}
  </style>
</head>
<body>
  <div class="conversation">
    ${options.includeMetadata ? generateMetadataSection(conversation, platform) : ''}
    
    <div class="messages">
      ${conversation.messages.map(msg => generateMessageHtml(msg, options)).join('\n')}
    </div>
    
    ${options.exportArtifacts ? generateArtifactsHtml(conversation, options) : ''}
    
    <footer>
      <hr>
      <p>Exported from ${platform} on ${new Date().toLocaleDateString()}</p>
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
function generateMetadataSection(conversation: Conversation, platform: string): string {
  const createdInfo = conversation.createdAt
    ? `<p><strong>Created:</strong> ${new Date(conversation.createdAt).toLocaleString()}</p>`
    : ''
  
  return `
    <header>
      <h1>${escapeHtml(conversation.title || 'Untitled Conversation')}</h1>
      <div class="metadata">
        <p><strong>Platform:</strong> ${platform}</p>
        <p><strong>URL:</strong> <a href="${escapeHtml(conversation.url)}">${escapeHtml(conversation.url)}</a></p>
        <p><strong>Messages:</strong> ${conversation.messages.length}</p>
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
function generateMessageHtml(message: ChatMessage, options: ExportOptions): string {
  const roleClass = message.role === 'user' ? 'user' : 'assistant'
  const roleLabel = message.role === 'user' ? '👤 User' : '🤖 Assistant'
  const authorInfo = message.authorName ? ` (${escapeHtml(message.authorName)})` : ''
  
  let content = ''
  
  // Add timestamp
  if (message.timestamp && options.includeMetadata) {
    const time = new Date(message.timestamp).toLocaleTimeString()
    content += `<span class="timestamp">${time}</span>\n`
  }
  
  // Add content
  if (message.content) {
    content += `<div class="content">${formatHtmlContent(cleanText(message.content))}</div>\n`
  }
  
  // Add code blocks
  if (options.includeCodeBlocks && message.codeBlocks?.length) {
    message.codeBlocks.forEach(block => {
      const lang = block.language ? ` data-language="${escapeHtml(block.language)}"` : ''
      content += `<pre${lang}><code>${escapeHtml(block.code)}</code></pre>\n`
    })
  }
  
  // Add images
  if (options.includeImages && message.attachments?.length) {
    const images = message.attachments.filter(a => a.type === 'image')
    images.forEach(img => {
      content += `<div class="image"><img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.name || 'Image')}" /></div>\n`
    })
  }
  
  return `\n    <div class="message ${roleClass}" style="page-break-inside: avoid;">\n      <div class="role">${roleLabel}${authorInfo}</div>\n      ${content}\n    </div>`
}

/**
 * Generate an "Artifacts" HTML section for PDF export (mirrors the markdown
 * "## Artifacts" block). Lists AI-generated artifacts and research-doc URLs
 * that parsers attached to `conversation.artifacts` or to individual messages.
 * User-uploaded document artifacts honor `includeUploadedFiles`.
 */
function generateArtifactsHtml(conversation: Conversation, options: ExportOptions): string {
  const refs: { name: string; url: string }[] = []
  const seen = new Set<string>()
  const add = (name: string, url: string) => {
    if (url && !seen.has(url)) {
      seen.add(url)
      refs.push({ name: name || url, url })
    }
  }

  for (const art of conversation.artifacts || []) {
    const isUploadedFile = art.type === 'document' && !art.content
    if (isUploadedFile && options.includeUploadedFiles === false) continue
    const url = art.url
    if (url) add(art.title || art.type, url)
  }

  for (const message of conversation.messages) {
    for (const att of message.attachments || []) {
      if (att.url && att.type !== 'image') add(att.name || att.url, att.url)
    }
  }

  if (refs.length === 0) return ''

  const items = refs.map(ref => {
    const name = escapeHtml(ref.name)
    // Only allow http(s)/mailto link targets (block javascript:/data:).
    const safe = /^(https?:|mailto:)/i.test(ref.url.trim()) ? ref.url.trim() : '#'
    return `<li><a href="${escapeHtml(safe)}">${name}</a></li>`
  }).join('\n')

  return `\n    <div class="artifacts">\n      <h2>Artifacts</h2>\n      <p><em>AI-generated artifacts and research documents referenced in this conversation:</em></p>\n      <ul>\n${items}\n      </ul>\n    </div>`
}

/**
 * Convert a single line of markdown inline formatting to HTML.
 * Handles bold, italic, inline code, links, and inline LaTeX.
 */
function inlineMarkdownToHtml(line: string): string {
  // Inline code `code`
  let result = line.replace(/`([^`]+)`/g, '<code>$1</code>')
  // Bold **text** or __text__
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  result = result.replace(/__(.+?)__/g, '<strong>$1</strong>')
  // Italic *text* or _text_ (but not inside ** or __)
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
  result = result.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<em>$1</em>')
  // Links [text](url) — block javascript:/data: URIs for safety
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text, url) => {
    const safeUrl = url.trim()
    if (/^(javascript|data|vbscript):/i.test(safeUrl)) {
      return text
    }
    return `<a href="${escapeHtml(safeUrl)}">${text}</a>`
  })
  return result
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

  for (const line of lines) {
    const trimmed = line.trim()

    // Empty line = paragraph break
    if (!trimmed) {
      closeBlockquote()
      continue
    }

    // Horizontal rule: ---, ***, ___
    if (/^[-*_]{3,}$/.test(trimmed)) {
      closeBlockquote()
      closeList()
      html += '<hr>\n'
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
function formatHtmlContent(content: string): string {
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
      // Escaping keeps the LaTeX delimiters visible while preventing a chat
      // message from becoming live HTML in the extension document.
      html += `<p class="latex">${escapeHtml(segment.content)}</p>\n`
    } else {
      // Regular text: convert markdown to HTML
      html += markdownTextToHtml(segment.content)
    }
  }
  
  return html
}

/**
 * Split content into code, LaTeX, and text segments for HTML generation
 */
function splitHtmlContentSegments(content: string): Array<{ type: 'text' | 'code' | 'latex'; content: string }> {
  const segments: Array<{ type: 'text' | 'code' | 'latex'; content: string }> = []
  
  // Match code blocks, display LaTeX ($$...$$), and inline LaTeX ($...$ or \(...\) or \[...\])
  const combinedRegex = /(```[\s\S]*?```|\$\$[\s\S]*?\$\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$[^$\n]+?\$)/g
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
function getPrintStyles(): string {
  return `
    @page {
      margin: 1in;
      size: A4;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
    
    header {
      margin-bottom: 30px;
    }
    
    h1 {
      color: #1a1a1a;
      margin-bottom: 10px;
    }
    
    .metadata {
      background: #f5f5f5;
      padding: 15px;
      border-radius: 8px;
      font-size: 0.9em;
    }
    
    .metadata p {
      margin: 5px 0;
    }
    
    hr {
      border: none;
      border-top: 1px solid #ddd;
      margin: 20px 0;
    }
    
    .message {
      margin-bottom: 25px;
      padding: 15px;
      border-radius: 8px;
    }
    
    .message.user {
      background: #e3f2fd;
      border-left: 4px solid #2196f3;
    }
    
    .message.assistant {
      background: #f5f5f5;
      border-left: 4px solid #4caf50;
    }
    
    .role {
      font-weight: 600;
      margin-bottom: 10px;
      color: #555;
    }
    
    .timestamp {
      font-size: 0.85em;
      color: #888;
      display: block;
      margin-bottom: 10px;
    }
    
    .content {
      white-space: normal;
      overflow-wrap: anywhere;
    }
    
    .content p {
      margin: 10px 0;
    }
    
    pre {
      background: #1e1e1e;
      color: #d4d4d4;
      padding: 15px;
      border-radius: 6px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      margin: 10px 0;
      page-break-inside: avoid;
    }
    
    code {
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      font-size: 0.9em;
    }

    .latex {
      font-family: 'Times New Roman', 'CMU Serif', Georgia, serif;
      font-style: italic;
      padding: 8px 0;
      margin: 8px 0;
    }
    
    .image {
      margin: 15px 0;
    }
    
    .image img {
      max-width: 100%;
      border-radius: 4px;
    }
    
    footer {
      margin-top: 40px;
      text-align: center;
      color: #666;
      font-size: 0.9em;
    }
    
    a {
      color: #2196f3;
      text-decoration: none;
    }
    
    @media print {
      body {
        padding: 0;
      }
      
      .message {
        break-inside: avoid;
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

/** Split a rendered document into bounded page crops. */
export function calculatePdfPageSlices(
  contentHeight: number,
  maxPageHeight: number,
  breakpoints: number[] = []
): PdfPageSlice[] {
  if (contentHeight <= 0 || maxPageHeight <= 0) return []

  const points = [...new Set(breakpoints)]
    .filter(point => point > 0 && point < contentHeight)
    .sort((a, b) => a - b)
  const slices: PdfPageSlice[] = []
  let start = 0

  while (start < contentHeight) {
    const target = Math.min(start + maxPageHeight, contentHeight)
    let end = target

    if (target < contentHeight) {
      const minimumUsefulPage = start + maxPageHeight * 0.6
      const safeBreak = points
        .filter(point => point >= minimumUsefulPage && point <= target)
        .at(-1)
      if (safeBreak !== undefined) end = safeBreak
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

function collectPdfBreakpoints(container: HTMLElement): number[] {
  const containerTop = container.getBoundingClientRect().top
  const selectors = [
    'header',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    '.role', '.timestamp',
    'p', 'li', 'pre', 'blockquote', '.image',
    '.artifacts', 'footer'
  ].join(',')
  const points: number[] = []

  container.querySelectorAll<HTMLElement>(selectors).forEach(element => {
    const rect = element.getBoundingClientRect()
    points.push(rect.top - containerTop)
    if (!/^H[1-6]$/.test(element.tagName)) {
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
  options: ExportOptions
): Promise<Blob> {
  const html = conversationToHtml(conversation, options)
  
  // Create a hidden container for rendering
  const container = document.createElement('div')
  container.style.cssText = `
    position: absolute;
    left: -9999px;
    top: 0;
    width: 800px;
    box-sizing: border-box;
    background: white;
    padding: 40px;
  `
  container.innerHTML = html
  document.body.appendChild(container)
  
  try {
    // Reading layout after insertion resolves current styles without adding a
    // fixed delay to every item in a bulk export.
    const contentWidth = container.scrollWidth || 800
    const contentHeight = Math.max(
      container.scrollHeight,
      container.getBoundingClientRect().height
    )

    // Render bounded chunks. A single canvas for a long Gemini conversation
    // exceeds browser limits, while one html2canvas call per page is too slow.
    const html2canvas = await loadHtml2Canvas()

    // Load jsPDF and create PDF
    const jsPDF = await loadJsPDF()
    const pageSize = options.format === 'pdf' ? 'A4' : 'Letter'
    const dimensions = getPageSizeDimensions(pageSize as 'A4' | 'Letter')
    
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: pageSize.toLowerCase() as any
    })
    
    const imgWidth = dimensions.width - 20 // 10mm margins
    const pageHeight = dimensions.height - 20 // 10mm top and bottom margins

    const maxPageHeightPx = (contentWidth * pageHeight) / imgWidth
    const slices = calculatePdfPageSlices(
      contentHeight,
      maxPageHeightPx,
      collectPdfBreakpoints(container)
    )

    const bulkMode = options.pdfRenderMode === 'bulk'
    const renderScale = bulkMode ? 1.5 : 2
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
      sourceHeight: number
    ) => {
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
    }

    for (const chunk of chunks) {
      let chunkCanvas: HTMLCanvasElement | null = null
      try {
        chunkCanvas = await renderChunk(chunk.start, chunk.height)
        if (isProbablyBlackCanvas(chunkCanvas)) {
          throw new Error('PDF render chunk was black')
        }
      } catch (error) {
        // A failed or black multi-page chunk falls back to single-page renders
        // without restarting the whole bulk export.
        if (chunk.slices.length === 1) throw error
        for (const slice of chunk.slices) {
          const pageCanvas = await renderChunk(slice.start, slice.height)
          if (isProbablyBlackCanvas(pageCanvas)) {
            throw new Error('PDF page rendering failed')
          }
          appendPage(pageCanvas, 0, pageCanvas.height)
        }
        continue
      }

      const pixelsPerCssPixel = chunkCanvas.height / Math.ceil(chunk.height)
      for (const slice of chunk.slices) {
        const relativeStart = slice.start - chunk.start
        const sourceY = Math.round(relativeStart * pixelsPerCssPixel)
        const sourceEnd = Math.round(
          (relativeStart + slice.height) * pixelsPerCssPixel
        )
        appendPage(chunkCanvas, sourceY, Math.max(1, sourceEnd - sourceY))
      }
    }
    
    // Return as Blob
    return pdf.output('blob')
  } finally {
    // Clean up temporary DOM elements
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
  filename: string
): Promise<void> {
  // Ensure filename has .pdf extension
  if (!filename.endsWith('.pdf')) {
    filename += '.pdf'
  }
  
  // Generate PDF blob
  const blob = await exportToPdfBlob(conversation, options)
  
  // Create object URL
  const url = URL.createObjectURL(blob)
  
  try {
    // Auto-download using chrome.downloads API
    await chrome.downloads.download({
      url,
      filename,
      saveAs: false
    })
  } finally {
    // Clean up object URL
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

/**
 * Download conversation as HTML file
 * @param conversation - The conversation
 * @param options - Export options
 */
