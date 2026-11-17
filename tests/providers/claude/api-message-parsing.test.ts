/**
 * Claude API message parsing edge cases: artifacts, document blocks, tool
 * results, and string content, exercised through the simulated API parse.
 */

import { describe, it, expect } from 'vitest'
import { conversationToMarkdown } from '../../../src/core/export-markdown'
import {
  defaultConversation,
  defaultOptions,
  simulateClaudeApiParse
} from '../../helpers/claude-api-simulation'

// ══════════════════════════════════════════════════════════════════════════════
// CHECK 1: Claude API artifacts
// ══════════════════════════════════════════════════════════════════════════════
describe('CHECK 1: Claude API artifacts', () => {
  const claudeArtifactResponse = {
    uuid: 'conv-123',
    name: 'Health Report',
    created_at: '2026-01-15T10:30:00Z',
    chat_messages: [
      {
        sender: 'human',
        content: [{ type: 'text', text: 'Create an HTML report' }]
      },
      {
        sender: 'assistant',
        content: [
          { type: 'text', text: "I'll create an HTML report for you." },
          {
            type: 'tool_use',
            id: 'tool1',
            name: 'artifacts',
            input: {
              type: 'document',
              content: '<html><body><h1>Report</h1></body></html>',
              title: 'Health Report'
            }
          }
        ]
      },
      {
        sender: 'assistant',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool1',
            content: [{ type: 'text', text: 'Document created successfully' }]
          },
          { type: 'text', text: "I've created the HTML report. You can view it above." }
        ]
      }
    ]
  }

  it('should capture artifact content from tool_use blocks', () => {
    const conversation = simulateClaudeApiParse(claudeArtifactResponse)

    expect(conversation.artifacts).toBeDefined()
    expect(conversation.artifacts!.length).toBe(1)
    expect(conversation.artifacts![0].content).toBe('<html><body><h1>Report</h1></body></html>')
  })

  it('should set artifact title from tool input', () => {
    const conversation = simulateClaudeApiParse(claudeArtifactResponse)

    expect(conversation.artifacts![0].title).toBe('Health Report')
  })

  it('classifies a generic artifact tool from its document payload', () => {
    const conversation = simulateClaudeApiParse(claudeArtifactResponse)

    expect(conversation.artifacts![0].type).toBe('document')
  })

  it('should capture text messages alongside artifacts', () => {
    const conversation = simulateClaudeApiParse(claudeArtifactResponse)

    // Should have 3 messages: user, assistant (with artifact text), assistant (with tool_result + text)
    expect(conversation.messages.length).toBe(3)
    expect(conversation.messages[0].role).toBe('user')
    expect(conversation.messages[0].content).toBe('Create an HTML report')
    expect(conversation.messages[1].role).toBe('assistant')
    expect(conversation.messages[1].content).toContain("I'll create an HTML report")
    expect(conversation.messages[2].role).toBe('assistant')
  })

  it('should preserve message order', () => {
    const conversation = simulateClaudeApiParse(claudeArtifactResponse)

    expect(conversation.messages[0].role).toBe('user')
    expect(conversation.messages[0].content).toBe('Create an HTML report')
    expect(conversation.messages[1].role).toBe('assistant')
    expect(conversation.messages[1].content).toContain("I'll create an HTML report")
    expect(conversation.messages[2].role).toBe('assistant')
    expect(conversation.messages[2].content).toContain('Document created successfully')
    expect(conversation.messages[2].content).toContain("I've created the HTML report")
  })

  it('should add tool_use content as text in the message', () => {
    const conversation = simulateClaudeApiParse(claudeArtifactResponse)

    // The assistant message with tool_use should include the tool input JSON
    expect(conversation.messages[1].content).toContain('Tool use: artifacts')
    expect(conversation.messages[1].content).toContain('"type": "document"')
    expect(conversation.messages[1].content).toContain('"title": "Health Report"')
  })

  it('should handle tool_result content blocks', () => {
    const conversation = simulateClaudeApiParse(claudeArtifactResponse)

    // The third message has a tool_result + text
    expect(conversation.messages[2].content).toContain('Document created successfully')
    expect(conversation.messages[2].content).toContain("I've created the HTML report")
  })

  it('should correctly export markdown with artifacts', () => {
    const conversation = simulateClaudeApiParse(claudeArtifactResponse)
    const markdown = conversationToMarkdown(conversation, defaultOptions)

    expect(markdown).toContain('# Health Report')
    expect(markdown).toContain('Create an HTML report')
    expect(markdown).toContain("I'll create an HTML report")
    expect(markdown).toContain('Tool use: artifacts')
    expect(markdown).toContain("I've created the HTML report")
  })

  it('should handle artifact with tool_use having input.type html', () => {
    const htmlArtifactResponse = {
      uuid: 'conv-html-type',
      name: 'HTML Type Test',
      chat_messages: [
        {
          sender: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool2',
              name: 'artifacts',
              input: {
                type: 'html',
                content: '<html><body>Dash</body></html>',
                title: 'Dashboard'
              }
            }
          ]
        }
      ]
    }

    const conversation = simulateClaudeApiParse(htmlArtifactResponse)
    expect(conversation.artifacts).toBeDefined()
    expect(conversation.artifacts!.length).toBe(1)
    expect(conversation.artifacts![0].type).toBe('html')
  })

  it('should handle artifact with name containing "html"', () => {
    const htmlNamedResponse = {
      uuid: 'conv-456',
      name: 'HTML Generation',
      chat_messages: [
        {
          sender: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool3',
              name: 'html_artifacts',
              input: {
                content: '<div>Hello</div>',
                title: 'HTML Page'
              }
            }
          ]
        }
      ]
    }

    const conversation = simulateClaudeApiParse(htmlNamedResponse)
    expect(conversation.artifacts).toBeDefined()
    expect(conversation.artifacts![0].type).toBe('html') // "html_artifacts" includes "html"
  })

  it('should handle empty artifacts array when no tool_use blocks', () => {
    const noArtifactResponse = {
      uuid: 'conv-789',
      name: 'Simple Chat',
      chat_messages: [
        { sender: 'human', content: [{ type: 'text', text: 'Hi' }] },
        { sender: 'assistant', content: [{ type: 'text', text: 'Hello!' }] }
      ]
    }

    const conversation = simulateClaudeApiParse(noArtifactResponse)
    expect(conversation.artifacts).toBeUndefined()
  })

  it('should handle multiple artifacts in one conversation', () => {
    const multiArtifactResponse = {
      uuid: 'conv-multi',
      name: 'Multi Artifact',
      chat_messages: [
        {
          sender: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-a',
              name: 'artifacts',
              input: { content: 'code1', title: 'File 1' }
            },
            {
              type: 'tool_use',
              id: 'tool-b',
              name: 'artifacts',
              input: { content: 'code2', title: 'File 2' }
            }
          ]
        }
      ]
    }

    const conversation = simulateClaudeApiParse(multiArtifactResponse)
    expect(conversation.artifacts).toBeDefined()
    expect(conversation.artifacts!.length).toBe(2)
    expect(conversation.artifacts![0].title).toBe('File 1')
    expect(conversation.artifacts![1].title).toBe('File 2')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Additional edge cases
// ══════════════════════════════════════════════════════════════════════════════
describe('Additional edge cases', () => {
  it('should handle string content (not array) in Claude API', () => {
    const response = {
      uuid: 'str-content',
      name: 'String Content',
      chat_messages: [
        { sender: 'human', content: 'Simple string content' },
        { sender: 'assistant', content: 'Also string content' }
      ]
    }

    const conversation = simulateClaudeApiParse(response)
    expect(conversation.messages.length).toBe(2)
    expect(conversation.messages[0].content).toBe('Simple string content')
    expect(conversation.messages[1].content).toBe('Also string content')
  })

  it('should handle tool_result with string content', () => {
    const response = {
      uuid: 'tool-str',
      name: 'Tool Result',
      chat_messages: [
        {
          sender: 'assistant',
          content: [{ type: 'tool_result', content: 'String tool result' }]
        }
      ]
    }

    const conversation = simulateClaudeApiParse(response)
    expect(conversation.messages.length).toBe(1)
    expect(conversation.messages[0].content).toContain('String tool result')
  })

  it('should handle tool_result with empty content', () => {
    const response = {
      uuid: 'tool-empty',
      name: 'Tool Result Empty',
      chat_messages: [
        {
          sender: 'assistant',
          content: [{ type: 'tool_result', tool_use_id: 'x', content: '' }]
        }
      ]
    }

    const conversation = simulateClaudeApiParse(response)
    // Empty content should not create a message (trimmed check)
    expect(conversation.messages.length).toBe(0)
  })

  it('should handle document type blocks', () => {
    const response = {
      uuid: 'doc-type',
      name: 'Document',
      chat_messages: [
        {
          sender: 'human',
          content: [
            {
              type: 'document',
              title: 'Report.pdf',
              text: 'PDF content here',
              media_type: 'application/pdf'
            }
          ]
        }
      ]
    }

    const conversation = simulateClaudeApiParse(response)
    expect(conversation.artifacts).toBeDefined()
    expect(conversation.artifacts![0].type).toBe('document')
    expect(conversation.artifacts![0].title).toBe('Report.pdf')
    expect(conversation.artifacts![0].content).toBe('PDF content here')
    expect(conversation.artifacts![0].mimeType).toBe('application/pdf')
  })

  it('should handle artifact without input.content', () => {
    const response = {
      uuid: 'no-art-content',
      name: 'No Artifact Content',
      chat_messages: [
        {
          sender: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 't1',
              name: 'search',
              input: { query: 'something' }
            }
          ]
        }
      ]
    }

    const conversation = simulateClaudeApiParse(response)
    // No artifact because input.content is undefined
    expect(conversation.artifacts).toBeUndefined()
  })

  it('should handle markdown export with Claude platform label', () => {
    const conv = defaultConversation()
    conv.platform = 'claude'

    const md = conversationToMarkdown(conv, defaultOptions)

    expect(md).toContain('**Platform:** Claude')
    expect(md).toContain('Exported from Claude')
  })

  it('should handle markdown export with DeepSeek platform label', () => {
    const conv = defaultConversation()
    conv.platform = 'deepseek'

    const md = conversationToMarkdown(conv, defaultOptions)

    expect(md).toContain('**Platform:** DeepSeek')
    expect(md).toContain('Exported from DeepSeek')
  })

  it('should handle markdown export with Grok platform label', () => {
    const conv = defaultConversation()
    conv.platform = 'grok'

    const md = conversationToMarkdown(conv, defaultOptions)

    expect(md).toContain('**Platform:** Grok')
    expect(md).toContain('Exported from Grok')
  })
})
