import { describe, expect, it } from 'vitest'
import type { Conversation, VerificationEvidence } from '../src/lib/types'
import {
  analyzeConversationIntegrity,
  conversationIntegrityError,
  isConversationExportable,
} from '../src/lib/conversation-integrity'
import {
  createVerificationEvidence,
  describeVerification,
  syncSourceCompleteness,
  verificationFromSourceCompleteness,
} from '../src/lib/verification'

const conversation = (messages: Conversation['messages']): Conversation => ({
  id: 'verification-test',
  title: 'Verification test',
  url: 'https://example.test/chat/verification-test',
  platform: 'chatgpt',
  messages,
})

function chatgptEvidence(overrides: Partial<VerificationEvidence['transcript']> & { source?: VerificationEvidence['source'] } = {}): VerificationEvidence {
  return createVerificationEvidence({
    provider: 'chatgpt',
    source: overrides.source ?? 'api',
    transcript: {
      verified: overrides.verified ?? true,
      method: overrides.method ?? 'active-branch-root-chain',
      reasons: overrides.reasons ?? ['active_branch_root_chain'],
    },
    capturedAt: 1_700_000_000_000,
  })
}

describe('verification evidence', () => {
  it('creates evidence with capturedAt when omitted', () => {
    const before = Date.now()
    const evidence = createVerificationEvidence({
      provider: 'claude',
      source: 'api',
      transcript: {
        verified: true,
        method: 'active-branch-root-chain',
        reasons: ['selected_branch_reaches_root'],
      },
    })
    expect(evidence.capturedAt).toBeGreaterThanOrEqual(before)
    expect(evidence.capturedAt).toBeLessThanOrEqual(Date.now())
    expect(evidence.transcript.reasons).toEqual(['selected_branch_reaches_root'])
  })

  it('drops non-code reasons so describeVerification cannot leak conversation body', () => {
    const evidence = createVerificationEvidence({
      provider: 'chatgpt',
      source: 'api',
      transcript: {
        verified: false,
        method: 'active-branch-root-chain',
        reasons: ['missing_parent', 'Secret prompt about taxes', 'cycle', 'Bearer abc.def'],
      },
    })
    expect(evidence.transcript.reasons).toEqual(['missing_parent', 'cycle'])
    const description = describeVerification(evidence)
    expect(description).toContain('active-branch-root-chain')
    expect(description).toContain('missing_parent')
    expect(description).toContain('cycle')
    expect(description).not.toContain('Secret prompt')
    expect(description).not.toContain('Bearer')
    expect(description).not.toContain('taxes')
  })

  it('exports a verified ChatGPT-style one-sided transcript', () => {
    const verified: Conversation = {
      ...conversation([{ id: 'u1', role: 'user', content: 'Prompt then Stop' }]),
      source: 'api',
      verification: chatgptEvidence({ verified: true, method: 'active-branch-root-chain', reasons: ['active_branch_root_chain'] }),
    }
    const synced = syncSourceCompleteness(verified)
    expect(synced.sourceCompleteness).toBe('verified')
    expect(isConversationExportable(synced)).toBe(true)
    const result = analyzeConversationIntegrity(synced)
    expect(result.reasons).toContain('active_branch_root_chain')
    expect(result.reasons).toContain('assistant_messages_missing')
  })

  it('rejects balanced DOM evidence even when both roles are present', () => {
    const unverified: Conversation = {
      ...conversation([
        { id: 'u1', role: 'user', content: 'Visible question' },
        { id: 'a1', role: 'assistant', content: 'Visible answer' },
      ]),
      source: 'dom',
      verification: chatgptEvidence({
        source: 'dom',
        verified: false,
        method: 'dom-unverified',
        reasons: ['source_unverified'],
      }),
    }
    const synced = syncSourceCompleteness(unverified)
    expect(synced.sourceCompleteness).toBe('unverified')
    expect(isConversationExportable(synced)).toBe(false)
    const result = analyzeConversationIntegrity(synced)
    expect(result.reasons).toContain('source_unverified')
    const error = conversationIntegrityError(result)
    expect(error).toContain('dom-unverified')
    expect(error).toContain('source_unverified')
    expect(error).not.toContain('Visible question')
  })

  it('leaves sourceCompleteness alone when verification is absent', () => {
    const onlyCompleteness: Conversation = {
      ...conversation([{ id: 'u1', role: 'user', content: 'Q' }, { id: 'a1', role: 'assistant', content: 'A' }]),
      sourceCompleteness: 'verified',
    }
    expect(syncSourceCompleteness(onlyCompleteness)).toBe(onlyCompleteness)
    expect(isConversationExportable(onlyCompleteness)).toBe(true)
  })

  it('maps legacy sourceCompleteness into structured evidence', () => {
    const evidence = verificationFromSourceCompleteness({
      provider: 'claude',
      source: 'dom',
      sourceCompleteness: 'unverified',
    })
    expect(evidence.transcript).toMatchObject({
      verified: false,
      method: 'dom-unverified',
      reasons: ['source_unverified'],
    })
  })

  it('keeps legacy sourceCompleteness-only conversations on the old gate', () => {
    const unverified = {
      ...conversation([
        { id: 'u1', role: 'user', content: 'Q' },
        { id: 'a1', role: 'assistant', content: 'A' },
      ]),
      sourceCompleteness: 'unverified' as const,
    }
    expect(isConversationExportable(unverified)).toBe(false)
    expect(conversationIntegrityError(analyzeConversationIntegrity(unverified))).toContain('could not be verified')
  })
})
