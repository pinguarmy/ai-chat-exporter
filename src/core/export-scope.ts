import type { Conversation } from './types'
import { t, type Locale } from './i18n'

/** A source may be verified while the user's output is deliberately partial. */
export function partialExportNotice(conversation: Conversation, locale: Locale = 'en'): string | null {
  if (!conversation.selection) return null
  return t('Partial export: {0} of {1} messages. This is not a complete conversation archive.', locale,
    conversation.messages.length, conversation.selection.originalMessageCount)
}

export function partialFilenameSuffix(conversation: Conversation): string {
  return conversation.selection ? conversation.selection.mode === 'last-answer' ? '-last-answer' : '-selected' : ''
}
