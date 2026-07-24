import { describe, expect, it } from 'vitest'
import { hasUsableConversation } from '../src/lib/bulk-conversation'

describe('bulk conversation validation', () => {
  it('accepts a content-bearing conversation whose Gemini ID differs only by c_ prefix', () => {
    expect(hasUsableConversation({
      id: 'abc123',
      messages: [{ id: 'm1', role: 'assistant', content: 'Real answer' }]
    }, 'c_abc123')).toBe(true)
  })

  it('rejects a content-bearing conversation from a different tab', () => {
    expect(hasUsableConversation({
      id: 'opened-chat',
      messages: [{ id: 'm1', role: 'assistant', content: 'Wrong conversation' }]
    }, 'requested-chat')).toBe(false)
  })

  it('rejects metadata-only conversations so bulk export never writes empty documents', () => {
    expect(hasUsableConversation({ id: 'requested-chat', messages: [] }, 'requested-chat')).toBe(false)
    expect(hasUsableConversation({
      id: 'requested-chat',
      messages: [{ id: 'm1', role: 'user', content: '   ' }]
    }, 'requested-chat')).toBe(false)
  })
})
