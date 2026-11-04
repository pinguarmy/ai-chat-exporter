import { describe, it, expect, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { unzipSync, strFromU8 } from 'fflate'
import { buildArchive, sha256, redactShareText } from '../src/lib/export-archive'
import type { Conversation, ExportOptions } from '../src/lib/types'
const conversation: Conversation = { id: 'c', platform: 'chatgpt', title: 'Archive', url: 'https://example.com/?token=private-value', messages: [{ id: 'a', role: 'assistant', content: 'Authorization: Bearer secret\nAnswer', timestamp: 0 }], traceCoverage: 'provider-exposed', events: [{ id: 'call', kind: 'tool_call', toolName: 'web.run', status: 'unknown', content: 'query' }] }
const options: ExportOptions = { format: 'markdown', includeMetadata: true, includeImages: false, includeCodeBlocks: true }
describe('archive package', () => {
  it('hashes every payload and explicitly marks trace/asset limitations', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const archive = await buildArchive(conversation, options, 'test', 1000)
    const files = unzipSync(archive.bytes)
    const manifest = JSON.parse(strFromU8(files['manifest.json']))
    for (const entry of manifest.files) expect(await sha256(files[entry.path])).toBe(entry.sha256)
    expect(JSON.parse(strFromU8(files['trace.json'])).events).toEqual([])
    expect(manifest.authenticity_validation).toBe('unavailable')
    expect(manifest.diagnostics).toContainEqual({ code: 'tool_calls_without_observed_result', count: 1 })
    vi.unstubAllGlobals()
  })
  it('requires trace opt-in and creates an explicitly marked share copy', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const archive = await buildArchive(conversation, { ...options, includeToolTrace: true, safeShare: true }, 'test')
    const files = unzipSync(archive.bytes)
    expect(strFromU8(files['conversation.md'])).not.toContain('private-value')
    expect(strFromU8(files['conversation.md'])).not.toContain('Bearer secret')
    expect(JSON.parse(strFromU8(files['trace.json'])).events).toHaveLength(1)
    expect(archive.manifest.share_copy).toBe(true)
    expect(archive.manifest.redaction_count).toBeGreaterThan(0)
    vi.unstubAllGlobals()
  })
  it('redacts asset filenames and manifest model metadata in a real share zip', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const secret = 'sk-1234567890abcdefghijklmnop'
    const archive = await buildArchive({ ...conversation, modelName: secret, artifacts: [{ type: 'document', title: secret, content: 'safe body' }] }, { ...options, safeShare: true, exportArtifacts: true }, 'test')
    const files = unzipSync(archive.bytes)
    expect(Object.keys(files).join('\n')).not.toContain(secret)
    const manifest = JSON.parse(strFromU8(files['manifest.json']))
    expect(manifest.models_observed).toEqual(['[REDACTED]'])
    expect(strFromU8(files['manifest.json'])).not.toContain(secret)
    for (const entry of manifest.files) expect(await sha256(files[entry.path])).toBe(entry.sha256)
    vi.unstubAllGlobals()
  })
  it('keeps share archive JSON parseable and honors disabled citations', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const marker = '[citation]'
    const archive = await buildArchive({ ...conversation, events: [{ id: 'x', kind: 'tool_result', toolName: 'test', status: 'success', content: 'Authorization: Bearer private' }], messages: [{ id: 'a', role: 'assistant', content: `Answer ${marker}`, references: [{ type: 'web', title: 'Hidden source', url: 'https://example.invalid' }], citationSpans: [{ start: 7, end: 7 + marker.length, referenceIndexes: [0] }] }] }, { ...options, safeShare: true, referenceExportMode: 'off', includeToolTrace: true }, 'test')
    const files = unzipSync(archive.bytes)
    expect(strFromU8(files['conversation.md'])).not.toContain('Hidden source')
    expect(JSON.parse(strFromU8(files['references.json']))[0].references).toEqual([])
    expect(JSON.parse(strFromU8(files['trace.json'])).events[0].content).toBe('Authorization: [REDACTED]')
    expect(JSON.parse(strFromU8(files['manifest.json']))).toBeTruthy()
    vi.unstubAllGlobals()
  })
  it('does not alter ordinary prose in a share copy', () => {
    expect(redactShareText('A normal sentence.')).toEqual({ text: 'A normal sentence.', replacements: 0 })
  })
})
