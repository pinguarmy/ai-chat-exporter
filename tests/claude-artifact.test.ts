import { describe, expect, it } from 'vitest'
import { extractClaudeDisplayArtifact, inferClaudeArtifactType } from '../src/lib/claude-artifact'

describe('provider-exposed display source', () => {
  it('preserves HTML and Markdown display payloads as inert artifact source', () => {
    const code = '<script>window.mustNotRun = true</script><h1>Report</h1>'
    expect(extractClaudeDisplayArtifact({ type: 'tool_result', display_content: { type: 'json_block', json_block: JSON.stringify({ language: 'html', code }) } })).toMatchObject({ type: 'html', language: 'html', content: code })
    expect(extractClaudeDisplayArtifact({ type: 'tool_result', display_content: { type: 'json_block', json_block: JSON.stringify({ language: 'markdown', code: '# Document' }) } })).toMatchObject({ type: 'document', content: '# Document' })
  })
  it('does not turn hidden/tool input, arbitrary execution output or invalid JSON into artifacts', () => {
    const display_content = { type: 'json_block', json_block: JSON.stringify({ language: 'html', code: 'hidden' }) }
    expect(extractClaudeDisplayArtifact({ type: 'thinking', display_content })).toBeNull()
    expect(extractClaudeDisplayArtifact({ type: 'tool_use', display_content })).toBeNull()
    expect(extractClaudeDisplayArtifact({ type: 'tool_result', display_content: { type: 'json_block', json_block: JSON.stringify({ stdout: 'private output' }) } })).toBeNull()
    expect(extractClaudeDisplayArtifact({ type: 'tool_result', display_content: { type: 'json_block', json_block: 'not json' } })).toBeNull()
  })
})

describe('inferClaudeArtifactType', () => {
  it('uses the payload type for a generic artifacts tool', () => {
    expect(inferClaudeArtifactType({
      name: 'artifacts',
      input: { type: 'document', content: '<html></html>' }
    })).toBe('document')
  })

  it('recognizes HTML MIME types independently of the tool name', () => {
    expect(inferClaudeArtifactType({
      name: 'create_artifact',
      input: { mimeType: 'text/html', content: '<html></html>' }
    })).toBe('html')
  })
})
