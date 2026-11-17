import type { Conversation, ExportOptions } from './types'
import { collectInlineArtifacts, shouldIncludeAttachment } from './export-assets'
import { renderableMessageReferences } from './message-references'

/** Counts only represented export data, never unseen provider resources. */
export function exportCoverage(conversation: Conversation, options: ExportOptions) {
  const attachments = conversation.messages.flatMap(message => message.attachments || [])
    .filter(attachment => shouldIncludeAttachment(attachment, options) &&
      (attachment.type !== 'image' || options.includeImages !== false || Boolean(conversation.snapshot)))
  const artifacts = options.exportArtifacts ? collectInlineArtifacts(conversation, options) : []
  return {
    messages: conversation.messages.length,
    references: conversation.messages.reduce((count, message) => count + renderableMessageReferences(message.references, options.safeShare && options.referenceExportMode !== 'off' ? 'titles' : options.referenceExportMode).length, 0),
    attachmentLabels: attachments.length,
    unavailableImages: attachments.filter(attachment => attachment.type === 'image' && !attachment.url).length,
    artifactBodies: artifacts.filter(artifact => Boolean(artifact.content)).length,
    artifactLinks: artifacts.filter(artifact => !artifact.content).length,
    toolEvents: options.format === 'markdown' && options.includeToolTrace && options.archiveBundle ? conversation.events?.length || 0 : 0,
    partial: Boolean(conversation.selection),
    scope: conversation.snapshot ? 'page' : conversation.selection ? 'selected' : 'conversation',
  } as const
}
