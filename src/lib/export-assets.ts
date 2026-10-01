import type { Attachment, Conversation, ExportOptions } from './types'
import { isPrivateReferenceUrl, renderableExportUrl, type RenderedMessageReference } from './message-references'

/** Uploaded images follow includeImages; only uploaded non-image files are filtered here. */
export function shouldIncludeAttachment(attachment: Attachment, options?: { includeUploadedFiles?: boolean }): boolean {
  return !(options?.includeUploadedFiles === false && attachment.uploaded === true && attachment.type !== 'image')
}

function shouldIncludeArtifact(artifact: NonNullable<Conversation['artifacts']>[number], options: ExportOptions): boolean {
  const uploaded = artifact.uploaded === true || (artifact.type === 'document' && !artifact.content)
  return !(uploaded && options.includeUploadedFiles === false)
}

/** Apply the same upload/privacy policy to Markdown, HTML and PDF artifact lists. */
export function collectArtifactReferences(conversation: Conversation, options: ExportOptions): RenderedMessageReference[] {
  const references: RenderedMessageReference[] = []
  const seen = new Set<string>()
  const add = (name: string, url: string) => {
    const rendered = renderableExportUrl(name, url, options.referenceExportMode, { private: isPrivateReferenceUrl(url) })
    if (!rendered) return
    const key = `${rendered.title}\u0000${rendered.url || ''}`
    if (seen.has(key)) return
    seen.add(key)
    references.push(rendered)
  }
  for (const artifact of conversation.artifacts || []) {
    if (shouldIncludeArtifact(artifact, options) && !artifact.content && artifact.url) add(artifact.title || artifact.type, artifact.url)
  }
  for (const message of conversation.messages) {
    for (const attachment of message.attachments || []) {
      if (attachment.url && attachment.type !== 'image' && shouldIncludeAttachment(attachment, options)) add(attachment.name || attachment.url, attachment.url)
    }
  }
  return references
}

export function collectInlineArtifacts(conversation: Conversation, options: ExportOptions): NonNullable<Conversation['artifacts']> {
  return (conversation.artifacts || []).filter(artifact =>
    shouldIncludeArtifact(artifact, options) && Boolean(artifact.content || artifact.title || artifact.url)
  )
}
