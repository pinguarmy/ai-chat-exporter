import { describe, it, expect } from 'vitest'
import { collapseProgressUpdates, conversationToMarkdown } from '../src/lib/export-markdown'
import type { Conversation, ExportOptions, ChatMessage } from '../src/lib/types'

describe('collapseProgressUpdates and markdown streaming grouping', () => {
  const defaultOptions: ExportOptions = {
    format: 'markdown',
    includeMetadata: true,
    includeCodeBlocks: true,
    includeImages: true,
  }

  const createConversation = (messages: ChatMessage[], overrides: Partial<Conversation> = {}): Conversation => ({
    id: 'test-conv-grouping',
    title: 'Streaming Grouping Test',
    url: 'https://chatgpt.com/c/test',
    messages,
    platform: 'chatgpt',
    ...overrides,
  })

  describe('Pure function collapseProgressUpdates unit tests', () => {
    it('collapses three assistant messages ("Hello" / "Hello world" / "Hello world!") into 1 final message with collapsedCount=2', () => {
      const messages: ChatMessage[] = [
        { id: 'm1', role: 'assistant', content: 'Hello' },
        { id: 'm2', role: 'assistant', content: 'Hello world' },
        { id: 'm3', role: 'assistant', content: 'Hello world!' },
      ]

      const result = collapseProgressUpdates(messages)

      expect(result.collapsedCount).toBe(2)
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].id).toBe('m3')
      expect(result.messages[0].content).toBe('Hello world!')
    })

    it('handles CJK prefix collapsing ("今天" / "今天天气很好")', () => {
      const messages: ChatMessage[] = [
        { id: 'cjk-1', role: 'assistant', content: '今天' },
        { id: 'cjk-2', role: 'assistant', content: '今天天气很好' },
      ]

      const result = collapseProgressUpdates(messages)

      expect(result.collapsedCount).toBe(1)
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].id).toBe('cjk-2')
      expect(result.messages[0].content).toBe('今天天气很好')
    })

    it('does not collapse assistant messages when separated by a user message', () => {
      const messages: ChatMessage[] = [
        { id: 'a1', role: 'assistant', content: 'Hello' },
        { id: 'u1', role: 'user', content: 'Go on' },
        { id: 'a2', role: 'assistant', content: 'Hello world!' },
      ]

      const result = collapseProgressUpdates(messages)

      expect(result.collapsedCount).toBe(0)
      expect(result.messages).toHaveLength(3)
      expect(result.messages.map(m => m.id)).toEqual(['a1', 'u1', 'a2'])
    })

    it('does not collapse non-prefix assistant messages ("方案A很好" / "方案B更好")', () => {
      const messages: ChatMessage[] = [
        { id: 'plan-1', role: 'assistant', content: '方案A很好' },
        { id: 'plan-2', role: 'assistant', content: '方案B更好' },
      ]

      const result = collapseProgressUpdates(messages)

      expect(result.collapsedCount).toBe(0)
      expect(result.messages).toHaveLength(2)
      expect(result.messages[0].content).toBe('方案A很好')
      expect(result.messages[1].content).toBe('方案B更好')
    })

    it('migrates attachments from intermediate drafts to the final message when final message has none', () => {
      const messages: ChatMessage[] = [
        {
          id: 'draft-att',
          role: 'assistant',
          content: 'Generating file',
          attachments: [
            { type: 'file', url: 'https://example.com/sheet.xlsx', name: 'sheet.xlsx' },
          ],
        },
        {
          id: 'final-att',
          role: 'assistant',
          content: 'Generating file... Done! Here is the output.',
        },
      ]

      const result = collapseProgressUpdates(messages)

      expect(result.collapsedCount).toBe(1)
      expect(result.messages).toHaveLength(1)
      const finalMsg = result.messages[0]
      expect(finalMsg.id).toBe('final-att')
      expect(finalMsg.attachments).toEqual([
        { type: 'file', url: 'https://example.com/sheet.xlsx', name: 'sheet.xlsx' },
      ])
    })

    it('deduplicates attachments by url and name when migrating attachments', () => {
      const messages: ChatMessage[] = [
        {
          id: 'm1',
          role: 'assistant',
          content: 'Part 1',
          attachments: [
            { type: 'file', url: 'https://example.com/shared.pdf', name: 'shared.pdf' },
            { type: 'file', url: 'https://example.com/unique-1.pdf', name: 'unique-1.pdf' },
          ],
        },
        {
          id: 'm2',
          role: 'assistant',
          content: 'Part 1 and 2',
          attachments: [
            { type: 'file', url: 'https://example.com/shared.pdf', name: 'shared.pdf' },
            { type: 'file', url: 'https://example.com/unique-2.pdf', name: 'unique-2.pdf' },
          ],
        },
      ]

      const result = collapseProgressUpdates(messages)
      expect(result.collapsedCount).toBe(1)
      expect(result.messages).toHaveLength(1)
      const finalMsg = result.messages[0]
      expect(finalMsg.attachments).toHaveLength(3)
      expect(finalMsg.attachments?.map(a => a.name)).toEqual(['shared.pdf', 'unique-2.pdf', 'unique-1.pdf'])
    })

    it('does not throw on undefined, null, or empty content and treats them as eligible prefixes', () => {
      const messages: ChatMessage[] = [
        // @ts-expect-error test runtime boundary with undefined content
        { id: 'null-1', role: 'assistant', content: undefined },
        // @ts-expect-error test runtime boundary with null content
        { id: 'null-2', role: 'assistant', content: null },
        { id: 'empty-3', role: 'assistant', content: '   ' },
        { id: 'final-4', role: 'assistant', content: 'Actual response content' },
      ]

      expect(() => collapseProgressUpdates(messages)).not.toThrow()
      const result = collapseProgressUpdates(messages)
      expect(result.collapsedCount).toBe(3)
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].id).toBe('final-4')
      expect(result.messages[0].content).toBe('Actual response content')
    })

    it('migrates earliest timestamp to final message when final message lacks one', () => {
      const messages: ChatMessage[] = [
        { id: 't1', role: 'assistant', content: 'Step 1', timestamp: 1000 },
        { id: 't2', role: 'assistant', content: 'Step 1 completed', timestamp: 2000 },
        { id: 't3', role: 'assistant', content: 'Step 1 completed and done' }, // timestamp undefined
      ]

      const result = collapseProgressUpdates(messages)
      expect(result.collapsedCount).toBe(2)
      expect(result.messages[0].timestamp).toBe(1000)
    })

    it('preserves final message timestamp if it already has one', () => {
      const messages: ChatMessage[] = [
        { id: 't1', role: 'assistant', content: 'Step 1', timestamp: 1000 },
        { id: 't2', role: 'assistant', content: 'Step 1 completed', timestamp: 5000 },
      ]

      const result = collapseProgressUpdates(messages)
      expect(result.collapsedCount).toBe(1)
      expect(result.messages[0].timestamp).toBe(5000)
    })
  })

  describe('conversationToMarkdown integration tests', () => {
    it('defaults mergeProgressUpdates to true, collapsing streaming drafts and emitting header counter', () => {
      const conv = createConversation([
        { id: 'u1', role: 'user', content: 'Explain quantum computing' },
        { id: 'a1', role: 'assistant', content: 'Quantum' },
        { id: 'a2', role: 'assistant', content: 'Quantum computing' },
        { id: 'a3', role: 'assistant', content: 'Quantum computing is a multidisciplinary field.' },
      ])

      const md = conversationToMarkdown(conv, defaultOptions)

      // Visible messages count remains the provider count (4)
      expect(md).toContain('**Visible messages:** 4')
      // Metadata includes merged counter
      expect(md).toContain('**Progress drafts merged:** 2')
      // Body only contains the final answer, not the intermediate chunks
      expect(md).toContain('Quantum computing is a multidisciplinary field.')
      expect(md.split('### 🤖 Assistant').length - 1).toBe(1)
    })

    it('preserves all consecutive messages when mergeProgressUpdates is false', () => {
      const conv = createConversation([
        { id: 'u1', role: 'user', content: 'Explain quantum computing' },
        { id: 'a1', role: 'assistant', content: 'Quantum' },
        { id: 'a2', role: 'assistant', content: 'Quantum computing' },
        { id: 'a3', role: 'assistant', content: 'Quantum computing is a multidisciplinary field.' },
      ])

      const md = conversationToMarkdown(conv, {
        ...defaultOptions,
        mergeProgressUpdates: false,
      })

      expect(md).toContain('**Visible messages:** 4')
      expect(md).not.toContain('Progress drafts merged')
      // When false, all 3 assistant turns are formatted
      expect(md.split('### 🤖 Assistant').length - 1).toBe(3)
    })

    it('does not include "Progress drafts merged" header line when no drafts were merged', () => {
      const conv = createConversation([
        { id: 'u1', role: 'user', content: 'Question' },
        { id: 'a1', role: 'assistant', content: 'Answer' },
      ])

      const md = conversationToMarkdown(conv, defaultOptions)
      expect(md).toContain('**Visible messages:** 2')
      expect(md).not.toContain('Progress drafts merged')
    })

    it('renders migrated attachments in final markdown output', () => {
      const conv = createConversation([
        {
          id: 'a1',
          role: 'assistant',
          content: 'Here is the diagram',
          attachments: [
            { type: 'image', url: 'https://example.com/diagram.png', name: 'diagram' },
          ],
        },
        {
          id: 'a2',
          role: 'assistant',
          content: 'Here is the diagram in full detail with explanation.',
        },
      ])

      const md = conversationToMarkdown(conv, defaultOptions)
      expect(md).toContain('![diagram](https://example.com/diagram.png)')
      expect(md).toContain('Here is the diagram in full detail with explanation.')
      expect(md.split('### 🤖 Assistant').length - 1).toBe(1)
    })
  })
})
