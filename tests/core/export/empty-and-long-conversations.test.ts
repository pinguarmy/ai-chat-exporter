// @vitest-environment jsdom
/**
 * Export of empty conversations and very long messages in Markdown and HTML.
 */

import { describe, it, expect } from 'vitest'
import { conversationToMarkdown, generateMarkdownFilename } from '../../../src/core/export-markdown'
import { conversationToHtml } from '../../../src/core/export-pdf'
import {
  defaultConversation,
  defaultOptions,
  simulateClaudeApiParse
} from '../../helpers/claude-api-simulation'

// ══════════════════════════════════════════════════════════════════════════════
// CHECK 2: Empty conversations
// ══════════════════════════════════════════════════════════════════════════════
describe('CHECK 2: Empty conversations', () => {
  it('should produce valid markdown with zero messages', () => {
    const conv = defaultConversation()
    conv.messages = []

    const md = conversationToMarkdown(conv, defaultOptions)

    expect(md).toContain('# Test Conversation')
    expect(md).toContain('**Visible messages:** 0')
    expect(md).toContain('---') // Footer
    expect(md).toContain('Exported from Claude')
  })

  it('should produce valid HTML with zero messages', () => {
    const conv = defaultConversation()
    conv.messages = []

    const html = conversationToHtml(conv, defaultOptions)

    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('Test Conversation')
    expect(html).toContain('<footer>')
    expect(html).toContain('</html>')
  })

  it('should handle empty title fallback in markdown', () => {
    const conv = defaultConversation()
    conv.messages = []
    conv.title = ''

    const md = conversationToMarkdown(conv, defaultOptions)

    expect(md).toContain('# Untitled Conversation')
  })

  it('should handle empty title fallback in HTML', () => {
    const conv = defaultConversation()
    conv.messages = []
    conv.title = ''

    const html = conversationToHtml(conv, defaultOptions)

    expect(html).toContain('Untitled Conversation')
  })

  it('should generate valid markdown filename for empty conversation', () => {
    const conv = defaultConversation()
    conv.messages = []
    conv.title = ''

    const filename = generateMarkdownFilename(conv)

    expect(filename).toBe('conversation.md')
    expect(filename.endsWith('.md')).toBe(true)
  })

  it('should handle empty conversation with empty string content messages', () => {
    const conv = defaultConversation()
    conv.messages = [
      { id: 'msg-1', role: 'user', content: '' },
      { id: 'msg-2', role: 'assistant', content: '' }
    ]

    const md = conversationToMarkdown(conv, defaultOptions)

    // Should still produce valid output
    expect(md).toContain('# Test Conversation')
    expect(md).toContain('**Visible messages:** 2')
    expect(md).toContain('---')
  })

  it('should handle empty conversation API response', () => {
    const emptyApiResponse = {
      uuid: 'empty-conv',
      name: 'Empty Chat',
      chat_messages: []
    }

    const conversation = simulateClaudeApiParse(emptyApiResponse)

    expect(conversation.messages.length).toBe(0)
    expect(conversation.artifacts).toBeUndefined()
    expect(conversation.title).toBe('Empty Chat')
  })

  it('should handle missing chat_messages field', () => {
    const noMessagesResponse = {
      uuid: 'no-msg-conv',
      name: 'No Messages'
    }

    const conversation = simulateClaudeApiParse(noMessagesResponse)

    expect(conversation.messages.length).toBe(0)
  })

  it('should handle null chat_messages', () => {
    const nullMessagesResponse = {
      uuid: 'null-msg-conv',
      chat_messages: null
    }

    const conversation = simulateClaudeApiParse(nullMessagesResponse)

    expect(conversation.messages.length).toBe(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// CHECK 3: Very long messages
// ══════════════════════════════════════════════════════════════════════════════
describe('CHECK 3: Very long messages', () => {
  const longContent = 'A'.repeat(5000)

  it('should handle 5000+ char message in markdown', () => {
    const conv = defaultConversation()
    conv.messages = [{ id: 'msg-1', role: 'user', content: longContent }]

    const md = conversationToMarkdown(conv, defaultOptions)

    expect(md).toContain(longContent)
    expect(md).toContain('# Test Conversation')
    expect(md).toContain('---') // Footer not cut off
  })

  it('should handle 5000+ char message in HTML', () => {
    const conv = defaultConversation()
    conv.messages = [{ id: 'msg-1', role: 'user', content: longContent }]

    const html = conversationToHtml(conv, defaultOptions)

    // HTML should contain the full content
    expect(html).toContain(longContent)
    expect(html).toContain('</html>')
    expect(html).toContain('<footer>')
  })

  it('should handle very long message with paragraphs', () => {
    const paragraphs = Array.from(
      { length: 50 },
      (_, i) => `Paragraph ${i + 1}: ${'x'.repeat(100)}`
    ).join('\n\n')
    const conv = defaultConversation()
    conv.messages = [{ id: 'msg-1', role: 'assistant', content: paragraphs }]

    const md = conversationToMarkdown(conv, defaultOptions)

    expect(md).toContain('Paragraph 1:')
    expect(md).toContain('Paragraph 50:')
    expect(md).toContain('---')
  })

  it('should handle very long message with code blocks', () => {
    const longCode = 'console.log("test");\n'.repeat(200)
    const conv = defaultConversation()
    conv.messages = [
      {
        id: 'msg-1',
        role: 'assistant',
        content: `Here is some code:\n\n\`\`\`javascript\n${longCode}\`\`\``
      }
    ]

    const md = conversationToMarkdown(conv, defaultOptions)

    expect(md).toContain('```javascript')
    expect(md).toContain('console.log')
    expect(md).toContain('```')
    expect(md).toContain('---')
  })

  it('should not truncate long messages', () => {
    const veryLong = 'X'.repeat(10000)
    const conv = defaultConversation()
    conv.messages = [{ id: 'msg-1', role: 'user', content: veryLong }]

    const md = conversationToMarkdown(conv, defaultOptions)

    // Verify the entire message is present (not truncated)
    expect(md).toContain(veryLong)
    expect(md.length).toBeGreaterThan(10000)
  })

  it('should handle mixed long and short messages', () => {
    const conv = defaultConversation()
    conv.messages = [
      { id: 'msg-1', role: 'user', content: 'Short question' },
      { id: 'msg-2', role: 'assistant', content: 'A'.repeat(5000) },
      { id: 'msg-3', role: 'user', content: 'Another short question' },
      { id: 'msg-4', role: 'assistant', content: 'Short answer' }
    ]

    const md = conversationToMarkdown(conv, defaultOptions)

    expect(md).toContain('Short question')
    expect(md).toContain('A'.repeat(5000))
    expect(md).toContain('Another short question')
    expect(md).toContain('Short answer')
    expect(md).toContain('**Visible messages:** 4')
  })
})
