/**
 * Conversation title resolution.
 *
 * Providers sometimes hand out placeholder titles (empty, "Untitled
 * Conversation", or a raw conversation UUID). The popup resolves such titles
 * once, at detection time, from the already-fetched tab title (stripping the
 * provider suffix) or the first user message — so the heading, the filename
 * preflight, the preview hand-off and the download all share one resolved
 * conversation. The helper is pure: a real provider title is returned
 * untouched and the input conversation is never mutated.
 */
import type { Conversation } from './types'

const PLACEHOLDER_TITLE = 'Untitled Conversation'
const UUID_TITLE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PROVIDER_NAMES = ['ChatGPT', 'Claude', 'Gemini', 'DeepSeek', 'Grok']
const PROVIDER_SUFFIX_PATTERN = /\s*[-–|]\s*(ChatGPT|Claude|Gemini|DeepSeek|Grok).*$/i

/** True when the title carries no user-meaningful name. */
export function isPlaceholderConversationTitle(title: string | null | undefined): boolean {
  return !title || title === PLACEHOLDER_TITLE || UUID_TITLE_PATTERN.test(title)
}

/**
 * Resolve a usable title for a conversation without mutating it. Returns the
 * original object when the provider title is real or no better source exists;
 * otherwise returns a shallow copy with the resolved title.
 */
export function resolveConversationTitle(conversation: Conversation, tabTitle?: string | null): Conversation {
  if (!isPlaceholderConversationTitle(conversation.title)) return conversation

  let betterTitle = ''
  if (tabTitle) {
    const cleaned = tabTitle.replace(PROVIDER_SUFFIX_PATTERN, '').trim()
    if (cleaned.length > 0 && !PROVIDER_NAMES.includes(cleaned)) {
      betterTitle = cleaned
    }
  }

  if (!betterTitle && conversation.messages.length > 0) {
    const firstUserMessage = conversation.messages.find(message => message.role === 'user')
    if (firstUserMessage) betterTitle = firstUserMessage.content.substring(0, 80)
  }

  return betterTitle ? { ...conversation, title: betterTitle } : conversation
}
