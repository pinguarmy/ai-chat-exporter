import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { extractApiMessageText, getApiMessageRecords, normalizeApiMessageRole } from '../src/lib/api-message-normalizer'
import { inferClaudeArtifactType } from '../src/lib/claude-artifact'
import { getGrokConversationId } from '../src/lib/grok-conversation-url'

const repoRoot = resolve(__dirname, '..')

describe('provider export regressions', () => {
  it('renders an explicit checkmark for selected bulk rows', () => {
    const css = readFileSync(resolve(repoRoot, 'src/styles/popup.css'), 'utf8')

    expect(css).toMatch(/\.checkbox\s*\{[\s\S]*appearance:\s*auto/)
    expect(css).toMatch(/\.checkbox\s*\{[\s\S]*accent-color:\s*var\(--primary\)/)
  })

  it('recognizes both legacy and current Grok conversation URLs', () => {
    expect(getGrokConversationId('/chat/alpha_123')).toBe('alpha_123')
    expect(getGrokConversationId('/c/01JQ-example-id')).toBe('01JQ-example-id')
    expect(getGrokConversationId('/share/public-chat')).toBeNull()
  })

  it('keeps DeepSeek user and assistant content from nested content blocks', () => {
    const records = getApiMessageRecords({
      data: {
        messages: [
          { sender_type: 'human', message: { content: [{ type: 'text', text: 'My question' }] } },
          { sender_type: 'bot', content: { parts: [{ text: 'The useful answer' }] } }
        ]
      }
    })

    expect(records).toHaveLength(2)
    expect(normalizeApiMessageRole(records[0])).toBe('user')
    expect(extractApiMessageText(records[0])).toBe('My question')
    expect(normalizeApiMessageRole(records[1])).toBe('assistant')
    expect(extractApiMessageText(records[1])).toBe('The useful answer')
  })

  it('keeps Claude messages when the response uses messages instead of chat_messages', () => {
    const records = getApiMessageRecords({
      conversation: {
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Please help' }] },
          { role: 'assistant', content: [{ type: 'thinking' }, { type: 'text', text: 'Here is the answer' }] }
        ]
      }
    })

    expect(records).toHaveLength(2)
    expect(normalizeApiMessageRole(records[0])).toBe('user')
    expect(extractApiMessageText(records[0])).toBe('Please help')
    expect(normalizeApiMessageRole(records[1])).toBe('assistant')
    expect(extractApiMessageText(records[1])).toBe('Here is the answer')
  })

  it('retains Claude tool results as assistant content', () => {
    const record = { sender: 'tool', content: [{ type: 'tool_result', content: 'Tool output' }] }

    expect(normalizeApiMessageRole(record)).toBe('assistant')
    expect(extractApiMessageText(record)).toBe('Tool output')
  })

  it('classifies a generic Claude artifact tool from its document payload', () => {
    expect(inferClaudeArtifactType({
      name: 'artifacts',
      input: { type: 'document', content: '<html></html>' }
    })).toBe('document')
  })
})
