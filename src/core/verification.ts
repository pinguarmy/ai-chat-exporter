import type {
  Conversation,
  ConversationPlatform,
  ConversationSource,
  ConversationSourceCompleteness,
  TranscriptVerificationMethod,
  VerificationEvidence,
} from './types'

const SAFE_REASON = /^[a-z][a-z0-9_-]{0,63}$/

export interface VerificationEvidenceInput {
  provider: ConversationPlatform
  source: ConversationSource
  transcript: {
    verified: boolean
    method: TranscriptVerificationMethod
    reasons?: string[]
  }
  history?: VerificationEvidence['history']
  capturedAt?: number
}

function sanitizeReasons(reasons: unknown): string[] {
  if (!Array.isArray(reasons)) return []
  const unique: string[] = []
  for (const reason of reasons) {
    if (typeof reason !== 'string') continue
    const code = reason.trim()
    if (!SAFE_REASON.test(code)) continue
    if (!unique.includes(code)) unique.push(code)
  }
  return unique
}

/** Fill capturedAt and sanitize reason codes. Never copies conversation body. */
export function createVerificationEvidence(
  partial: VerificationEvidenceInput
): VerificationEvidence {
  return {
    provider: partial.provider,
    source: partial.source,
    transcript: {
      verified: Boolean(partial.transcript.verified),
      method: partial.transcript.method,
      reasons: sanitizeReasons(partial.transcript.reasons),
    },
    ...(partial.history ? { history: { ...partial.history } } : {}),
    capturedAt: typeof partial.capturedAt === 'number' && Number.isFinite(partial.capturedAt)
      ? partial.capturedAt
      : Date.now(),
  }
}

/** Compatibility helper for older sourceCompleteness-only results. */
export function verificationFromSourceCompleteness(input: {
  provider: ConversationPlatform
  source: ConversationSource
  sourceCompleteness: ConversationSourceCompleteness
  method?: TranscriptVerificationMethod
  reasons?: string[]
  capturedAt?: number
}): VerificationEvidence {
  const verified = input.sourceCompleteness === 'verified'
  const method = input.method ?? (input.source === 'dom' ? 'dom-unverified' : 'provider-api-complete')
  const reasons = input.reasons?.length
    ? input.reasons
    : verified
      ? ['source_verified']
      : ['source_unverified']
  return createVerificationEvidence({
    provider: input.provider,
    source: input.source,
    transcript: { verified, method, reasons },
    capturedAt: input.capturedAt,
  })
}

/**
 * Keep sourceCompleteness in lockstep with verification.transcript.verified.
 * Conversations that only have sourceCompleteness are left unchanged.
 */
export function syncSourceCompleteness(conversation: Conversation): Conversation {
  if (!conversation.verification) return conversation
  const next = conversation.verification.transcript.verified ? 'verified' : 'unverified'
  if (conversation.sourceCompleteness === next) return conversation
  return { ...conversation, sourceCompleteness: next }
}

/** Human-readable one-liner for UI/error text. Never includes private content. */
export function describeVerification(evidence: VerificationEvidence): string {
  const { verified, method, reasons } = evidence.transcript
  const reasonText = reasons.length > 0 ? reasons.join(', ') : 'none'
  const verdict = verified ? 'verified' : 'unverified'
  return `Transcript ${verdict} via ${method} (${reasonText}).`
}
