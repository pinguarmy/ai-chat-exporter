/**
 * Claude-specific rich text extraction.
 *
 * Claude renders answers as semantic HTML in the page, while its detail API
 * normally returns Markdown-like text blocks.  Keeping this conversion here
 * prevents the generic whitespace cleaner from flattening a response before
 * it reaches the Markdown/PDF exporters.
 */

import { extractImage } from './dom-utils'

type RecordLike = Record<string, any>

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'dd', 'div', 'dl', 'dt', 'fieldset', 'figcaption',
  'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header',
  'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody',
  'td', 'tfoot', 'th', 'thead', 'tr', 'ul'
])

const IGNORED_TAGS = new Set(['button', 'script', 'style', 'template', 'noscript', 'svg'])

const NON_VISIBLE_API_BLOCK_TYPES = new Set([
  'thinking',
  'tool_use',
  'tool_result',
  'server_tool_use',
  'web_search_tool_result',
  'image',
  'document',
  'input_json'
])

function isRecord(value: unknown): value is RecordLike {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeLineEndings(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
}

/** Normalize generated Markdown without collapsing meaningful line breaks. */
export function normalizeClaudeMarkdown(value: string): string {
  const normalized = normalizeLineEndings(value)
  const segments = normalized.split(/(```[\s\S]*?```)/g)
  const result = segments.map((segment, index) => {
    if (index % 2 === 1) return segment
    return segment
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
  }).join('')
  return result.trim()
}

function textFromNode(node: Node, inPre = false): string {
  const value = node.textContent || ''
  if (inPre) return value
  // HTML whitespace is collapsed by the browser outside pre/code. Preserve a
  // single separating space so adjacent inline nodes do not concatenate.
  return value.replace(/\s+/g, ' ')
}

function inlineText(node: Node): string {
  const value = Array.from(node.childNodes)
    .map(child => renderNode(child, true))
    .join('')
  return value.replace(/\n+/g, ' ').replace(/[ \t]+/g, ' ').trim()
}

function safeLinkTarget(raw: string): string | null {
  const target = raw.trim()
  return /^(?:https?:|mailto:)/i.test(target) ? target : null
}

function renderTable(element: Element): string {
  const rows = Array.from(element.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr, :scope > tr'))
  if (rows.length === 0) return ''

  const cells = rows.map(row => Array.from(row.children)
    .filter(cell => ['td', 'th'].includes(cell.tagName.toLowerCase()))
    .map(cell => inlineText(cell).replace(/\|/g, '\\|')))
  const width = Math.max(...cells.map(row => row.length), 0)
  if (width === 0) return ''

  const padded = cells.map(row => [...row, ...Array(width - row.length).fill('')])
  const header = padded[0]
  const separator = Array(width).fill('---')
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
    ...padded.slice(1).map(row => `| ${row.join(' | ')} |`)
  ]
  return `\n\n${lines.join('\n')}\n\n`
}

function renderList(element: Element): string {
  const ordered = element.tagName.toLowerCase() === 'ol'
  const items = Array.from(element.children).filter(child => child.tagName.toLowerCase() === 'li')
  const lines: string[] = []

  items.forEach((item, index) => {
    const contentNodes = Array.from(item.childNodes).filter(node => {
      if (node.nodeType !== 1) return true
      const tag = (node as Element).tagName.toLowerCase()
      return tag !== 'ul' && tag !== 'ol'
    })
    const content = normalizeClaudeMarkdown(contentNodes.map(node => renderNode(node, true)).join(' '))
    if (content) {
      const marker = ordered ? `${index + 1}. ` : '- '
      const contentLines = content.split('\n')
      lines.push(`${marker}${contentLines[0]}`)
      for (const continuation of contentLines.slice(1)) {
        if (continuation.trim()) lines.push(`  ${continuation}`)
      }
    }

    const nested = Array.from(item.children).find(child => {
      const tag = child.tagName.toLowerCase()
      return tag === 'ul' || tag === 'ol'
    })
    if (nested) {
      const nestedText = renderList(nested).trim()
      if (nestedText) {
        lines.push(...nestedText.split('\n').map(line => `  ${line}`))
      }
    }
  })

  return lines.length > 0 ? `\n\n${lines.join('\n')}\n\n` : ''
}

function renderNode(node: Node, inline = false): string {
  if (node.nodeType === 3) return textFromNode(node, false)
  if (node.nodeType !== 1) return ''

  const element = node as Element
  const tag = element.tagName.toLowerCase()
  if (IGNORED_TAGS.has(tag)) return ''

  if (tag === 'pre') {
    const codeElement = element.querySelector('code')
    const code = normalizeLineEndings(codeElement?.textContent || element.textContent || '').replace(/^\n|\n$/g, '')
    if (!code.trim()) return ''
    const className = codeElement?.getAttribute('class') || element.getAttribute('class') || ''
    const language = className.match(/(?:language|lang)-([\w+-]+)/i)?.[1] || ''
    return `\n\n\`\`\`${language}\n${code}\n\`\`\`\n\n`
  }

  if (tag === 'code') {
    const value = inlineText(element)
    return value ? `\`${value.replace(/\`/g, '\\\`')}\`` : ''
  }
  if (tag === 'br') return '\n'
  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1))
    const value = inlineText(element)
    return value ? `\n\n${'#'.repeat(level)} ${value}\n\n` : ''
  }
  if (tag === 'strong' || tag === 'b') {
    const value = inlineText(element)
    return value ? `**${value}**` : ''
  }
  if (tag === 'em' || tag === 'i') {
    const value = inlineText(element)
    return value ? `*${value}*` : ''
  }
  if (tag === 'del' || tag === 's' || tag === 'strike') {
    const value = inlineText(element)
    return value ? `~~${value}~~` : ''
  }
  if (tag === 'a') {
    const label = inlineText(element)
    const target = safeLinkTarget(element.getAttribute('href') || '')
    return label && target ? `[${label}](${target})` : label
  }
  if (tag === 'img') {
    const image = extractImage(element as HTMLImageElement)
    if (!image) return ''
    const alt = (image.alt || 'Image').replace(/[\r\n\[\]]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Image'
    const url = image.url.replace(/\)/g, '%29').replace(/\s/g, '%20')
    return `\n\n![${alt}](${url})\n\n`
  }
  if (tag === 'hr') return '\n\n---\n\n'
  if (tag === 'blockquote') {
    const value = normalizeClaudeMarkdown(Array.from(element.childNodes).map(child => renderNode(child)).join(' '))
    if (!value) return ''
    return `\n\n${value.split('\n').map(line => line.trim() ? `> ${line}` : '>').join('\n')}\n\n`
  }
  if (tag === 'ul' || tag === 'ol') return renderList(element)
  if (tag === 'table') return renderTable(element)

  const children = Array.from(element.childNodes).map(child => renderNode(child, inline)).join('')
  if (inline || !BLOCK_TAGS.has(tag)) return children
  return `\n\n${children}\n\n`
}

/** Convert Claude's semantic answer DOM to Markdown while preserving layout. */
export function claudeElementToMarkdown(element: Element): string {
  const clone = element.cloneNode(true) as Element
  const removeSelectors = [
    'button',
    'script',
    'style',
    'template',
    'noscript',
    '[data-testid*="tool" i]',
    '[data-testid*="activity" i]',
    '[data-testid*="status" i]',
    '[aria-label*="tool" i]',
    '[aria-label*="activity" i]',
    '[aria-label*="status" i]',
    '[class*="toolbar" i]',
    '[class*="action" i]',
    '[class*="copy" i]',
    '[class*="edit" i]',
    '[class*="regenerate" i]',
    '[class*="feedback" i]',
    '[class*="menu" i]'
  ]
  for (const selector of removeSelectors) {
    clone.querySelectorAll(selector).forEach(node => node.remove())
  }
  return normalizeClaudeMarkdown(renderNode(clone))
}

function visibleTextBlock(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : []
  if (isRecord(value)) {
    const type = typeof value.type === 'string' ? value.type.toLowerCase() : ''
    if (type && NON_VISIBLE_API_BLOCK_TYPES.has(type)) return []
    if (typeof value.text === 'string' && value.text.trim()) return [value.text]
    for (const key of ['content', 'parts', 'body', 'value', 'delta']) {
      if (key in value) {
        const nested = visibleTextBlock(value[key])
        if (nested.length > 0) return nested
      }
    }
    return []
  }
  if (!Array.isArray(value)) return []

  const chunks: string[] = []
  for (const item of value) {
    if (typeof item === 'string') {
      if (item.trim()) chunks.push(item)
      continue
    }
    if (!isRecord(item)) continue
    const type = typeof item.type === 'string' ? item.type.toLowerCase() : ''
    if (type && NON_VISIBLE_API_BLOCK_TYPES.has(type)) continue
    if (typeof item.text === 'string' && item.text.trim()) {
      chunks.push(item.text)
      continue
    }
    // A few Claude response shapes omit `type` but use a content object with
    // a visible text field. Do not recurse into explicitly hidden blocks.
    if (!type && typeof item.content === 'string' && item.content.trim()) {
      chunks.push(item.content)
      continue
    }
    if (!type) {
      for (const key of ['content', 'parts', 'body', 'value', 'delta']) {
        if (key in item) {
          chunks.push(...visibleTextBlock(item[key]))
          break
        }
      }
    }
  }
  return chunks
}

function recordIsNonVisible(value: RecordLike): boolean {
  const type = [value.type, value.message_type, value.messageType]
    .find(item => typeof item === 'string')
  const sender = [value.sender, value.sender_type, value.role]
    .find(item => typeof item === 'string')
  return (typeof type === 'string' && NON_VISIBLE_API_BLOCK_TYPES.has(type.toLowerCase())) ||
    (typeof sender === 'string' && ['tool', 'thinking'].includes(sender.toLowerCase()))
}

/** Extract only visible Claude API text blocks, preserving their Markdown. */
export function extractClaudeMessageMarkdown(value: RecordLike): string {
  if (recordIsNonVisible(value)) return ''
  const nested = isRecord(value.message) ? value.message : null
  const structured = [value.content, nested?.content]
  const fallback = [value.text, value.parts, value.body, nested?.text, nested?.parts, nested?.body]
  const structuredChunks = structured.flatMap(visibleTextBlock)
  const chunks = structuredChunks.length > 0 ? structuredChunks : fallback.flatMap(visibleTextBlock)
  const unique = Array.from(new Set(chunks.map(chunk => normalizeLineEndings(chunk).trim()).filter(Boolean)))
  return normalizeClaudeMarkdown(unique.join('\n\n'))
}
