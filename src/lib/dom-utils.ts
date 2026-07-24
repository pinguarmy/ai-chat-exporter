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
  const imgElements = container.querySelectorAll('img')
  
  imgElements.forEach(img => {
    const src = img.getAttribute('src') || img.getAttribute('data-src')
    if (src) {
      // Convert relative URLs to absolute
      const url = src.startsWith('http') ? src : new URL(src, baseUrl).href
      images.push({
        url,
        alt: img.getAttribute('alt') || ''
      })
    }
  })
  
  return images
}

/**
 * Extract links from an element
 * @param container - The container element to search
 * @returns Array of link objects
 */
export function extractLinks(container: Element): Array<{ url: string; text: string }> {
  const links: Array<{ url: string; text: string }> = []
  const linkElements = container.querySelectorAll('a[href]')
  
  linkElements.forEach(link => {
    const url = link.getAttribute('href') || ''
    const text = link.textContent?.trim() || ''
    if (url && text) {
      links.push({ url, text })
    }
  })
  
  return links
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
    .replace(/\u00A0/g, ' ') // Non-breaking space
    .replace(/\r\n/g, '\n') // Windows line endings
    .replace(/\r/g, '\n') // Old Mac line endings
    .replace(/[^\S\n]+/g, ' ') // Multiple spaces to single
    .replace(/\n{3,}/g, '\n\n') // Multiple newlines to double
    .trim()
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
 * Check if an element is visible in the DOM
 * @param element - The element to check
 * @returns True if the element is visible
 */
export function isElementVisible(element: Element): boolean {
  const style = window.getComputedStyle(element)
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0'
  )
}

/**
 * Get the closest ancestor matching a selector
 * @param element - The starting element
 * @param selector - CSS selector to match
 * @returns The matching ancestor or null
 */
