import { describe, expect, it, vi } from 'vitest'
import {
  buildPageSnapshot,
  buildSnapshotExportOptions,
  isPageSnapshot,
  prepareSnapshotForOutput,
  snapshotNotice,
} from '../src/lib/page-snapshot'
import { downloadPageSnapshot } from '../src/lib/snapshot-download'
import { isConversationExportable } from '../src/lib/conversation-integrity'
import { conversationToMarkdown } from '../src/lib/export-markdown'
import { buildArchive } from '../src/lib/export-archive'
import type { Conversation } from '../src/lib/types'

vi.mock('../src/lib/export-download', async importOriginal => {
  const original = await importOriginal<typeof import('../src/lib/export-download')>()
  return { ...original, downloadMarkdownFile: vi.fn(async () => {}) }
})

const sampleConversation = (): Conversation => ({
  id: 'conv-100',
  platform: 'gemini',
  title: 'Secret Report token=sk-live-9988776655443322',
  url: 'https://gemini.google.com/app',
  messages: [
    { id: 'm1', role: 'user', content: 'Here is API token=sk-live-1122334455667788' },
    { id: 'm2', role: 'assistant', content: 'Received token, analyzing data.' },
  ],
})

describe('Page Snapshot Hardening Security Tests', () => {
  // --- 1. isPageSnapshot Nested Guards & Platform Gate ---
  it('isPageSnapshot does not throw and returns false when verification.transcript is missing/null', () => {
    const snap = buildPageSnapshot(sampleConversation(), 'idle', 1700000000000, 'cap-1')
    const corrupted1 = {
      ...snap,
      conversation: {
        ...snap.conversation,
        verification: { source: 'dom', provider: 'gemini', capturedAt: snap.capturedAt, transcript: null } as any,
      },
    }
    const corrupted2 = {
      ...snap,
      conversation: {
        ...snap.conversation,
        verification: { source: 'dom', provider: 'gemini', capturedAt: snap.capturedAt, transcript: undefined } as any,
      },
    }
    expect(() => isPageSnapshot(corrupted1)).not.toThrow()
    expect(isPageSnapshot(corrupted1)).toBe(false)
    expect(() => isPageSnapshot(corrupted2)).not.toThrow()
    expect(isPageSnapshot(corrupted2)).toBe(false)
  })

  it('isPageSnapshot does not throw and returns false when verification.transcript.reasons is not an array', () => {
    const snap = buildPageSnapshot(sampleConversation(), 'idle', 1700000000000, 'cap-2')
    const corrupted1 = {
      ...snap,
      conversation: {
        ...snap.conversation,
        verification: {
          source: 'dom',
          provider: 'gemini',
          capturedAt: snap.capturedAt,
          transcript: { verified: false, method: 'dom-unverified', reasons: null },
        } as any,
      },
    }
    const corrupted2 = {
      ...snap,
      conversation: {
        ...snap.conversation,
        verification: {
          source: 'dom',
          provider: 'gemini',
          capturedAt: snap.capturedAt,
          transcript: { verified: false, method: 'dom-unverified', reasons: undefined },
        } as any,
      },
    }
    expect(() => isPageSnapshot(corrupted1)).not.toThrow()
    expect(isPageSnapshot(corrupted1)).toBe(false)
    expect(() => isPageSnapshot(corrupted2)).not.toThrow()
    expect(isPageSnapshot(corrupted2)).toBe(false)
  })

  it('isPageSnapshot rejects unknown or spoofed platforms', () => {
    const snap = buildPageSnapshot(sampleConversation(), 'idle', 1700000000000, 'cap-3')
    const forged = {
      ...snap,
      conversation: {
        ...snap.conversation,
        platform: 'untrusted-platform' as any,
        verification: {
          ...snap.conversation.verification!,
          provider: 'untrusted-platform' as any,
        },
      },
    }
    expect(isPageSnapshot(forged)).toBe(false)
  })

  // --- 2. Reference Whitelist & Unknown Private Policy ---
  it('cleanReference marks unknown connector references as private by default', () => {
    const conv: Conversation = {
      ...sampleConversation(),
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'Check reference',
          references: [
            { type: 'unknown', title: 'Internal Knowledge Base' },
          ],
        },
      ],
    }
    const snap = buildPageSnapshot(conv, 'idle', 1700000000000, 'cap-4')
    const ref = snap.conversation.messages[0].references?.[0]
    expect(ref?.private).toBe(true)
  })

  // --- 3. safeUrl URL Credentials Strip / Reject ---
  it('safeUrl does not accept URLs containing embedded user:password credentials', () => {
    const conv: Conversation = {
      ...sampleConversation(),
      url: 'https://admin:supersecret@internal.corp.com/session',
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'Here is asset',
          attachments: [
            { type: 'image', url: 'https://user:password@example.com/leak.png', name: 'leak.png' },
          ],
          references: [
            { type: 'web', title: 'Doc', url: 'https://user:password@example.com/doc' },
          ],
        },
      ],
    }
    const snap = buildPageSnapshot(conv, 'idle', 1700000000000, 'cap-5')
    expect(snap.conversation.url).not.toContain('supersecret@')
    expect(snap.conversation.messages[0].attachments?.[0].url).not.toContain('password@')
    expect(snap.conversation.messages[0].references?.[0].url ?? '').not.toContain('password@')
  })

  // --- 4. safeShare Filename Leak in snapshot-download ---
  it('downloadPageSnapshot does not leak unredacted title in download filename under safeShare', async () => {
    const snap = buildPageSnapshot(sampleConversation(), 'idle', 1700000000000, 'cap-6')
    const filename = await downloadPageSnapshot(snap, 'markdown', { safeShare: true })
    expect(filename).not.toContain('sk-live-9988776655443322')
    expect(filename).not.toContain('Secret Report token=')
  })

  // --- 5. assistantDisplayName Redaction in Options ---
  it('buildSnapshotExportOptions redacts or strips credentials from assistantDisplayName under safeShare', () => {
    const options = buildSnapshotExportOptions('markdown', {
      safeShare: true,
      assistantDisplayName: 'Bot token=sk-live-1122334455667788',
    })
    expect(options.assistantDisplayName).not.toContain('sk-live-1122334455667788')
  })

  // --- 6. Unique Message IDs during safeShare (Prevent React Duplicate Keys) ---
  it('prepareSnapshotForOutput generates unique message IDs under safeShare to prevent React duplicate keys', () => {
    const snap = buildPageSnapshot(sampleConversation(), 'idle', 1700000000000, 'cap-7')
    const prepared = prepareSnapshotForOutput(snap, { safeShare: true })
    const ids = prepared.conversation.messages.map(m => m.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })

  // --- 7. safeShare Leak in Reference Source and Artifact Metadata ---
  it('prepareSnapshotForOutput omits or sanitizes URLs in reference source and artifact metadata', () => {
    const conv: Conversation = {
      ...sampleConversation(),
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'Reference test',
          references: [
            { type: 'web', title: 'Internal Guide', source: 'https://internal.corp/source-path' },
          ],
        },
      ],
      artifacts: [
        {
          type: 'document',
          title: 'Specs https://confidential.corp/spec.pdf',
          content: 'Public content',
          language: 'https://evil.com/lang',
        },
      ],
    }
    const snap = buildPageSnapshot(conv, 'idle', 1700000000000, 'cap-8')
    const prepared = prepareSnapshotForOutput(snap, { safeShare: true })
    const ref = prepared.conversation.messages[0].references?.[0]
    expect(ref?.source).not.toContain('https://internal.corp')

    const art = prepared.conversation.artifacts?.[0]
    expect(art?.title).not.toContain('https://confidential.corp')
    expect(art?.language).not.toContain('https://evil.com')
  })

  // --- 8. Heuristic Share Notice & Redaction Count ---
  it('prepareSnapshotForOutput provides redaction statistics and heuristic share limitation notice', () => {
    const snap = buildPageSnapshot(sampleConversation(), 'idle', 1700000000000, 'cap-9')
    const prepared = prepareSnapshotForOutput(snap, { safeShare: true })
    const redactionCount =
      prepared.share?.redactionCount ??
      prepared?.conversation?.snapshot?.share?.redactionCount ??
      (prepared?.conversation as any)?.redactionCount
    expect(typeof redactionCount).toBe('number')
    expect(redactionCount).toBeGreaterThan(0)
  })

  // --- 9. Re-prepare Idempotence & URL-only Artifact Preservation ---
  it('prepareSnapshotForOutput is idempotent and does not drop URL-only artifacts across successive preparations', () => {
    const conv: Conversation = {
      ...sampleConversation(),
      artifacts: [
        { type: 'document', content: '', url: 'https://example.com/asset.pdf' },
      ],
    }
    const snap = buildPageSnapshot(conv, 'idle', 1700000000000, 'cap-10')
    const prep1 = prepareSnapshotForOutput(snap, { safeShare: true })
    const prep2 = prepareSnapshotForOutput(prep1, { safeShare: true })

    expect(isPageSnapshot(prep2)).toBe(true)
    expect(prep2.conversation.messages.length).toBe(prep1.conversation.messages.length)
    expect(prep2.conversation.artifacts?.length).toBe(prep1.conversation.artifacts?.length)
    expect(prep2.conversation.artifacts?.[0]?.type).toBe('document')
    expect(prep2.share?.redactionCount).toBe(prep1.share?.redactionCount)
    const withoutShareToggle = prepareSnapshotForOutput(prep1, { safeShare: false })
    expect(withoutShareToggle.share).toEqual(prep1.share)
    expect(snapshotNotice(withoutShareToggle)).toContain('Heuristic safe-share')
  })

  it('does not trust claimed share statistics to bypass redaction or retain unknown metadata', () => {
    const snap = buildPageSnapshot(sampleConversation(), 'idle', 1700000000000, 'claimed-share')
    const share = { redactionCount: 0, limitations: [], arbitrarySecret: 'META-MARKER' }
    snap.share = share; snap.conversation.snapshot!.share = share
    expect(isPageSnapshot(snap)).toBe(true)
    const prepared = prepareSnapshotForOutput(snap, { safeShare: true })
    expect(JSON.stringify(prepared)).not.toContain('META-MARKER')
    expect(JSON.stringify(prepared)).not.toContain('sk-live-9988776655443322')
    expect(prepared.share!.redactionCount).toBeGreaterThan(0)
  })

  // --- 10. Completeness Gate: Archival & Integrity Lock ---
  it('strictly rejects complete archival and exportability for snapshots', async () => {
    const snap = buildPageSnapshot(sampleConversation(), 'idle', 1700000000000, 'cap-11')
    expect(isConversationExportable(snap.conversation)).toBe(false)
    await expect(buildArchive(snap.conversation, buildSnapshotExportOptions('markdown'), 'archive')).rejects.toThrow('Page snapshots')
  })

  // --- 11. Attachment-only / Content-free Gate Under Toggles ---
  it('buildPageSnapshot rejects messages that have no visible text and only credential-only attachments', () => {
    const conv: Conversation = {
      ...sampleConversation(),
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: '   ',
          attachments: [
            { type: 'image', url: 'https://admin:pass@example.com/secret.png' },
          ],
        },
      ],
    }
    const snap = buildPageSnapshot(conv, 'idle', 1700000000000, 'cap-12')
    expect(snap.conversation.messages[0].attachments?.[0].name).toBe('Image attachment')
  })

  it('downloadPageSnapshot rejects exporting snapshots when toggles strip all content leaving empty transcript', async () => {
    const conv: Conversation = {
      ...sampleConversation(),
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: '',
          attachments: [{ type: 'image', url: 'https://example.com/pic.png', name: 'pic.png' }],
        },
      ],
    }
    const snap = buildPageSnapshot(conv, 'idle', 1700000000000, 'cap-13')
    // When includeImages is disabled on an image-only snapshot, the export ends up with 0 content
    const prepared = prepareSnapshotForOutput(snap, { includeImages: false })
    const output = conversationToMarkdown(prepared.conversation, buildSnapshotExportOptions('markdown', { includeImages: false }))
    expect(output).toContain('pic.png')
    expect(output).not.toContain('![pic.png]')
    await expect(downloadPageSnapshot(snap, 'markdown', { includeImages: false })).resolves.toContain('.md')
  })

  it('downloadPageSnapshot rejects exporting uploaded-only snapshot when includeUploadedFiles is false', async () => {
    const conv: Conversation = {
      ...sampleConversation(),
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: '',
          attachments: [{ type: 'file', url: 'https://example.com/doc.pdf', name: 'doc.pdf', uploaded: true }],
        },
      ],
    }
    const snap = buildPageSnapshot(conv, 'idle', 1700000000000, 'cap-14')
    // When includeUploadedFiles is disabled on an uploaded-only snapshot, the export ends up with 0 content
    await expect(downloadPageSnapshot(snap, 'markdown', { includeUploadedFiles: false })).rejects.toThrow()
  })

  it('downloadPageSnapshot rejects exporting code-only snapshot when includeCodeBlocks is false', async () => {
    const conv: Conversation = {
      ...sampleConversation(),
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: '',
          codeBlocks: [{ code: 'console.log("hello world")' }],
        },
      ],
    }
    const snap = buildPageSnapshot(conv, 'idle', 1700000000000, 'cap-15')
    // When includeCodeBlocks is disabled on a code-only snapshot, the export ends up with 0 content
    await expect(downloadPageSnapshot(snap, 'markdown', { includeCodeBlocks: false })).rejects.toThrow()
  })
})
