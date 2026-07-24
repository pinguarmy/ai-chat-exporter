/**
 * Grok has used more than one conversation route. Keep route recognition
 * intentionally structural so the sidebar remains a useful fallback when its
 * identifier is not a hexadecimal UUID.
 */
export function getGrokConversationId(href: string): string | null {
  try {
    const path = new URL(href, 'https://grok.com').pathname
    const match = path.match(/^\/(?:chat|c|conversation)\/([^/?#]+)$/i)
    return match?.[1] ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}
