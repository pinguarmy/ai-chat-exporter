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
  it('does not alter ordinary prose in a share copy', () => {
    expect(redactShareText('A normal sentence.')).toEqual({ text: 'A normal sentence.', replacements: 0 })
  })
})
