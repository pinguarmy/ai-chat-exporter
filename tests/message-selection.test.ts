import { describe, expect, it } from 'vitest'
import { selectConversationMessages } from '../src/lib/message-selection'
import type { Conversation } from '../src/lib/types'

const conversation: Conversation = {
  id: 'c', title: 'Chat', url: '', platform: 'gemini', sourceCompleteness: 'verified',
  messages: [
    { id: 'same', role: 'user', content: 'Question' },
    { id: 'same', role: 'assistant', content: 'Answer', attachments: [{ type: 'file', url: '', name: 'notes' }], references: [{ type: 'web', title: 'Source' }] },
    { id: '3', role: 'user', content: 'Follow-up' },
  ],
  artifacts: [{ type: 'document', content: 'other' }],
  events: [{ id: 'event', kind: 'tool_call', toolName: 'tool', status: 'unknown', content: 'private' }],
  rawProviderPayload: 'private', traceCoverage: 'provider-exposed',
}

describe('message selection', () => {
  it('preserves order and message details while excluding unrelated conversation data', () => {
    const result = selectConversationMessages(conversation, 'selected', [2, 1])!
    expect(result.messages).toEqual([conversation.messages[1], conversation.messages[2]])
    expect(result.messages[0].attachments).toEqual(conversation.messages[1].attachments)
    expect(result.messages[0].references).toEqual(conversation.messages[1].references)
    expect(result.selection).toEqual({ kind: 'message-selection', mode: 'selected', originalMessageCount: 3, selectedMessageIds: ['same', '3'], selectedMessageIndexes: [1, 2] })
    expect(result.artifacts).toBeUndefined()
    expect(result.events).toBeUndefined()
    expect(result.rawProviderPayload).toBeUndefined()
    expect(result.traceCoverage).toBeUndefined()
    expect(conversation.artifacts).toHaveLength(1)
    expect(conversation.messages).toHaveLength(3)
  })
  it('distinguishes duplicate ids, finds the last assistant, and handles empty or full scopes', () => {
    expect(selectConversationMessages(conversation, 'selected', [1])?.messages).toEqual([conversation.messages[1]])
    expect(selectConversationMessages(conversation, 'last-answer', [])?.messages).toEqual([conversation.messages[1]])
    expect(selectConversationMessages(conversation, 'selected', [])).toBeNull()
    expect(selectConversationMessages({ ...conversation, messages: [conversation.messages[0]] }, 'last-answer', [])).toBeNull()
    expect(selectConversationMessages(conversation, 'all', [])).toBe(conversation)
    expect(selectConversationMessages(conversation, 'selected', [2, 0, 1])).toBe(conversation)
  })
})
