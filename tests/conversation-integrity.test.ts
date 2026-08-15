import { describe, expect, it } from 'vitest'
import type { Conversation } from '../src/lib/types'
import {
  analyzeConversationIntegrity,
  conversationIntegrityError,
  isConversationComplete,
  isConversationExportable,
} from '../src/lib/conversation-integrity'

const conversation = (messages: Conversation['messages']): Conversation => ({
  id: 'integrity-test',
  title: 'Integrity test',
  url: 'https://example.test/chat/integrity-test',
  platform: 'chatgpt',
  messages,
})

describe('conversation integrity gate', () => {
  it('rejects missing and empty conversations', () => {
    expect(analyzeConversationIntegrity(null).status).toBe('empty')
    expect(analyzeConversationIntegrity(conversation([])).status).toBe('empty')
    expect(isConversationComplete(null)).toBe(false)
    expect(isConversationExportable(null)).toBe(false)
  })

  it('marks legacy user-only results as recoverable but not exportable', () => {
    const userOnly = conversation([
      { id: 'u1', role: 'user', content: 'Question' },
    ])
    const result = analyzeConversationIntegrity(userOnly)
    expect(result.status).toBe('suspicious')
    expect(result.shouldAttemptFallback).toBe(true)
    expect(result.reasons).toContain('assistant_messages_missing')
    expect(isConversationComplete(userOnly)).toBe(false)
    expect(isConversationExportable(userOnly)).toBe(false)
    expect(conversationIntegrityError(result)).toContain('assistant')
  })

  it('accepts a legacy non-empty user/assistant transcript', () => {
    const balanced = conversation([
      { id: 'u1', role: 'user', content: 'Question' },
      { id: 'a1', role: 'assistant', content: 'Answer' },
    ])
    const result = analyzeConversationIntegrity(balanced)
    expect(result.status).toBe('complete')
    expect(result.userCount).toBe(1)
    expect(result.assistantCount).toBe(1)
    expect(isConversationComplete(balanced)).toBe(true)
    expect(isConversationExportable(balanced)).toBe(true)
  })

  it('accepts a provider-verified one-sided transcript as complete for archiving', () => {
    const verified: Conversation = {
      ...conversation([{ id: 'u1', role: 'user', content: 'Prompt then Stop' }]),
      platform: 'claude',
      source: 'api',
      sourceCompleteness: 'verified',
    }
    const result = analyzeConversationIntegrity(verified)
    expect(result.status).toBe('suspicious')
    expect(result.reasons).toContain('assistant_messages_missing')
    expect(isConversationExportable(verified)).toBe(true)
    expect(isConversationComplete(verified)).toBe(true)
  })

  it('rejects a balanced but explicitly unverified DOM snapshot', () => {
    const unverified: Conversation = {
      ...conversation([
        { id: 'u1', role: 'user', content: 'Visible question' },
        { id: 'a1', role: 'assistant', content: 'Visible answer' },
      ]),
      platform: 'claude',
      source: 'dom',
      sourceCompleteness: 'unverified',
    }
    const result = analyzeConversationIntegrity(unverified)
    expect(result.status).toBe('complete')
    expect(result.reasons).toContain('source_unverified')
    expect(result.shouldAttemptFallback).toBe(true)
    expect(isConversationExportable(unverified)).toBe(false)
    expect(isConversationComplete(unverified)).toBe(false)
    expect(conversationIntegrityError(result)).toContain('could not be verified')
  })
})
