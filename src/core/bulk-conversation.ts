import type { Conversation } from './types'
import { isConversationExportable } from './conversation-integrity'

function normalizeConversationId(id: string): string {
  return id.replace(/^c_/, '')
}

/**
 * Bulk export must never turn a failed detail request into a metadata-only
 * document. It also prevents a parser from returning the currently open chat
 * when the user asked for a different conversation.
 */
export function hasUsableConversation(
  conversation: Pick<Conversation, 'id' | 'messages' | 'sourceCompleteness'> | null | undefined,
  requestedId: string
): conversation is Pick<Conversation, 'id' | 'messages' | 'sourceCompleteness'> {
  if (!conversation || normalizeConversationId(conversation.id) !== normalizeConversationId(requestedId)) {
    return false
  }

  return isConversationExportable(conversation as Conversation)
}
