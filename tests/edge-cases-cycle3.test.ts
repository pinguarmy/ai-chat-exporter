/**
 * Edge Case & Real-World Scenario Tests — Cycle 3
 * Tests artifacts, empty conversations, long messages, special characters, and all 5 platforms
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { conversationToMarkdown, generateMarkdownFilename } from '../src/lib/export-markdown'
import { conversationToHtml } from '../src/lib/export-pdf'
import { inferClaudeArtifactType } from '../src/lib/claude-artifact'
import type { Conversation, ExportOptions, ConversationArtifact, ChatMessage } from '../src/lib/types'

// ─── Re-implement detectPlatformFromUrl from popup.tsx (mirrors production logic exactly) ───
function detectPlatformFromUrl(url: string): 'chatgpt' | 'gemini' | 'claude' | 'deepseek' | 'grok' | null {
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'chatgpt.com' || parsed.hostname === 'chat.openai.com') {
      return 'chatgpt'
    }
    if (parsed.hostname === 'gemini.google.com') {
      return 'gemini'
    }
    if (parsed.hostname === 'claude.ai') {
      return 'claude'
    }
    if (parsed.hostname === 'deepseek.com' || parsed.hostname === 'chat.deepseek.com') {
      return 'deepseek'
    }
    if (parsed.hostname === 'grok.com' || parsed.hostname === 'www.grok.com') {
      return 'grok'
    }
  } catch {}
  return null
}

// ─── Re-implement buildDownloadFilename from popup.tsx ───
type DownloadFolderOption = 'default' | 'by-platform' | 'custom'

function buildDownloadFilename(
  baseFilename: string,
  platform: 'chatgpt' | 'gemini' | 'claude' | 'deepseek' | 'grok',
  extension: string,
  downloadFolder: DownloadFolderOption,
  customFolderName: string
): string {
  const ext = extension.startsWith('.') ? extension : `.${extension}`
  const filename = baseFilename.endsWith(ext) ? baseFilename : `${baseFilename}${ext}`

  switch (downloadFolder) {
    case 'by-platform': {
      const folderMap: Record<string, string> = {
        chatgpt: 'ChatGPT',
        gemini: 'Gemini',
        claude: 'Claude',
        deepseek: 'DeepSeek',
        grok: 'Grok'
      }
      const folder = folderMap[platform] || platform
      return `${folder}/${filename}`
    }
    case 'custom': {
      const safeFolder = customFolderName
        .replace(/[\\:*?"<>|]/g, '_')
        .replace(/^\\.\./, '')
        .replace(/^-|-$/g, '')
        .substring(0, 100) || 'AI Chat Exports'
      return `${safeFolder}/${filename}`
    }
    default:
      return filename
  }
}

// ─── Simulate Claude API fetchConversationDetail parsing logic ───
// This mirrors the parsing logic from claude-parser.ts lines 267-388
function simulateClaudeApiParse(apiResponse: any): Conversation {
  const messages: ChatMessage[] = []
  const artifacts: ConversationArtifact[] = []

  if (apiResponse.chat_messages && Array.isArray(apiResponse.chat_messages)) {
    for (const msg of apiResponse.chat_messages) {
      let role: ChatMessage['role'] = 'assistant'
      if (msg.sender === 'human') {
        role = 'user'
      } else if (msg.sender === 'assistant') {
        role = 'assistant'
      } else if (msg.sender === 'tool') {
        role = 'assistant'
      }

      let content = ''
      if (Array.isArray(msg.content)) {
        const textParts: string[] = []
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            textParts.push(block.text)
          } else if (block.type === 'tool_result') {
            const toolContent = typeof block.content === 'string'
              ? block.content
              : block.content?.[0]?.text || block.text || ''
            if (toolContent) {
              textParts.push(toolContent)
            }
          } else if (block.type === 'tool_use') {
            const toolName = block.name || 'tool'
            const toolInput = block.input ? JSON.stringify(block.input, null, 2) : ''
            textParts.push(`Tool use: ${toolName}\n${toolInput}`)

            if (block.input?.content) {
              artifacts.push({
                type: inferClaudeArtifactType(block),
                title: block.input.title || block.name || 'Artifact',
                content: block.input.content,
                language: block.name,
                mimeType: block.input.mimeType
              })
            }
          } else if (block.type === 'document') {
            artifacts.push({
              type: 'document',
              title: block.title || block.file_name || 'Uploaded File',
              content: block.text || block.content || '',
              mimeType: block.media_type || block.mime_type
            })
          }
        }
        content = textParts.join('\n\n')
      } else if (typeof msg.content === 'string') {
        content = msg.content
      }

      if (content.trim()) {
        messages.push({
          id: msg.uuid || msg.id || `msg-${Date.now()}-${Math.random()}`,
          role,
          content: content.trim(),
        })
      }
    }
  }

  return {
    id: apiResponse.uuid || apiResponse.id || 'test-id',
    title: apiResponse.name || apiResponse.title || 'Untitled',
    url: 'https://claude.ai/chat/test-id',
    messages,
    createdAt: apiResponse.created_at ? new Date(apiResponse.created_at).getTime() : undefined,
    platform: 'claude',
    artifacts: artifacts.length > 0 ? artifacts : undefined
  }
}

// ─── Common test options ───
const defaultOptions: ExportOptions = {
  format: 'markdown',
  includeMetadata: true,
  includeCodeBlocks: true,
  includeImages: true
}

const defaultConversation = (): Conversation => ({
  id: 'test-conv-1',
  title: 'Test Conversation',
  url: 'https://claude.ai/chat/test-conv-1',
  messages: [
    { id: 'msg-1', role: 'user', content: 'Hello!' },
    { id: 'msg-2', role: 'assistant', content: 'Hi there!' },
  ],
  platform: 'claude',
})

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
          { type: 'text', text: 'I\'ll create an HTML report for you.' },
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
          { type: 'text', text: 'I\'ve created the HTML report. You can view it above.' }
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
      { id: 'msg-2', role: 'assistant', content: '' },
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
    conv.messages = [
      { id: 'msg-1', role: 'user', content: longContent }
    ]

    const md = conversationToMarkdown(conv, defaultOptions)

    expect(md).toContain(longContent)
    expect(md).toContain('# Test Conversation')
    expect(md).toContain('---') // Footer not cut off
  })

  it('should handle 5000+ char message in HTML', () => {
    const conv = defaultConversation()
    conv.messages = [
      { id: 'msg-1', role: 'user', content: longContent }
    ]

    const html = conversationToHtml(conv, defaultOptions)

    // HTML should contain the full content
    expect(html).toContain(longContent)
    expect(html).toContain('</html>')
    expect(html).toContain('<footer>')
  })

  it('should handle very long message with paragraphs', () => {
    const paragraphs = Array.from({ length: 50 }, (_, i) => `Paragraph ${i + 1}: ${'x'.repeat(100)}`).join('\n\n')
    const conv = defaultConversation()
    conv.messages = [
      { id: 'msg-1', role: 'assistant', content: paragraphs }
    ]

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
        content: `Here is some code:\n\n\`\`\`javascript\n${longCode}\`\`\``,
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
    conv.messages = [
      { id: 'msg-1', role: 'user', content: veryLong }
    ]

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
      { id: 'msg-4', role: 'assistant', content: 'Short answer' },
    ]

    const md = conversationToMarkdown(conv, defaultOptions)

    expect(md).toContain('Short question')
    expect(md).toContain('A'.repeat(5000))
    expect(md).toContain('Another short question')
    expect(md).toContain('Short answer')
    expect(md).toContain('**Visible messages:** 4')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// CHECK 4: Custom folder with special characters
// ══════════════════════════════════════════════════════════════════════════════
describe('CHECK 4: Custom folder with special characters', () => {
  it('should handle Chinese folder name "我的导出"', () => {
    const result = buildDownloadFilename('chat-export', 'claude', '.md', 'custom', '我的导出')

    expect(result).toBe('我的导出/chat-export.md')
    expect(result).toContain('我的导出')
    expect(result.endsWith('.md')).toBe(true)
  })

  it('should handle folder name with spaces "My Exports"', () => {
    const result = buildDownloadFilename('chat-export', 'chatgpt', '.md', 'custom', 'My Exports')

    expect(result).toBe('My Exports/chat-export.md')
  })

  it('should handle folder name with special chars "Exports (2026)"', () => {
    const result = buildDownloadFilename('chat-export', 'gemini', '.pdf', 'custom', 'Exports (2026)')

    expect(result).toBe('Exports (2026)/chat-export.pdf')
  })

  it('should sanitize folder with backslashes', () => {
    const result = buildDownloadFilename('chat', 'chatgpt', '.md', 'custom', 'folder\\name')

    // Backslash gets replaced with underscore
    expect(result).toBe('folder_name/chat.md')
  })

  it('should sanitize folder with colons', () => {
    const result = buildDownloadFilename('chat', 'chatgpt', '.md', 'custom', 'C:\\exports')

    // Backslash and colon get replaced with underscore
    expect(result).toBe('C__exports/chat.md')
  })

  it('should sanitize folder with angle brackets', () => {
    const result = buildDownloadFilename('chat', 'chatgpt', '.md', 'custom', '<test>folder')

    expect(result).toBe('_test_folder/chat.md')
  })

  it('should sanitize folder with pipe', () => {
    const result = buildDownloadFilename('chat', 'chatgpt', '.md', 'custom', 'folder|name')

    expect(result).toBe('folder_name/chat.md')
  })

  it('should handle empty folder name with fallback', () => {
    const result = buildDownloadFilename('chat', 'chatgpt', '.md', 'custom', '')

    expect(result).toBe('AI Chat Exports/chat.md')
  })

  it('should truncate very long folder names to 100 chars', () => {
    const longFolder = 'A'.repeat(200)
    const result = buildDownloadFilename('chat', 'chatgpt', '.md', 'custom', longFolder)

    const folderPart = result.split('/')[0]
    expect(folderPart.length).toBeLessThanOrEqual(100)
  })

  it('should strip leading/trailing hyphens from folder name', () => {
    const result = buildDownloadFilename('chat', 'chatgpt', '.md', 'custom', '-my-folder-')

    expect(result).toBe('my-folder/chat.md')
  })

  it('should handle by-platform mode with all platforms', () => {
    expect(buildDownloadFilename('chat', 'chatgpt', '.md', 'by-platform', '')).toBe('ChatGPT/chat.md')
    expect(buildDownloadFilename('chat', 'gemini', '.md', 'by-platform', '')).toBe('Gemini/chat.md')
    expect(buildDownloadFilename('chat', 'claude', '.md', 'by-platform', '')).toBe('Claude/chat.md')
    expect(buildDownloadFilename('chat', 'deepseek', '.md', 'by-platform', '')).toBe('DeepSeek/chat.md')
    expect(buildDownloadFilename('chat', 'grok', '.md', 'by-platform', '')).toBe('Grok/chat.md')
  })

  it('should handle default mode (no folder prefix)', () => {
    const result = buildDownloadFilename('chat', 'chatgpt', '.md', 'default', 'anything')

    expect(result).toBe('chat.md')
  })

  it('should handle extension without dot', () => {
    const result = buildDownloadFilename('chat', 'chatgpt', 'pdf', 'default', '')

    expect(result).toBe('chat.pdf')
  })

  it('should not double-add extension', () => {
    const result = buildDownloadFilename('chat.md', 'chatgpt', '.md', 'default', '')

    expect(result).toBe('chat.md')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// CHECK 5: All 5 platforms in popup detection
// ══════════════════════════════════════════════════════════════════════════════
describe('CHECK 5: All 5 platforms in popup detection', () => {
  describe('ChatGPT', () => {
    it('should detect chatgpt.com', () => {
      expect(detectPlatformFromUrl('https://chatgpt.com/c/abc123')).toBe('chatgpt')
    })

    it('should detect chat.openai.com', () => {
      expect(detectPlatformFromUrl('https://chat.openai.com/c/abc123')).toBe('chatgpt')
    })

    it('should detect chatgpt.com root', () => {
      expect(detectPlatformFromUrl('https://chatgpt.com/')).toBe('chatgpt')
    })
  })

  describe('Claude', () => {
    it('should detect claude.ai chat URL', () => {
      expect(detectPlatformFromUrl('https://claude.ai/chat/abc123')).toBe('claude')
    })

    it('should detect claude.ai root', () => {
      expect(detectPlatformFromUrl('https://claude.ai/')).toBe('claude')
    })

    it('should not detect not-claude.ai', () => {
      expect(detectPlatformFromUrl('https://not-claude.ai/chat/test')).toBeNull()
    })
  })

  describe('DeepSeek', () => {
    it('should detect chat.deepseek.com', () => {
      expect(detectPlatformFromUrl('https://chat.deepseek.com/a/chat/s/abc123')).toBe('deepseek')
    })

    it('should detect deepseek.com', () => {
      expect(detectPlatformFromUrl('https://deepseek.com/')).toBe('deepseek')
    })

    it('should not detect not-deepseek.com', () => {
      expect(detectPlatformFromUrl('https://not-deepseek.com/chat')).toBeNull()
    })
  })

  describe('Gemini', () => {
    it('should detect gemini.google.com', () => {
      expect(detectPlatformFromUrl('https://gemini.google.com/app/abc123')).toBe('gemini')
    })

    it('should detect gemini.google.com root', () => {
      expect(detectPlatformFromUrl('https://gemini.google.com/')).toBe('gemini')
    })

    it('should not detect subdomains of google.com', () => {
      expect(detectPlatformFromUrl('https://mail.google.com/')).toBeNull()
    })
  })

  describe('Grok', () => {
    it('should detect grok.com', () => {
      expect(detectPlatformFromUrl('https://grok.com/chat/abc123')).toBe('grok')
    })

    it('should detect www.grok.com', () => {
      expect(detectPlatformFromUrl('https://www.grok.com/chat/abc123')).toBe('grok')
    })

    it('should detect grok.com root', () => {
      expect(detectPlatformFromUrl('https://grok.com/')).toBe('grok')
    })

    it('should not detect not-grok.com', () => {
      expect(detectPlatformFromUrl('https://not-grok.com/chat')).toBeNull()
    })
  })

  describe('Unknown / Edge cases', () => {
    it('should return null for example.com', () => {
      expect(detectPlatformFromUrl('https://example.com')).toBeNull()
    })

    it('should return null for invalid URLs', () => {
      expect(detectPlatformFromUrl('not-a-url')).toBeNull()
    })

    it('should return null for empty string', () => {
      expect(detectPlatformFromUrl('')).toBeNull()
    })

    it('should not detect from subdomains of target domains', () => {
      expect(detectPlatformFromUrl('https://chat.deepseek.com.evil.com/')).toBeNull()
      expect(detectPlatformFromUrl('https://grok.com.evil.com/chat')).toBeNull()
    })

    it('should handle URL with query params', () => {
      expect(detectPlatformFromUrl('https://chatgpt.com/c/abc123?foo=bar')).toBe('chatgpt')
      expect(detectPlatformFromUrl('https://claude.ai/chat/abc123?q=test')).toBe('claude')
    })

    it('should handle URL with hash', () => {
      expect(detectPlatformFromUrl('https://chatgpt.com/c/abc123#section')).toBe('chatgpt')
    })

    it('should handle HTTP (non-HTTPS) URLs', () => {
      // Note: current implementation uses new URL() which handles http:// just fine
      expect(detectPlatformFromUrl('http://chatgpt.com/c/abc123')).toBe('chatgpt')
    })
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
          content: [
            { type: 'tool_result', content: 'String tool result' }
          ]
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
          content: [
            { type: 'tool_result', tool_use_id: 'x', content: '' }
          ]
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
            { type: 'document', title: 'Report.pdf', text: 'PDF content here', media_type: 'application/pdf' }
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
