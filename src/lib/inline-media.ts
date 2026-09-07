import type { Attachment } from './types'

/**
 * Keep rendered images at their original transcript position whenever a
 * provider gives us an inline handle (for example ChatGPT's
 * `iturn…image…`) or the DOM parser has already emitted Markdown image
 * syntax. Attachments without a source position still fall back to the end of
 * the message instead of being silently discarded.
 */

interface InlineImageContent {
  content: string
  /** Canonical image URLs already represented in `content`. */
  usedImageUrls: Set<string>
}

const PROVIDER_IMAGE_HANDLE = /\b(?:i?turn\d+image\d+)\b/gi
const MARKDOWN_IMAGE = /!\[[^\]]*\]\(([^)]+)\)/g

function imageUrlKey(value: string): string {
  return String(value || '').trim().replace(/\)/g, '%29').replace(/\s/g, '%20')
}

function imageAlt(value: string | undefined): string {
  return String(value || 'Image')
    .replace(/[\r\n\[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Image'
}

function markdownImage(attachment: Attachment): string {
  return `![${imageAlt(attachment.name)}](${imageUrlKey(attachment.url)})`
}

/**
 * Replace provider-internal inline image handles with the concrete image URL
 * extracted from the rendered DOM. The order of attachments is the DOM order,
 * which is the only ordering signal those APIs expose for these handles.
 */
export function embedInlineImageAttachments(
  content: string,
  attachments: Attachment[] | undefined
): InlineImageContent {
  const images = (attachments || []).filter(attachment => attachment.type === 'image' && Boolean(attachment.url?.trim()))
  const usedImageUrls = new Set<string>()
  const referenced = new Set<string>()
  for (const match of String(content || '').matchAll(MARKDOWN_IMAGE)) {
    referenced.add(imageUrlKey(match[1]))
  }

  for (const image of images) {
    if (referenced.has(imageUrlKey(image.url))) usedImageUrls.add(imageUrlKey(image.url))
  }

  let nextImageIndex = 0
  const nextUnrepresentedImage = (): Attachment | undefined => {
    while (nextImageIndex < images.length) {
      const image = images[nextImageIndex++]
      const key = imageUrlKey(image.url)
      if (!usedImageUrls.has(key)) return image
    }
    return undefined
  }

  const resolved = String(content || '').replace(PROVIDER_IMAGE_HANDLE, () => {
    const image = nextUnrepresentedImage()
    if (!image) return ''
    usedImageUrls.add(imageUrlKey(image.url))
    return `\n\n${markdownImage(image)}\n\n`
  })

  return { content: resolved, usedImageUrls }
}

/** Return whether an image attachment was already emitted inline. */
export function isInlineImageAttachment(attachment: Attachment, usedImageUrls: Set<string>): boolean {
  return attachment.type === 'image' && usedImageUrls.has(imageUrlKey(attachment.url))
}

/** Respect the image toggle for provider Markdown that already contains media. */
export function removeInlineMarkdownImages(content: string): string {
  return String(content || '')
    .replace(/(?:^|\n)\s*!\[[^\]]*\]\([^)]+\)\s*(?=\n|$)/g, '\n')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Drop fenced code blocks while keeping inline `code` spans. */
export function removeInlineMarkdownCodeBlocks(content: string): string {
  return String(content || '')
    .replace(/(?:^|\n)[ \t]*(`{3,})[\s\S]*?\1[ \t]*(?=\n|$)/g, '\n')
    .replace(/(`{3,})[\s\S]*?\1/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
