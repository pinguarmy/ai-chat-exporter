import { describe, expect, it } from 'vitest'
import { exportCoverage } from '../src/lib/export-coverage'
import type { Conversation, ExportOptions } from '../src/lib/types'
const options: ExportOptions = { format: 'markdown', includeMetadata: true, includeImages: true, includeCodeBlocks: true, exportArtifacts: true }
const conversation: Conversation = {
  id: 'c', title: 'Coverage', platform: 'claude', url: '',
  messages: [{ id: 'm', role: 'assistant', content: 'Result', attachments: [{ type: 'image', name: 'No bytes', url: '' }, { type: 'file', name: 'Uploaded', url: '', uploaded: true }], references: [{ type: 'web', title: 'Public source', url: 'https://example.invalid', private: false }] }],
  artifacts: [{ type: 'html', title: 'App source', content: '<script>fetch("/not-run")</script>' }, { type: 'document', title: 'Remote document', content: '', url: 'https://example.invalid/doc' }],
}
describe('export coverage', () => {
  it('counts represented resources and missing image bytes separately', () => {
    expect(exportCoverage(conversation, options)).toMatchObject({ messages: 1, references: 1, attachmentLabels: 2, unavailableImages: 1, artifactBodies: 1, artifactLinks: 1, scope: 'conversation' })
  })
  it('applies output settings without pretending hidden resources were captured', () => {
    expect(exportCoverage(conversation, { ...options, exportArtifacts: false, includeImages: false, includeUploadedFiles: false, referenceExportMode: 'off' })).toMatchObject({ references: 0, attachmentLabels: 0, unavailableImages: 0, artifactBodies: 0, artifactLinks: 0 })
  })
})
