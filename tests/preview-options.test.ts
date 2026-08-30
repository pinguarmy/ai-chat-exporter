import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const previewSource = readFileSync(resolve(__dirname, '../src/tabs/preview.tsx'), 'utf8')

describe('Preview export-option consistency', () => {
  it('passes the popup-equivalent display and timestamp options to Markdown generation', () => {
    expect(previewSource).toMatch(/conversationToMarkdown\([\s\S]*assistantDisplayName: settings\.assistantDisplayName/)
    expect(previewSource).toMatch(/conversationToMarkdown\([\s\S]*showMessageTimestamps: settings\.showMessageTimestamps/)
  })

  it('gates clipboard copy with the same exportability check as download', () => {
    expect(previewSource).toMatch(/const copyToClipboard = async \(\) => \{\s*if \(!conversation \|\| !isConversationExportable\(conversation\)\)/)
  })

  it('keeps system messages separate from assistant messages and formats dates by locale', () => {
    expect(previewSource).toContain("const isSystem = msg.role === 'system'")
    expect(previewSource).toContain("isSystem ? 'system' : 'ai'")
    expect(previewSource).toContain('new Intl.DateTimeFormat(locale')
    expect(previewSource).not.toContain("toLocaleDateString('en-US'")
  })
})
