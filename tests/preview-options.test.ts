import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildExportOptions } from '../src/lib/export-options'
import { conversationToMarkdown } from '../src/lib/export-markdown'

const previewSource = readFileSync(resolve(__dirname, '../src/tabs/preview.tsx'), 'utf8')

describe('Preview export-option consistency', () => {
  it('passes the popup-equivalent display and timestamp options to Markdown generation', () => {
    expect(previewSource).toContain("conversationToMarkdown(conversation, buildExportOptions('markdown', settings))")
    const options = buildExportOptions('markdown', { assistantDisplayName: 'Export Bot', showMessageTimestamps: false })
    const markdown = conversationToMarkdown({ id: 'test', title: 'Synthetic', platform: 'chatgpt', url: 'https://chatgpt.com/c/test', messages: [{ id: 'a', role: 'assistant', content: 'Answer', timestamp: 1_700_000_000_000 }] }, options)
    expect(markdown).toContain('### 🤖 Export Bot')
    expect(markdown).not.toContain('*2023-11-14T22:13:20.000Z*')
  })

  it('gates clipboard copy with the same exportability check as download', () => {
    expect(previewSource).toMatch(/const copyToClipboard = async \(\) => \{\s*if \(!conversation \|\| !isConversationExportable\(conversation\)\)/)
  })

  it('keeps system messages separate from assistant messages and formats dates by locale', () => {
    expect(previewSource).toContain("const isSystem = msg.role === 'system'")
    expect(previewSource).toContain("isSystem ? 'system' : 'ai'")
    expect(previewSource).toContain('timestamp.toISOString()')
    expect(previewSource).not.toContain("toLocaleDateString('en-US'")
  })
})
