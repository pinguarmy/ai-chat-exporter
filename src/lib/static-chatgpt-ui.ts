/** A deliberately small, inert subset of ChatGPT layout markup. Never evaluate JSX. */
import { escapeHtml } from './dom-utils'

type Node = { tag: string; attrs: Record<string, string>; children: Array<Node | string> }
export type StaticUiSegment = { type: 'text' | 'ui' | 'source'; content: string }
const TAGS = new Set(['grid', 'grid-item', 'box', 'caption', 'title'])
const ATTRS: Record<string, string[]> = {
  grid: ['columns', 'gap'], 'grid-item': [],
  box: ['background', 'radius', 'padding', 'gap'], caption: [], title: ['size', 'color'],
}
const COLORS: Record<string, string> = {
  default: '#202124', secondary: '#63666b',
  'surface-primary': '#ffffff', 'surface-secondary': '#f3f4f6',
}
const RADII: Record<string, number> = { none: 0, sm: 4, md: 8, lg: 12 }
const SIZES: Record<string, number> = { sm: 14, md: 18, lg: 24, xl: 30 }

function number(value: string, min: number, max: number): boolean {
  return /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max
}

function validAttribute(tag: string, key: string, value: string): boolean {
  if (!ATTRS[tag].includes(key)) return false
  if (key === 'columns') return number(value, 1, 4)
  if (key === 'gap' || key === 'padding') return number(value, 0, 8)
  if (key === 'radius') return Object.hasOwn(RADII, value)
  if (key === 'size') return Object.hasOwn(SIZES, value)
  if (key === 'background') return ['surface-primary', 'surface-secondary'].includes(value)
  return key === 'color' && ['default', 'secondary'].includes(value)
}

/** Parse only quoted strings and integer literals, never expressions, spreads or event handlers. */
function parse(source: string): Node | null {
  if (source.length > 64_000) return null
  const root: Node = { tag: '', attrs: {}, children: [] }
  const stack = [root]
  // Sticky matching fails at the current character; it cannot rescan a long
  // run of unmatched '<' characters quadratically looking for a later token.
  const tokens = /<[^<>]*>|[^<]+/y
  let cursor = 0
  let count = 0
  while (cursor < source.length) {
    tokens.lastIndex = cursor
    const token = tokens.exec(source)
    if (!token || ++count > 1000) return null
    const value = token[0]
    cursor += value.length
    if (!value.startsWith('<')) {
      // Non-leaf text must be whitespace. Braces in text may be JSX expressions.
      if (/[{}]/.test(value)) return null
      if (value.trim() && !['caption', 'title'].includes(stack.at(-1)!.tag)) return null
      stack.at(-1)!.children.push(value)
      continue
    }
    const closing = value.match(/^<\/([a-z-]+)\s*>$/)
    if (closing) {
      if (stack.length === 1 || stack.at(-1)!.tag !== closing[1]) return null
      stack.pop()
      continue
    }
    const opening = value.match(/^<([a-z-]+)((?:\s[\s\S]*)?)>$/)
    if (!opening || !TAGS.has(opening[1]) || stack.length > 24) return null
    const tag = opening[1]
    const parent = stack.at(-1)!
    if (['caption', 'title'].includes(parent.tag)) return null
    if (parent.tag === 'grid' && tag !== 'grid-item') return null
    if (tag === 'grid-item' && parent.tag !== 'grid') return null
    const attrs: Record<string, string> = {}
    let rest = opening[2]
    while (rest.trim()) {
      const attr = rest.match(/^\s+([a-z-]+)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)'|\{(\d+)\})/)
      if (!attr || Object.hasOwn(attrs, attr[1])) return null
      const v = attr[2] ?? attr[3] ?? attr[4]
      if (!validAttribute(tag, attr[1], v)) return null
      attrs[attr[1]] = v
      rest = rest.slice(attr[0].length)
    }
    const node: Node = { tag, attrs, children: [] }
    parent.children.push(node)
    stack.push(node)
  }
  const children = root.children.filter(child => typeof child !== 'string' || child.trim())
  if (cursor !== source.length || stack.length !== 1 || children.length !== 1) return null
  const node = children[0]
  return typeof node !== 'string' && ['grid', 'box'].includes(node.tag) ? node : null
}

function render(node: Node): string {
  const a = node.attrs
  const styles = ['box-sizing:border-box', 'min-width:0', 'overflow-wrap:anywhere']
  // Flexbox is supported by html2canvas; CSS grid is not reliably painted there.
  if (node.tag === 'grid') styles.push('display:flex', 'flex-wrap:wrap', `gap:${Number(a.gap ?? 2) * 4}px`)
  if (node.tag === 'grid-item' || node.tag === 'box') styles.push('display:flex', 'flex-direction:column')
  if (node.tag === 'box') {
    styles.push(`background:${COLORS[a.background ?? 'surface-primary']}`, `border-radius:${RADII[a.radius ?? 'none']}px`, `padding:${Number(a.padding ?? 0) * 4}px`, `gap:${Number(a.gap ?? 0) * 4}px`, 'height:100%')
  }
  if (node.tag === 'caption') styles.push('font-size:12px', 'line-height:1.5', 'color:#63666b')
  if (node.tag === 'title') styles.push(`font-size:${SIZES[a.size ?? 'md']}px`, 'font-weight:600', 'line-height:1.3', `color:${COLORS[a.color ?? 'default']}`)
  const columns = Number(a.columns ?? 1)
  const gap = Number(a.gap ?? 2) * 4
  const children = node.children.map(child => {
    if (typeof child === 'string') return escapeHtml(child)
    let html = render(child)
    if (node.tag === 'grid') {
      const width = `calc((100% - ${(columns - 1) * gap}px) / ${columns})`
      html = html.replace('style="', `style="flex:0 0 ${width};max-width:${width};`)
    }
    return html
  }).join('')
  return `<div class="ace-static-ui-${node.tag}" style="${styles.join(';')}">${children}</div>`
}

/** Public for focused regression tests. A rejected block must stay readable as source. */
export function renderStaticChatGptUi(source: string): string | null {
  const node = parse(source.trim())
  return node ? `<div class="ace-static-ui" style="margin:12px 0;color:#202124">${render(node)}</div>` : null
}

/**
 * Recognize standalone raw blocks only. Code fences and inline code stay source.
 * A blank line terminates a candidate; unsupported/malformed blocks stay intact.
 */
export function splitStaticChatGptUi(content: string): StaticUiSegment[] {
  if (content.length > 256_000) return [{ type: 'text', content }]
  const lines = content.split('\n')
  const result: StaticUiSegment[] = []
  let pending: string[] = []
  let fence = ''
  let inlineCode = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (marker && !inlineCode) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = ''
      pending.push(line)
      continue
    }
    if (!fence && !inlineCode && /^ {0,3}<(?:grid|box)(?:\s|>)/.test(line)) {
      let end = i
      let source = line
      let html = renderStaticChatGptUi(source)
      // Convert complete roots independently. Never silently delete orphan closers.
      while (!html && source.length <= 64_000 && end - i < 1000 && end + 1 < lines.length && lines[end + 1].trim() && !/^\s*(?:`{3,}|~{3,})/.test(lines[end + 1])) {
        source += '\n' + lines[++end]
        if (/<\/(?:grid|box)\s*>\s*$/.test(lines[end])) html = renderStaticChatGptUi(source)
      }
      if (pending.length) result.push({ type: 'text', content: pending.join('\n') })
      pending = []
      result.push(html ? { type: 'ui', content: html } : { type: 'source', content: source })
      i = end
    } else {
      pending.push(line)
      if (!fence) {
        for (const run of line.matchAll(/`+/g)) {
          if (run.index! > 0 && line[run.index! - 1] === '\\') continue
          if (!inlineCode) inlineCode = run[0].length
          else if (run[0].length === inlineCode) inlineCode = 0
        }
      }
    }
  }
  if (pending.length) result.push({ type: 'text', content: pending.join('\n') })
  return result
}
