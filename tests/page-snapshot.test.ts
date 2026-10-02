import { describe, expect, it } from 'vitest'
import { buildPageSnapshot, buildSnapshotExportOptions, isPageSnapshot, prepareSnapshotForOutput, snapshotNotice } from '../src/lib/page-snapshot'
import { conversationToMarkdown } from '../src/lib/export-markdown'
import { conversationToHtml } from '../src/lib/export-html'
import { isConversationExportable } from '../src/lib/conversation-integrity'
import { buildArchive } from '../src/lib/export-archive'
import type { Conversation } from '../src/lib/types'

const conversation = (): Conversation => ({ id: 'local-1', platform: 'gemini', title: 'Private token=abc', url: 'https://gemini.google.com/app/secret', messages: [
  { id: 'one', role: 'user', content: 'password=supersecret', attachments: [{ type: 'file', url: '', name: 'report.pdf', uploaded: true }] },
  { id: 'two', role: 'user', content: 'password=supersecret' },
] })

describe('page snapshot contract', () => {
  it('whitelists provider data, retains adjacent equal turns and declares limited scope without metadata', () => {
    const source = { ...conversation(), rawProviderPayload: 'PRIVATE', events: [{ id: 'x', kind: 'tool_call', toolName: 'secret', status: 'unknown', content: 'secret' }] } as Conversation
    const snap = buildPageSnapshot(source, 'generating', 1_700_000_000_000, 'capture-abc')
    expect(snap.conversation.messages).toHaveLength(2)
    expect(snap.conversation).not.toHaveProperty('rawProviderPayload')
    expect(snap.conversation).not.toHaveProperty('events')
    expect(snap.conversation.verification?.transcript).toMatchObject({ verified: false, method: 'dom-unverified' })
    expect(isPageSnapshot(snap)).toBe(true)
    expect(isConversationExportable(snap.conversation)).toBe(false)
    const options = buildSnapshotExportOptions('markdown', { includeMetadata: false, archiveBundle: true, includeToolTrace: true, includeRawPayload: true }, snap.capturedAt)
    expect(options).toMatchObject({ archiveBundle: false, includeToolTrace: false, includeRawPayload: false })
    const markdown = conversationToMarkdown(snap.conversation, options)
    expect(markdown).toContain(snapshotNotice(snap))
    expect(markdown).toContain('report.pdf')
    expect(markdown).toContain(new Date(snap.capturedAt).toISOString())
    const html = conversationToHtml(snap.conversation, options)
    expect(html).toContain('snapshot-notice')
    expect(html).toContain(new Date(snap.capturedAt).toISOString())
  })

  it('rejects empty/system-only and forged evidence, while preserving one-sided attachments', () => {
    expect(() => buildPageSnapshot({ ...conversation(), messages: [] })).toThrow()
    expect(() => buildPageSnapshot({ ...conversation(), messages: [{ id: 's', role: 'system', content: 'draft' }] })).toThrow()
    const snap = buildPageSnapshot({ ...conversation(), messages: [{ id: 'a', role: 'assistant', content: '', attachments: [{ type: 'file', url: '', name: 'visible.pdf' }] }] })
    expect(isPageSnapshot(snap)).toBe(true)
    expect(isPageSnapshot({ ...snap, conversation: { ...snap.conversation, verification: { ...snap.conversation.verification!, transcript: { verified: true, method: 'dom-unverified', reasons: [] } } } })).toBe(false)
  })

  it('redacts a separate share copy, strips raw URLs, and blocks complete archives', async () => {
    const snap = buildPageSnapshot(conversation())
    const share = prepareSnapshotForOutput(snap, { safeShare: true })
    expect(share.conversation.messages[0].content).toContain('[REDACTED]')
    expect(share.conversation.url).toBe('')
    expect(snap.conversation.messages[0].content).toContain('supersecret')
    await expect(buildArchive(snap.conversation, buildSnapshotExportOptions('markdown'), 'test')).rejects.toThrow('Page snapshots')
  })
})
