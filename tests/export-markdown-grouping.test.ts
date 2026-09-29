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
  const confirmedDrafts = (messages: ChatMessage[]): ChatMessage[] =>
    messages.map(message => message.role === 'assistant'
      ? { ...message, progressGroupId: 'provider-response-1' }
      : message)

  describe('Pure function collapseProgressUpdates unit tests', () => {
    it('preserves independent assistant turns even when one is an identical or longer prefix', () => {
      const messages: ChatMessage[] = [
        { id: 'answer-1', role: 'assistant', content: 'The answer' },
        { id: 'answer-2', role: 'assistant', content: 'The answer' },
        { id: 'answer-3', role: 'assistant', content: 'The answer, expanded' },
      ]
      expect(collapseProgressUpdates(messages)).toEqual({ messages, collapsedCount: 0 })
      expect(conversationToMarkdown(createConversation(messages), defaultOptions).split('### 🤖 Assistant').length - 1).toBe(3)
      expect(collapseProgressUpdates(messages.map((message, index) => ({
        ...message,
        progressGroupId: index === 1 ? 'different-response' : 'provider-response-1',
      }))).collapsedCount).toBe(0)
    })

    it('does not merge drafts across an unrelated assistant turn with a different group', () => {
      const messages: ChatMessage[] = [
        { id: 'a', role: 'assistant', content: 'A', progressGroupId: 'group-a' },
        { id: 'b', role: 'assistant', content: 'B', progressGroupId: 'group-b' },
        { id: 'a2', role: 'assistant', content: 'A longer', progressGroupId: 'group-a' },
      ]
      expect(collapseProgressUpdates(messages)).toEqual({ messages, collapsedCount: 0 })
    })

    it('preserves and deduplicates chained draft citations, diagnostics and code blocks', () => {
      const reference = { type: 'web' as const, title: 'Source', url: 'https://example.com/' }
      const messages: ChatMessage[] = [
        {
          id: 'draft', role: 'assistant', content: 'Read [1]',
          references: [reference],
          citationSpans: [{ start: 5, end: 8, referenceIndexes: [0] }],
          referenceDiagnostics: [{ code: 'unresolved_provider_reference', marker: 'missing' }],
          codeBlocks: [{ language: 'js', code: 'const example = 12345' }],
        },
        { id: 'middle', role: 'assistant', content: 'Read [1] and' },
        {
          id: 'final', role: 'assistant', content: 'Read [1] and done',
          references: [reference],
          codeBlocks: [{ language: 'js', code: 'const example = 12345' }],
        },
      ]
      const result = collapseProgressUpdates(confirmedDrafts(messages))
      expect(result.collapsedCount).toBe(2)
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0]).toMatchObject({
        id: 'final',
        references: [reference],
        citationSpans: [{ start: 5, end: 8, referenceIndexes: [0] }],
        referenceDiagnostics: [{ code: 'unresolved_provider_reference', marker: 'missing' }],
        codeBlocks: [{ language: 'js', code: 'const example = 12345' }],
      })
      expect(conversationToMarkdown(createConversation(confirmedDrafts(messages)), defaultOptions)).toContain('[Source]')
    })

    it('remaps draft citation indexes without reusing shifted offsets', () => {
      const existing = { type: 'web' as const, title: 'Existing' }
      const draft = { type: 'web' as const, title: 'Draft source', private: true }
      const exact = collapseProgressUpdates(confirmedDrafts([
        { id: 'a', role: 'assistant', content: 'See [1]', references: [draft],
          citationSpans: [{ start: 4, end: 7, referenceIndexes: [0] }] },
        { id: 'b', role: 'assistant', content: 'See [1] now', references: [existing] },
      ])).messages[0]
      expect(exact.references).toEqual([existing, draft])
      expect(exact.citationSpans).toEqual([{ start: 4, end: 7, referenceIndexes: [1] }])

      const shifted = collapseProgressUpdates(confirmedDrafts([
        { id: 'a', role: 'assistant', content: '  See [1]', references: [draft],
          citationSpans: [{ start: 6, end: 9, referenceIndexes: [0] }] },
        { id: 'b', role: 'assistant', content: 'See [1] now' },
      ])).messages[0]
      expect(shifted.references).toEqual([draft])
      expect(shifted.citationSpans).toBeUndefined()
    })

    it('collapses three assistant messages ("Hello" / "Hello world" / "Hello world!") into 1 final message with collapsedCount=2', () => {
      const messages: ChatMessage[] = [
        { id: 'm1', role: 'assistant', content: 'Hello' },
        { id: 'm2', role: 'assistant', content: 'Hello world' },
        { id: 'm3', role: 'assistant', content: 'Hello world!' },
      ]

      const result = collapseProgressUpdates(confirmedDrafts(messages))

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

      const result = collapseProgressUpdates(confirmedDrafts(messages))

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

      const result = collapseProgressUpdates(confirmedDrafts(messages))

      expect(result.collapsedCount).toBe(0)
      expect(result.messages).toHaveLength(3)
      expect(result.messages.map(m => m.id)).toEqual(['a1', 'u1', 'a2'])
    })

    it('does not collapse non-prefix assistant messages ("方案A很好" / "方案B更好")', () => {
      const messages: ChatMessage[] = [
        { id: 'plan-1', role: 'assistant', content: '方案A很好' },
        { id: 'plan-2', role: 'assistant', content: '方案B更好' },
      ]

      const result = collapseProgressUpdates(confirmedDrafts(messages))

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

      const result = collapseProgressUpdates(confirmedDrafts(messages))

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

      const result = collapseProgressUpdates(confirmedDrafts(messages))
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

      expect(() => collapseProgressUpdates(confirmedDrafts(messages))).not.toThrow()
      const result = collapseProgressUpdates(confirmedDrafts(messages))
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

      const result = collapseProgressUpdates(confirmedDrafts(messages))
      expect(result.collapsedCount).toBe(2)
      expect(result.messages[0].timestamp).toBe(1000)
    })

    it('preserves final message timestamp if it already has one', () => {
      const messages: ChatMessage[] = [
        { id: 't1', role: 'assistant', content: 'Step 1', timestamp: 1000 },
        { id: 't2', role: 'assistant', content: 'Step 1 completed', timestamp: 5000 },
      ]

      const result = collapseProgressUpdates(confirmedDrafts(messages))
      expect(result.collapsedCount).toBe(1)
      expect(result.messages[0].timestamp).toBe(5000)
    })
  })

  describe('conversationToMarkdown integration tests', () => {
    it('defaults mergeProgressUpdates to true, collapsing streaming drafts and emitting header counter', () => {
      const conv = createConversation(confirmedDrafts([
        { id: 'u1', role: 'user', content: 'Explain quantum computing' },
        { id: 'a1', role: 'assistant', content: 'Quantum' },
        { id: 'a2', role: 'assistant', content: 'Quantum computing' },
        { id: 'a3', role: 'assistant', content: 'Quantum computing is a multidisciplinary field.' },
      ]))

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
      const conv = createConversation(confirmedDrafts([
        { id: 'u1', role: 'user', content: 'Explain quantum computing' },
        { id: 'a1', role: 'assistant', content: 'Quantum' },
        { id: 'a2', role: 'assistant', content: 'Quantum computing' },
        { id: 'a3', role: 'assistant', content: 'Quantum computing is a multidisciplinary field.' },
      ]))

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
      const conv = createConversation(confirmedDrafts([
        { id: 'u1', role: 'user', content: 'Question' },
        { id: 'a1', role: 'assistant', content: 'Answer' },
      ]))

      const md = conversationToMarkdown(conv, defaultOptions)
      expect(md).toContain('**Visible messages:** 2')
      expect(md).not.toContain('Progress drafts merged')
    })

    it('renders migrated attachments in final markdown output', () => {
      const conv = createConversation(confirmedDrafts([
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
      ]))

      const md = conversationToMarkdown(conv, defaultOptions)
      expect(md).toContain('![diagram](https://example.com/diagram.png)')
      expect(md).toContain('Here is the diagram in full detail with explanation.')
      expect(md.split('### 🤖 Assistant').length - 1).toBe(1)
    })
  })
})
