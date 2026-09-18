import { describe, it, expect, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { unzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate'
import { buildArchive, sha256 } from '../src/lib/export-archive'
import type { Conversation, ExportOptions } from '../src/lib/types'

const rawPayloadData = {
  id: 'conv-chatgpt-1234',
  title: 'Forensic Investigation',
  create_time: 1726700000,
  mapping: {
    'node-root': { id: 'node-root', message: null, parent: null, children: ['node-msg-1'] },
    'node-msg-1': {
      id: 'node-msg-1',
      parent: 'node-root',
      children: [],
      message: {
        id: 'node-msg-1',
        author: { role: 'user' },
        content: { parts: ['Hello raw provider payload'] },
        create_time: 1726700001,
      },
    },
  },
  current_node: 'node-msg-1',
}

const rawPayloadString = JSON.stringify(rawPayloadData)

const conversationWithRaw: Conversation = {
  id: 'conv-chatgpt-1234',
  platform: 'chatgpt',
  title: 'Forensic Investigation',
  url: 'https://chatgpt.com/c/conv-chatgpt-1234',
  messages: [
    { id: 'node-msg-1', role: 'user', content: 'Hello raw provider payload', timestamp: 1726700001000 },
  ],
  traceCoverage: 'provider-exposed',
  rawProviderPayload: rawPayloadString,
}

const baseOptions: ExportOptions = {
  format: 'markdown',
  includeMetadata: true,
  includeImages: false,
  includeCodeBlocks: true,
}

describe('export-archive with raw provider payload', () => {
  it('includes gzipped raw provider payload when includeRawPayload is true', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const options: ExportOptions = { ...baseOptions, includeRawPayload: true }
    const archive = await buildArchive(conversationWithRaw, options, '1.2.6', 1726700100000)
    const files = unzipSync(archive.bytes)

    expect(files['raw-provider.json.gz']).toBeDefined()
    const decompressed = gunzipSync(files['raw-provider.json.gz'])
    const decompressedJson = JSON.parse(strFromU8(decompressed))
    expect(decompressedJson).toEqual(rawPayloadData)

    const manifest = JSON.parse(strFromU8(files['manifest.json']))
    expect(manifest.raw_provider_payload).toBe('included')

    const rawFileEntry = manifest.files.find((f: { path: string }) => f.path === 'raw-provider.json.gz')
    expect(rawFileEntry).toBeDefined()
    expect(rawFileEntry.bytes).toBe(files['raw-provider.json.gz'].length)
    expect(rawFileEntry.bytes).toBeGreaterThan(0)
    expect(rawFileEntry.sha256).toBe(await sha256(files['raw-provider.json.gz']))

    // Hash of gzipped payload must not match hash of uncompressed raw payload
    const uncompressedHash = await sha256(strToU8(rawPayloadString))
    expect(rawFileEntry.sha256).not.toBe(uncompressedHash)

    vi.unstubAllGlobals()
  })

  it('excludes raw provider payload and marks manifest when safeShare is true', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const options: ExportOptions = { ...baseOptions, includeRawPayload: true, safeShare: true }
    const archive = await buildArchive(conversationWithRaw, options, '1.2.6', 1726700100000)
    const files = unzipSync(archive.bytes)

    expect(files['raw-provider.json.gz']).toBeUndefined()

    const manifest = JSON.parse(strFromU8(files['manifest.json']))
    expect(manifest.raw_provider_payload).toBe('excluded-from-share-copy')
    expect(manifest.files.some((f: { path: string }) => f.path === 'raw-provider.json.gz')).toBe(false)
    expect(manifest.share_limitations).toContain('raw provider payload is excluded from share copies.')

    vi.unstubAllGlobals()
  })

  it('preserves existing behavior and sets not-collected when includeRawPayload is unset', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const archive = await buildArchive(conversationWithRaw, baseOptions, '1.2.6', 1726700100000)
    const files = unzipSync(archive.bytes)

    expect(files['raw-provider.json.gz']).toBeUndefined()

    const manifest = JSON.parse(strFromU8(files['manifest.json']))
    expect(manifest.raw_provider_payload).toBe('not-collected')
    expect(manifest.files.some((f: { path: string }) => f.path === 'raw-provider.json.gz')).toBe(false)

    vi.unstubAllGlobals()
  })

  it('sets not-collected when includeRawPayload is true but conversation has no raw payload', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const convWithoutRaw: Conversation = { ...conversationWithRaw, rawProviderPayload: undefined }
    const options: ExportOptions = { ...baseOptions, includeRawPayload: true }
    const archive = await buildArchive(convWithoutRaw, options, '1.2.6', 1726700100000)
    const files = unzipSync(archive.bytes)

    expect(files['raw-provider.json.gz']).toBeUndefined()

    const manifest = JSON.parse(strFromU8(files['manifest.json']))
    expect(manifest.raw_provider_payload).toBe('not-collected')

    vi.unstubAllGlobals()
  })
})
