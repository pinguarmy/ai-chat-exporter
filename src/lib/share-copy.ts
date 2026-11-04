import type { Conversation } from './types'
import { redactShareText } from './share-redaction'
import { renderCitationContent } from './message-references'

/** Heuristic credential redaction, not anonymization of private prose. */
export function prepareShareCopy(conversation: Conversation): Conversation {
  const redact = (text: string) => redactShareText(text).text
  const messages = conversation.messages.map((message, index) => ({
    ...message,
    id: `message-${index + 1}`,
    content: redact(renderCitationContent(message, 'titles')),
    citationSpans: undefined,
    authorName: message.authorName ? redact(message.authorName) : undefined,
    modelName: message.modelName ? redact(message.modelName) : undefined,
    attachments: message.attachments?.map(attachment => ({ ...attachment, name: attachment.name ? redact(attachment.name) : undefined, url: '' })),
    references: message.references?.map(reference => ({ ...reference, title: redact(reference.title), url: undefined, source: reference.source ? redact(reference.source) : undefined })),
    codeBlocks: message.codeBlocks?.map(block => ({ ...block, code: redact(block.code), language: block.language ? redact(block.language) : undefined })),
    referenceDiagnostics: message.referenceDiagnostics?.map(diagnostic => ({ ...diagnostic, marker: '[omitted]' })),
  }))
  const { rawProviderPayload: _raw, events: _events, activeBranchId: _branch, ...rest } = conversation
  return {
    ...rest, id: '[REDACTED]', title: redact(conversation.title), url: '', messages,
    modelName: conversation.modelName ? redact(conversation.modelName) : undefined,
    artifacts: conversation.artifacts?.map(artifact => ({ ...artifact,
      title: artifact.title ? redact(artifact.title) : undefined, content: redact(artifact.content), url: undefined,
      language: artifact.language ? redact(artifact.language) : undefined, mimeType: artifact.mimeType ? redact(artifact.mimeType) : undefined,
    })),
    ...(conversation.selection ? { selection: { ...conversation.selection, selectedMessageIds: messages.map(message => message.id) } } : {}),
  }
}
