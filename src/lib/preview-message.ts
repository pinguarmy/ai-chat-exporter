/**
 * Pure message transformation and option filtering logic for export preview.
 * Keeps rendered preview semantics consistent with Markdown and PDF exports.
 */

import type { Attachment, ChatMessage, CodeBlock, ExtensionSettings, ReferenceExportMode } from './types'
import { embedInlineImageAttachments, isInlineImageAttachment, removeInlineMarkdownCodeBlocks, removeInlineMarkdownImages } from './inline-media'
import { isPrivateReferenceUrl, renderableExportUrl, renderableMessageReferences } from './message-references'
import { formatHtmlContent } from './export-pdf'
import { t, type Locale } from './i18n'

export { removeInlineMarkdownCodeBlocks } from './inline-media'

/**
 * Filter attachments based on user-upload policy.
 * Matches export-markdown.ts and export-pdf.ts semantics:
 * User-uploaded non-image files are omitted when includeUploadedFiles is false,
 * but user images are ALWAYS preserved (governed only by includeImages).
 */
export function shouldIncludeAttachment(
  attachment: Attachment,
  options?: { includeUploadedFiles?: boolean }
): boolean {
  return !(
    options?.includeUploadedFiles === false &&
    attachment.uploaded === true &&
    attachment.type !== 'image'
  )
}

/**
 * Filter an array of attachments by upload policy.
 */
export function filterMessageAttachments(
  attachments: Attachment[] | undefined,
  options?: { includeUploadedFiles?: boolean }
): Attachment[] {
  return (attachments || []).filter(att => shouldIncludeAttachment(att, options))
}

/**
 * Determine whether message timestamp should be visible.
 * Matches export-markdown.ts:166 and export-pdf.ts:203:
 * Timestamp is only shown if includeMetadata is enabled AND showMessageTimestamps is not false.
 */
export function shouldShowMessageTimestamp(
  timestamp: number | undefined,
  options: { includeMetadata?: boolean; showMessageTimestamps?: boolean }
): boolean {
  if (!timestamp) return false
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return false
  return options.includeMetadata !== false && options.showMessageTimestamps !== false
}

/**
 * Determine whether header metadata row should be visible in preview.
 * Matches export-pdf.ts:129:
 * Header metadata section is only rendered when includeMetadata is enabled.
 */
export function shouldShowHeaderMetadata(options: { includeMetadata?: boolean }): boolean {
  return options.includeMetadata !== false
}

export interface RenderableAttachmentItem {
  name: string
  url?: string
  safeUrl?: string
}

/**
 * Format non-image attachments for preview rendering, ensuring safe link schemes (http/https/mailto)
 * and respecting reference privacy options.
 */
export function getRenderableAttachments(
  attachments: Attachment[],
  options?: { referenceExportMode?: ReferenceExportMode; locale?: Locale }
): RenderableAttachmentItem[] {
  const locale = options?.locale ?? 'en'
  const mode = options?.referenceExportMode
  return attachments
    .filter(att => att.type !== 'image')
    .map(att => {
      const fallbackName = att.name || (att.type === 'link' ? t('Attachment', locale) : att.url) || t('Attachment', locale)
      const rendered = renderableExportUrl(
        fallbackName,
        att.url,
        mode,
        { private: att.url ? isPrivateReferenceUrl(att.url) : true }
      )
      const rawUrl = String(rendered?.url || '').trim()
      const safeUrl = /^(https?:|mailto:)/i.test(rawUrl) ? rawUrl : undefined
      return {
        name: rendered?.title || fallbackName,
        url: att.url,
        safeUrl
      }
    })
}

export interface PreviewMessageOptions {
  includeCodeBlocks?: boolean
  includeImages?: boolean
  includeUploadedFiles?: boolean
  showMessageTimestamps?: boolean
  includeMetadata?: boolean
  referenceExportMode?: ExtensionSettings['referenceExportMode']
  locale?: Locale
}

export interface PreparedPreviewMessage {
  contentHtml: string
  hasEmbeddedCodeBlocks: boolean
  hasTimestamp: boolean
  timestamp: Date | null
  references: ReturnType<typeof renderableMessageReferences>
  imageAttachments: Attachment[]
  otherAttachments: RenderableAttachmentItem[]
  shouldRenderStandaloneCodeBlocks: boolean
  codeBlocks: CodeBlock[]
}

/**
 * Transform a ChatMessage according to current preview and export settings.
 */
export function preparePreviewMessage(
  msg: ChatMessage,
  options: PreviewMessageOptions
): PreparedPreviewMessage {
  const locale = options.locale ?? 'en'
  const includeCodeBlocks = options.includeCodeBlocks !== false
  const includeImages = options.includeImages !== false
  const includeMetadata = options.includeMetadata !== false
  const showMessageTimestamps = options.showMessageTimestamps !== false

  // 1. Filter attachments by includeUploadedFiles
  const filteredAttachments = filterMessageAttachments(msg.attachments, options)

  // 2. Embed inline images
  const inlineImages = embedInlineImageAttachments(msg.content, filteredAttachments)

  // 3. Handle includeImages on content
  let content = includeImages
    ? inlineImages.content
    : removeInlineMarkdownImages(inlineImages.content)

  // 4. Track whether original message content had embedded code fences
  const hasEmbeddedCodeBlocks = /```[\s\S]*?```/.test(content)

  // 5. Handle includeCodeBlocks on content
  if (!includeCodeBlocks) {
    content = removeInlineMarkdownCodeBlocks(content)
  }

  // 6. Format HTML content using existing safe formatter
  const contentHtml = formatHtmlContent(content)

  // 7. Message timestamp
  const hasTimestamp = shouldShowMessageTimestamp(msg.timestamp, {
    includeMetadata,
    showMessageTimestamps
  })
  const timestamp = msg.timestamp ? new Date(msg.timestamp) : null

  // 8. References / Citations
  const references = renderableMessageReferences(msg.references, options.referenceExportMode)

  // 9. Image attachments (not inline)
  const imageAttachments = includeImages
    ? filteredAttachments.filter(
        att => att.type === 'image' && !isInlineImageAttachment(att, inlineImages.usedImageUrls)
      )
    : []

  // 10. Other attachments (files, links)
  const otherAttachments = getRenderableAttachments(filteredAttachments, {
    referenceExportMode: options.referenceExportMode,
    locale
  })

  // 11. Standalone code blocks
  const shouldRenderStandaloneCodeBlocks =
    includeCodeBlocks &&
    !hasEmbeddedCodeBlocks &&
    Boolean(msg.codeBlocks && msg.codeBlocks.length > 0)

  return {
    contentHtml,
    hasEmbeddedCodeBlocks,
    hasTimestamp,
    timestamp,
    references,
    imageAttachments,
    otherAttachments,
    shouldRenderStandaloneCodeBlocks,
    codeBlocks: msg.codeBlocks || []
  }
}
