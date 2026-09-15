import type { ChatMessage, MessageReference } from './types'
import { dedupeMessageReferences, isPrivateReferenceUrl, normalizeReferenceTitle, sanitizeReferenceUrl } from './message-references'

type RecordValue = Record<string, unknown>
const record = (value: unknown): value is RecordValue => Boolean(value && typeof value === 'object' && !Array.isArray(value))

/** Normalize nested provider sources before touching the private-use delimiters. */
export function normalizeChatGptReferences(text: string, values: unknown): Pick<ChatMessage, 'content' | 'references' | 'citationSpans' | 'referenceDiagnostics'> {
  const references: MessageReference[] = []
  const byId = new Map<string, MessageReference[]>()
  const byMarker = new Map<string, MessageReference[]>()
  const walk = (value: unknown, parent: RecordValue = {}, depth = 0): MessageReference[] => {
    if (depth > 12) return []
    if (Array.isArray(value)) return value.flatMap(child => walk(child, parent, depth + 1))
    if (!record(value)) return []
    const raw = { ...parent, ...value }
    const typeName = String(raw.type || '').toLowerCase()
    if (raw.invalid === true || /hidden|memory/.test(typeName) || String(raw.matched_text || '').includes('memcite')) return []
    const children = ['items', 'sources', 'refs', 'references'].flatMap(key => walk(value[key], { ...raw, title: undefined, name: undefined, url: undefined, cloud_doc_url: undefined }, depth + 1))
    const url = sanitizeReferenceUrl(raw.cloud_doc_url ?? raw.url)
    const title = normalizeReferenceTitle(raw.title ?? raw.name, '')
    const found = [...children]
    if (title || url) {
      const type = /file/.test(typeName) ? 'file' : /web|source|citation/.test(typeName) ? 'web' : 'unknown'
      const connector = [raw.source, raw.api_tool_source, raw.plugin, raw.connector].some(v => typeof v === 'string' && /my_files|plugin|connector|files\//i.test(v))
      found.push({ type, title: title || (url ? new URL(url).hostname : ''), ...(url ? { url } : {}), private: !url || type === 'unknown' || connector || isPrivateReferenceUrl(url) })
    }
    for (const key of ['ref_id', 'id', 'source_id']) if (typeof value[key] === 'string') byId.set(value[key] as string, found)
    if (record(value.ref_id)) {
      const ref = value.ref_id
      if (ref.turn_index !== undefined && ref.ref_index !== undefined) byId.set(`turn${ref.turn_index}${ref.ref_type || 'search'}${ref.ref_index}`, found)
    }
    if (typeof raw.matched_text === 'string') byMarker.set(raw.matched_text, found)
    return found
  }
  references.push(...dedupeMessageReferences(walk(values)))
  const citationSpans: NonNullable<ChatMessage['citationSpans']> = []
  const referenceDiagnostics: NonNullable<ChatMessage['referenceDiagnostics']> = []
  let content = ''
  // Do not rewrite code examples. Preserve fenced and inline code verbatim.
  const chunks = text.trim().split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g)
  for (const chunk of chunks) {
    if (/^`|^~~~/.test(chunk)) { content += chunk; continue }
    const cleanChunk = chunk.replace(/[\uE000-\uE1FF]+(?:filecite|memcite)[\uE000-\uF8FF\w-]*/g, '')
    let cursor = 0
    const markers = /\uE200([\s\S]*?)\uE201/g
    for (const match of cleanChunk.matchAll(markers)) {
      content += cleanChunk.slice(cursor, match.index)
      cursor = match.index! + match[0].length
      const body = match[1]
      if (/^(memcite|filecite)/.test(body) && !byMarker.has(match[0])) continue
      if (body.startsWith('entity')) {
        try {
          const entity = JSON.parse(body.slice('entity'.length).replace(/^\uE202/, ''))
          if (Array.isArray(entity) && typeof entity[1] === 'string') { content += entity[1]; continue }
        } catch {}
      }
      const ids = body.match(/turn[\w-]+/g) || []
      const found = dedupeMessageReferences(byMarker.get(match[0]) || ids.flatMap(id => byId.get(id) || []))
      if (found.length) {
        const indices = found.map(ref => references.findIndex(item => item.type === ref.type && item.title === ref.title && item.url === ref.url)).filter(i => i >= 0)
        const label = found.map(ref => `[${ref.title}]`).join(' ')
        const start = content.length
        content += label
        citationSpans.push({ start, end: content.length, referenceIndexes: indices })
      } else {
        referenceDiagnostics.push({ code: 'unresolved_provider_reference', marker: match[0] })
        content += '[Unresolved reference]'
      }
    }
    content += cleanChunk.slice(cursor)
  }
  return { content, references: references.length ? references : undefined, citationSpans: citationSpans.length ? citationSpans : undefined, referenceDiagnostics: referenceDiagnostics.length ? referenceDiagnostics : undefined }
}
