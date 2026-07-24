import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('bulk PDF performance contract', () => {
  const source = readFileSync(join(process.cwd(), 'src/popup.tsx'), 'utf8')

  it('uses the bounded bulk render mode', () => {
    expect(source).toContain("pdfRenderMode: format === 'pdf' ? 'bulk' : undefined")
  })

  it('prefetches only the next conversation while rendering stays sequential', () => {
    expect(source).toContain('let nextConversation = startConversationFetch(selectedConversations[0])')
    expect(source).toContain('nextConversation = startConversationFetch(selectedConversations[i + 1])')
    expect(source).toContain('const result = await currentConversation')
    expect(source).not.toContain('Promise.all(selectedConversations')
  })

  it('settles prefetched failures immediately instead of leaving an unhandled rejection', () => {
    expect(source).toContain('return { error }')
    expect(source).toContain('if (result.error) throw result.error')
  })
})
