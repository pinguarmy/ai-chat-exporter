import type { Conversation } from './types'

export type MessageSelectionMode = 'all' | 'selected' | 'last-answer'

/** Derive an export without changing provider order or the source conversation. */
export function selectConversationMessages(
  conversation: Conversation,
  mode: MessageSelectionMode,
  selectedIndexes: number[],
): Conversation | null {
  if (mode === 'all') return conversation
  const indexes = new Set(selectedIndexes)
  let lastAnswerIndex = -1
  if (mode === 'last-answer') {
    for (let index = conversation.messages.length - 1; index >= 0; index--) {
      if (conversation.messages[index].role === 'assistant') { lastAnswerIndex = index; break }
    }
  }
  const includedIndexes = conversation.messages.flatMap((_, index) =>
    (mode === 'last-answer' ? index === lastAnswerIndex : indexes.has(index)) ? [index] : [])
  const messages = includedIndexes.map(index => conversation.messages[index])
  if (!messages.length) return null
  if (messages.length === conversation.messages.length) return conversation
  const { artifacts: _artifacts, events: _events, rawProviderPayload: _raw, traceCoverage: _trace, ...rest } = conversation
  return {
    ...rest,
    messages,
    selection: {
      kind: 'message-selection', mode,
      originalMessageCount: conversation.messages.length,
      selectedMessageIds: messages.map(message => message.id),
      selectedMessageIndexes: includedIndexes,
    },
  }
}
