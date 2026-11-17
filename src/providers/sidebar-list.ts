/**
 * Sidebar-derived conversation list shared by the provider parsers.
 *
 * This is the DOM fallback used when the provider history API is unavailable.
 * It only sees links the page has rendered (sidebars are virtualized), so its
 * result is never complete and callers must report it as `complete: false`.
 */
import type { ConversationListItem } from '../core/types'
import { extractTextContent } from '../core/dom-utils'

export interface SidebarListOptions {
  /**
   * Selectors tried from most to least specific. The first selector that
   * yields at least one conversation wins; broader selectors are not mixed in.
   */
  selectors: readonly string[]
  platform: ConversationListItem['platform']
  /** Extract a conversation id from an href, or `null` to ignore the link. */
  resolveId: (href: string) => string | null | undefined
  root?: ParentNode
  /** Base for relative hrefs; defaults to the current page origin. */
  origin?: string
}

export function collectSidebarConversationList(options: SidebarListOptions): ConversationListItem[] {
  const root = options.root ?? document
  const origin = options.origin ?? window.location.origin
  const conversations: ConversationListItem[] = []
  const seen = new Set<string>()

  for (const selector of options.selectors) {
    root.querySelectorAll(selector).forEach(link => {
      const href = link.getAttribute('href')
      if (!href) return

      const id = options.resolveId(href)
      if (!id || seen.has(id)) return

      seen.add(id)
      conversations.push({
        id,
        title: extractTextContent(link) || 'Untitled Conversation',
        url: new URL(href, origin).href,
        platform: options.platform
      })
    })

    if (conversations.length > 0) break
  }

  return conversations
}
