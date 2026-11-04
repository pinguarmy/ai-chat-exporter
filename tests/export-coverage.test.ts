import { describe, expect, it } from 'vitest'
import { exportCoverage } from '../src/lib/export-coverage'
import { conversationToMarkdown } from '../src/lib/export-markdown'
import { conversationToHtml } from '../src/lib/export-html'
import { buildArchive } from '../src/lib/export-archive'
import { unzipSync, strFromU8 } from 'fflate'
import type { Conversation, ExportOptions } from '../src/lib/types'
const options: ExportOptions = { format: 'markdown', includeMetadata: true, includeImages: true, includeCodeBlocks: true, exportArtifacts: true }
const conversation: Conversation = {
  id: 'c', title: 'Coverage', platform: 'claude', url: '',
  messages: [{ id: 'm', role: 'assistant', content: 'Result', attachments: [{ type: 'image', name: 'No bytes', url: '' }, { type: 'file', name: 'Uploaded', url: '', uploaded: true }], references: [{ type: 'web', title: 'Public source', url: 'https://example.invalid', private: false }] }],
  artifacts: [{ type: 'html', title: 'App source', content: '<script>fetch("/not-run")</script>' }, { type: 'document', title: 'Remote document', content: '', url: 'https://example.invalid/doc' }],
}
describe('export coverage', () => {
  it('omits disabled code artifacts consistently from coverage and actual Markdown, HTML and ZIP', async () => {
    const withCode: Conversation = { ...conversation, artifacts: [{ type: 'code', title: 'Disabled code', content: 'CODE_BODY_SHOULD_BE_OMITTED' }, { type: 'document', title: 'Kept document', content: 'DOCUMENT_BODY_STAYS' }] }
    const disabled = { ...options, includeCodeBlocks: false }
    expect(exportCoverage(withCode, disabled).artifactBodies).toBe(1)
    const archive = await buildArchive(withCode, disabled, '1.5.0')
    const files = unzipSync(archive.bytes)
    for (const output of [conversationToMarkdown(withCode, disabled), conversationToHtml(withCode, disabled), ...Object.values(files).map(strFromU8)]) {
      expect(output).not.toContain('CODE_BODY_SHOULD_BE_OMITTED')
    }
    expect(conversationToMarkdown(withCode, disabled)).toContain('DOCUMENT_BODY_STAYS')
    expect(conversationToHtml(withCode, disabled)).toContain('DOCUMENT_BODY_STAYS')
  })
  it('counts image labels retained by a snapshot even with image rendering disabled', () => {
    const snapshot = { ...conversation, snapshot: { kind: 'page-snapshot' as const, captureId: 'coverage-snapshot', capturedAt: 1, scope: 'observed-dom' as const, generationState: 'idle' as const } }
    const disabled = { ...options, includeImages: false }
    expect(conversationToMarkdown(snapshot, disabled)).toContain('No bytes (image omitted)')
    expect(conversationToHtml(snapshot, disabled)).toContain('No bytes (image omitted)')
    expect(exportCoverage(snapshot, disabled)).toMatchObject({ attachmentLabels: 2, unavailableImages: 1, scope: 'page' })
  })
  it('does not report ZIP tool records for a PDF merely because an old bundle preference is true', () => {
    const withEvent: Conversation = { ...conversation, events: [{ id: 'e', kind: 'tool_call', toolName: 'synthetic', content: 'event', status: 'unknown' }] }
    expect(exportCoverage(withEvent, { ...options, format: 'pdf', archiveBundle: true, includeToolTrace: true }).toolEvents).toBe(0)
    expect(exportCoverage(withEvent, { ...options, archiveBundle: true, includeToolTrace: true }).toolEvents).toBe(1)
  })
  it('counts represented resources and missing image bytes separately', () => {
    expect(exportCoverage(conversation, options)).toMatchObject({ messages: 1, references: 1, attachmentLabels: 2, unavailableImages: 1, artifactBodies: 1, artifactLinks: 1, scope: 'conversation' })
  })
  it('keeps disabled reference counts at zero for share copies', () => {
    expect(exportCoverage(conversation, { ...options, safeShare: true, referenceExportMode: 'off' }).references).toBe(0)
  })
  it('applies output settings without pretending hidden resources were captured', () => {
    expect(exportCoverage(conversation, { ...options, exportArtifacts: false, includeImages: false, includeUploadedFiles: false, referenceExportMode: 'off' })).toMatchObject({ references: 0, attachmentLabels: 0, unavailableImages: 0, artifactBodies: 0, artifactLinks: 0 })
  })
})
