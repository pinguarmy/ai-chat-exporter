/**
 * Shared DOM utility functions for content scripts
 */

/**
 * Generate a unique ID for messages
 * @returns A unique string identifier
 */
export function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Safely extract text content from an element
 * @param element - The DOM element to extract text from
 * @returns Cleaned text content or empty string
 */
export function extractTextContent(element: Element | null): string {
  if (!element) return ''
  
  const text = element.textContent || ''
  return text
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extract text content preserving line breaks
 * @param element - The DOM element
 * @returns Text with preserved line breaks
 */
export function extractTextWithBreaks(element: Element | null): string {
  if (!element) return ''
  
  const clone = element.cloneNode(true) as Element
  
  // Add line breaks before block elements
  const blockElements = clone.querySelectorAll(
    'p, div, li, h1, h2, h3, h4, h5, h6, blockquote, pre'
  )
  blockElements.forEach(el => {
    el.insertBefore(document.createTextNode('\n'), el.firstChild)
  })
  
  return (clone.textContent || '')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim()
}

/**
 * Extract DOM text without moving images to a synthetic attachment section.
 * The Markdown image tokens preserve the visual DOM order for the shared
 * preview, Markdown and PDF renderers.
 */
export function extractTextWithMedia(element: Element | null, baseUrl?: string): string {
  if (!element) return ''

  const clone = element.cloneNode(true) as Element
  clone.querySelectorAll('img').forEach(image => {
    const extracted = extractImage(image as HTMLImageElement, baseUrl)
    if (!extracted) {
      image.remove()
      return
    }
    const alt = extracted.alt
      .replace(/[\r\n\[\]]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Image'
    const url = extracted.url.replace(/\)/g, '%29').replace(/\s/g, '%20')
    image.replaceWith(document.createTextNode(`\n\n![${alt}](${url})\n\n`))
  })

  return extractTextWithBreaks(clone)
}

/**
 * Extract code blocks from an element
 * @param container - The container element to search
 * @returns Array of code block objects
 */
export function extractCodeBlocks(container: Element): Array<{ language?: string; code: string }> {
  const codeBlocks: Array<{ language?: string; code: string }> = []
  const preElements = container.querySelectorAll('pre')
  
  preElements.forEach(pre => {
    const codeElement = pre.querySelector('code')
    const code = codeElement?.textContent || pre.textContent || ''
    
    // Try to detect language from class names
    let language: string | undefined
    if (codeElement) {
      const classList = Array.from(codeElement.classList)
      const langClass = classList.find(cls => 
        cls.startsWith('language-') || cls.startsWith('lang-')
      )
      if (langClass) {
        language = langClass.replace(/^(language-|lang-)/, '')
      }
    }
    
    if (code.trim()) {
      codeBlocks.push({
        language,
        code: code.trim()
      })
    }
  })
  
  return codeBlocks
}

/**
 * Extract images from an element
 * @param container - The container element to search
 * @param baseUrl - Base URL for relative paths
 * @returns Array of image objects
 */
export function extractImages(
  container: Element,
  baseUrl: string = window.location.origin
): Array<{ url: string; alt: string }> {
  const images: Array<{ url: string; alt: string }> = []
  const seen = new Set<string>()
  const imgElements = container.querySelectorAll('img')
  
  imgElements.forEach(img => {
    const extracted = extractImage(img as HTMLImageElement, baseUrl)
    if (extracted && !seen.has(extracted.url)) {
      seen.add(extracted.url)
      images.push(extracted)
    }
  })
  
  return images
}

/** Resolve the best real source for a provider image element. */
export function extractImage(
  image: HTMLImageElement,
  baseUrl: string = window.location.origin
): { url: string; alt: string } | null {
  // Chat products use a mix of eager `src`, lazy attributes, `srcset`, and
  // sometimes a transparent placeholder in `src`. Prefer the resolved or
  // full-resolution candidates so the PDF receives the image a reader saw.
  const candidates = [
    image.currentSrc,
    image.getAttribute('data-fullres-src'),
    image.getAttribute('data-original'),
    image.getAttribute('data-lazy-src'),
    image.getAttribute('data-src'),
    imageUrlFromSrcset(image.getAttribute('data-srcset')),
    imageUrlFromSrcset(image.getAttribute('srcset')),
    image.getAttribute('src')
  ]
  for (const candidate of candidates) {
    if (!candidate || isPlaceholderImageUrl(candidate)) continue
    try {
      const resolved = /^(?:https?:|data:image\/|blob:)/i.test(candidate)
        ? candidate
        : new URL(candidate, baseUrl).href
      if (/^(?:https?:|data:image\/|blob:)/i.test(resolved)) {
        return { url: resolved, alt: image.getAttribute('alt') || '' }
      }
    } catch {
      // A malformed image source is not exportable; try the next candidate.
    }
  }
  return null
}

function imageUrlFromSrcset(value: string | null): string {
  if (!value) return ''
  // The last candidate is conventionally the largest density/width variant.
  const candidate = value.split(',').map(part => part.trim()).filter(Boolean).at(-1)
  return candidate ? candidate.split(/\s+/)[0] || '' : ''
}

function isPlaceholderImageUrl(value: string): boolean {
  return /(?:^|\/)(?:placeholder|spacer|transparent)(?:[._-]|$)/i.test(value)
    || /^data:image\/(?:gif|png);base64,R0lGODlhAQAB|^data:image\/(?:gif|png);base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB/i.test(value)
}

/**
 * Clean up extracted text by normalizing whitespace
 * @param text - The text to clean
 * @returns Cleaned text
 */
export function cleanText(text: string): string {
  return text
    // ChatGPT private-use citation markers have no useful target outside the
    // source UI and otherwise render as boxes in exported documents.
    .replace(/\uE200(?:cite|navlist)\uE202[\s\S]*?\uE201/g, '')
    // Grok's citation cards are UI-only XML fragments. The API can return
    // them inline with an otherwise valid Markdown response; exporting the
    // raw tags makes them visible as strings such as `<grok:render ...>`.
    .replace(/<grok:render\b[^>]*>[\s\S]*?<\/grok:render>/gi, '')
    .replace(/<grok:render\b[^>]*\/?\s*>/gi, '')
    .replace(/&lt;grok:render\b[\s\S]*?&gt;[\s\S]*?&lt;\/grok:render&gt;/gi, '')
    // ChatGPT can include internal image handles such as `iturn447234image0`
    // in API text. They are not captions or URLs, and should never become a
    // literal paragraph when the actual DOM image is handled as an attachment.
    .replace(/\b(?:i?turn\d+(?:image|video|asset)\d+)\b/gi, '')
    .replace(/\u00A0/g, ' ') // Non-breaking space
    .replace(/\r\n/g, '\n') // Windows line endings
    .replace(/\r/g, '\n') // Old Mac line endings
    .replace(/[^\S\n]+/g, ' ') // Multiple spaces to single
    .replace(/\n{3,}/g, '\n\n') // Multiple newlines to double
    .trim()
}

/**
 * Remove provider-only markup without normalising the surrounding Markdown.
 *
 * Markdown exports should retain intentional whitespace (for example code
 * indentation and table alignment), so callers that need to preserve the
 * original structure should use this narrower helper instead of cleanText().
 */
export function stripProviderArtifacts(text: string): string {
  return String(text)
    .replace(/<grok:render\b[^>]*>[\s\S]*?<\/grok:render>/gi, '')
    .replace(/<grok:render\b[^>]*\/?\s*>/gi, '')
    .replace(/&lt;grok:render\b[\s\S]*?&gt;[\s\S]*?&lt;\/grok:render&gt;/gi, '')
    .replace(/\b(?:i?turn\d+(?:image|video|asset)\d+)\b/gi, '')
}

/**
 * Escape HTML special characters
 * @param text - The text to escape
 * @returns Escaped text
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }
  return text.replace(/[&<>"']/g, char => map[char])
}

/**
 * Get the closest ancestor matching a selector
 * @param element - The starting element
 * @param selector - CSS selector to match
 * @returns The matching ancestor or null
 */
