import type { MessageReference, ReferenceExportMode } from './types'

const PRIVATE_REFERENCE_HOSTS = [
  'mail.google.com',
  'drive.google.com',
  'docs.google.com',
  'calendar.google.com',
  'onedrive.live.com',
  'sharepoint.com',
]

/** Keep only portable HTTP(S) links and remove URL credentials. */
export function sanitizeReferenceUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const parsed = new URL(value.trim())
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    parsed.username = ''
    parsed.password = ''
    return parsed.href
  } catch {
    return undefined
  }
}

/** Account-scoped connector URLs can disclose private thread/document IDs. */
export function isPrivateReferenceUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return PRIVATE_REFERENCE_HOSTS.some(host => hostname === host || hostname.endsWith(`.${host}`))
  } catch {
    return true
  }
}

export function normalizeReferenceTitle(value: unknown, fallback = 'Source'): string {
  if (typeof value !== 'string') return fallback
  const normalized = value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
  return normalized || fallback
}

export function dedupeMessageReferences(references: MessageReference[]): MessageReference[] {
  const seen = new Set<string>()
  return references.filter(reference => {
    const key = `${reference.type}\u0000${reference.title}\u0000${reference.url || ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export interface RenderedMessageReference {
  title: string
  url?: string
}

/** Apply one privacy policy consistently across Markdown, PDF and Preview. */
export function renderableMessageReferences(
  references: MessageReference[] | undefined,
  mode: ReferenceExportMode = 'titles'
): RenderedMessageReference[] {
  if (mode === 'off' || !references?.length) return []
  return dedupeMessageReferences(references)
    .filter(reference => reference.type !== 'memory')
    .map(reference => {
      const title = normalizeReferenceTitle(reference.title)
      const allowUrl = Boolean(
        reference.url && (
          mode === 'all-links' ||
          (mode === 'safe-links' && reference.private === false)
        )
      )
      return allowUrl ? { title, url: reference.url } : { title }
    })
}
