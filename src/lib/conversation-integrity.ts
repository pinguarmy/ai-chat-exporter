import type { Conversation, VerificationEvidence } from './types'
import { describeVerification } from './verification'

export type ConversationIntegrityStatus = 'complete' | 'suspicious' | 'incomplete' | 'empty'

export interface ConversationIntegrityResult {
  status: ConversationIntegrityStatus
  messageCount: number
  userCount: number
  assistantCount: number
  nonEmptyContentCount: number
  reasons: string[]
  shouldAttemptFallback: boolean
  verification?: VerificationEvidence
}

/** Authoritative completeness bit: verification wins over sourceCompleteness. */
export function isTranscriptVerified(
  conversation: Pick<Conversation, 'sourceCompleteness' | 'verification'> | null | undefined
): boolean | undefined {
  if (!conversation) return undefined
  if (conversation.verification) return conversation.verification.transcript.verified
  if (conversation.sourceCompleteness === 'verified') return true
  if (conversation.sourceCompleteness === 'unverified') return false
  return undefined
}

/**
 * Inspect the shape of a parsed conversation.
 *
 * This deliberately does not decide whether the provider source itself was
 * complete. A verified API transcript can legitimately contain only one side
 * of a chat (for example a user prompt followed by Stop), while a balanced DOM
 * snapshot can still be truncated by virtualization.
 */
export function analyzeConversationIntegrity(
  conversation: Conversation | null | undefined
): ConversationIntegrityResult {
  if (!conversation) {
    return {
      status: 'empty',
      messageCount: 0,
      userCount: 0,
      assistantCount: 0,
      nonEmptyContentCount: 0,
      reasons: ['conversation_missing'],
      shouldAttemptFallback: true,
    }
  }

  const messages = Array.isArray(conversation.messages) ? conversation.messages : []
  const nonEmpty = messages.filter(message => typeof message.content === 'string' && message.content.trim())
  const userCount = nonEmpty.filter(message => message.role === 'user').length
  const assistantCount = nonEmpty.filter(message => message.role === 'assistant').length
  const reasons: string[] = []

  if (messages.length === 0) reasons.push('no_messages')
  if (nonEmpty.length === 0 && messages.length > 0) reasons.push('no_non_empty_content')
  if (userCount > 0 && assistantCount === 0) reasons.push('assistant_messages_missing')
  if (assistantCount > 0 && userCount === 0) reasons.push('user_messages_missing')
  if (userCount === 0 && assistantCount === 0 && messages.length > 0) reasons.push('roles_unrecognized')

  const verified = isTranscriptVerified(conversation)
  if (verified === false) reasons.push('source_unverified')
  if (conversation.verification) {
    for (const reason of conversation.verification.transcript.reasons) {
      if (!reasons.includes(reason)) reasons.push(reason)
    }
  }

  let status: ConversationIntegrityStatus
  if (messages.length === 0 || nonEmpty.length === 0) {
    status = messages.length === 0 ? 'empty' : 'incomplete'
  } else if (userCount === 0 || assistantCount === 0) {
    status = 'suspicious'
  } else {
    status = 'complete'
  }

  return {
    status,
    messageCount: messages.length,
    userCount,
    assistantCount,
    nonEmptyContentCount: nonEmpty.length,
    reasons,
    shouldAttemptFallback: verified === false || status !== 'complete',
    verification: conversation.verification,
  }
}

/**
 * Exportability gate.
 *
 * A provider-verified source is authoritative even when the transcript is
 * legitimately one-sided. Unverified sources are never accepted. Older parser
 * results without source metadata retain the stricter two-sided behavior for
 * backward compatibility.
 */
export function isConversationExportable(
  conversation: Conversation | null | undefined
): conversation is Conversation {
  if (!conversation) return false
  const verified = isTranscriptVerified(conversation)
  if (verified === false) return false

  const integrity = analyzeConversationIntegrity(conversation)
  if (verified === true) {
    return integrity.nonEmptyContentCount > 0 && (integrity.userCount + integrity.assistantCount) > 0
  }

  return integrity.status === 'complete'
}

/**
 * Compatibility name used by older foreground/background paths. "Complete"
 * now means safe to archive under the source-aware contract, not merely that
 * both roles happened to be visible in the parsed result.
 */
export function isConversationComplete(
  conversation: Conversation | null | undefined
): conversation is Conversation {
  return isConversationExportable(conversation)
}

export function conversationIntegrityError(result: ConversationIntegrityResult): string {
  if (result.verification && (result.verification.transcript.verified === false || result.reasons.includes('source_unverified'))) {
    return `The complete conversation source could not be verified (${describeVerification(result.verification)}). Export was stopped to avoid silent data loss.`
  }
  if (result.reasons.includes('source_unverified')) {
    return 'The complete conversation source could not be verified, so export was stopped to avoid silent data loss.'
  }
  if (result.status === 'empty') return 'Conversation is empty or unavailable.'
  if (result.reasons.includes('assistant_messages_missing')) {
    return 'Conversation appears incomplete: no assistant responses were detected.'
  }
  if (result.reasons.includes('user_messages_missing')) {
    return 'Conversation appears incomplete: no user messages were detected.'
  }
  return 'Conversation appears incomplete and cannot be exported safely.'
}
