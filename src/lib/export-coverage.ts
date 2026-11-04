import type { Conversation, ExportOptions } from './types'
import { collectInlineArtifacts, shouldIncludeAttachment } from './export-assets'
import { renderableMessageReferences } from './message-references'

/** Counts only represented export data, never unseen provider resources. */
export function exportCoverage(conversation: Conversation, options: ExportOptions) {
  const attachments = conversation.messages.flatMap(message => message.attachments || [])
    .filter(attachment => shouldIncludeAttachment(attachment, options) && (attachment.type !== 'image' || options.includeImages))
  const artifacts = options.exportArtifacts ? collectInlineArtifacts(conversation, options)
    .filter(artifact => artifact.type !== 'code' || options.includeCodeBlocks) : []
  return {
    messages: conversation.messages.length,
    references: conversation.messages.reduce((count, message) => count + renderableMessageReferences(message.references, options.safeShare ? 'titles' : options.referenceExportMode).length, 0),
    attachmentLabels: attachments.length,
    unavailableImages: attachments.filter(attachment => attachment.type === 'image' && !attachment.url).length,
    artifactBodies: artifacts.filter(artifact => Boolean(artifact.content)).length,
    artifactLinks: artifacts.filter(artifact => !artifact.content).length,
    toolEvents: options.includeToolTrace && options.archiveBundle ? conversation.events?.length || 0 : 0,
    partial: Boolean(conversation.selection),
    scope: conversation.snapshot ? 'page' : conversation.selection ? 'selected' : 'conversation',
  } as const
}
