import type { ChatMessage, Conversation, ConversationArtifact, ExportOptions } from '../../src/core/types'
import { inferClaudeArtifactType } from '../../src/providers/claude-artifact'

// ─── Simulate Claude API fetchConversationDetail parsing logic ───
// This mirrors the parsing logic from claude-parser.ts lines 267-388
export function simulateClaudeApiParse(apiResponse: any): Conversation {
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
export const defaultOptions: ExportOptions = {
  format: 'markdown',
  includeMetadata: true,
  includeCodeBlocks: true,
  includeImages: true
}

export const defaultConversation = (): Conversation => ({
  id: 'test-conv-1',
  title: 'Test Conversation',
  url: 'https://claude.ai/chat/test-conv-1',
  messages: [
    { id: 'msg-1', role: 'user', content: 'Hello!' },
    { id: 'msg-2', role: 'assistant', content: 'Hi there!' },
  ],
  platform: 'claude',
})
