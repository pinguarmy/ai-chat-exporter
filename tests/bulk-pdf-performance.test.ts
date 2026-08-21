import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('bulk PDF performance contract', () => {
  const source = readFileSync(join(process.cwd(), 'src/popup.tsx'), 'utf8')

  it('uses the bounded bulk render mode', () => {
    expect(source).toContain("pdfRenderMode: format === 'pdf' ? 'bulk' : undefined")
  })

  it('loads the large PDF renderer only when a PDF export starts', () => {
    expect(source).not.toContain("import { exportToPdf } from './lib/export-pdf'")
    expect(source.match(/await import\('\.\/lib\/export-pdf'\)/g)).toHaveLength(2)
  })

  it('prefetches only the next conversation while rendering stays sequential', () => {
    expect(source).toContain('let currentConversationFetch = startConversationFetch(eligibleConversations[0])')
    expect(source).toContain('nextConversationFetch = i + 1 < eligibleConversations.length')
    expect(source).toContain('? startConversationFetch(eligibleConversations[i + 1])')
    expect(source).toContain('const result = await currentConversation')
    expect(source).not.toContain('Promise.all(eligibleConversations')
  })

  it('settles prefetched failures immediately instead of leaving an unhandled rejection', () => {
    expect(source).toContain('return { error }')
    expect(source).toContain('if (result.error) throw result.error')
  })

  it('ignores stale active-tab parsing results that resolve out of order', () => {
    expect(source).toContain('const requestSequence = ++detectionSequenceRef.current')
    expect(source).toContain('if (!isLatestRequest()) return')
  })
})
