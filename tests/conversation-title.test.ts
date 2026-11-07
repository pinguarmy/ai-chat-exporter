/**
 * Conversation title resolution (pure helper).
 *
 * The popup must resolve placeholder titles (empty / "Untitled Conversation"
 * / raw UUID) once, at detection time, from the already-fetched tab title or
 * the first user message — so the heading, the filename preflight, the
 * preview hand-off and the download all share the same conversation object.
 * The helper is pure: a real provider title is returned untouched and the
 * input conversation is never mutated.
 */
import { describe, expect, it } from 'vitest'
import { isPlaceholderConversationTitle, resolveConversationTitle } from '../src/lib/conversation-title'
import type { Conversation } from '../src/lib/types'

const UUID_TITLE = '3f2a1b9c-6d4e-4f0a-9b8c-7d6e5f4a3b2c'

function makeConversation(overrides: Record<string, unknown> = {}): Conversation {
  return {
    id: 'c1',
    title: 'Quarterly planning notes',
    platform: 'chatgpt',
    url: 'https://chatgpt.com/c/c1',
    messages: [
      { id: 'u1', role: 'user', content: 'Summarize the quarterly plan' },
      { id: 'a1', role: 'assistant', content: 'Here is the summary' },
    ],
    ...overrides,
  } as unknown as Conversation
}

describe('isPlaceholderConversationTitle', () => {
  it('treats empty, Untitled and UUID titles as placeholders', () => {
    expect(isPlaceholderConversationTitle('')).toBe(true)
    expect(isPlaceholderConversationTitle(undefined)).toBe(true)
    expect(isPlaceholderConversationTitle(null)).toBe(true)
    expect(isPlaceholderConversationTitle('Untitled Conversation')).toBe(true)
    expect(isPlaceholderConversationTitle(UUID_TITLE)).toBe(true)
  })

  it('keeps real provider titles', () => {
    expect(isPlaceholderConversationTitle('Quarterly planning notes')).toBe(false)
    expect(isPlaceholderConversationTitle('Untitled Conversation draft')).toBe(false)
  })
})

describe('resolveConversationTitle', () => {
  it('returns the same object for a real provider title', () => {
    const conversation = makeConversation()
    expect(resolveConversationTitle(conversation, 'Anything - ChatGPT')).toBe(conversation)
  })

  it('resolves an empty title from the tab title, stripping the provider suffix', () => {
    const resolved = resolveConversationTitle(makeConversation({ title: '' }), 'My Lisbon trip - ChatGPT')
    expect(resolved.title).toBe('My Lisbon trip')
  })

  it('resolves Untitled and UUID titles the same way', () => {
    expect(resolveConversationTitle(makeConversation({ title: 'Untitled Conversation' }), 'Trip ideas | Claude').title).toBe('Trip ideas')
    expect(resolveConversationTitle(makeConversation({ title: UUID_TITLE }), 'Budget plan – DeepSeek').title).toBe('Budget plan')
  })

  it('falls back to the first user message when the tab title has no usable name', () => {
    const resolved = resolveConversationTitle(makeConversation({ title: UUID_TITLE }), 'ChatGPT')
    expect(resolved.title).toBe('Summarize the quarterly plan')
  })

  it('truncates the first user message fallback to 80 characters', () => {
    const longContent = 'x'.repeat(120)
    const resolved = resolveConversationTitle(
      makeConversation({ title: '', messages: [{ id: 'u', role: 'user', content: longContent }] }),
      undefined
    )
    expect(resolved.title).toBe('x'.repeat(80))
  })

  it('returns the original object when no better title exists', () => {
    const conversation = makeConversation({ title: '', messages: [] })
    expect(resolveConversationTitle(conversation, 'Gemini')).toBe(conversation)
    expect(resolveConversationTitle(conversation, undefined)).toBe(conversation)
  })

  it('does not mutate the input conversation', () => {
    const conversation = makeConversation({ title: UUID_TITLE })
    const resolved = resolveConversationTitle(conversation, 'My Lisbon trip - ChatGPT')
    expect(conversation.title).toBe(UUID_TITLE)
    expect(resolved).not.toBe(conversation)
    expect(resolved.messages).toBe(conversation.messages)
  })
})
