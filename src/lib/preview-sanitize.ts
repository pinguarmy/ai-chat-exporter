/**
 * Final sanitization pass for HTML bound to dangerouslySetInnerHTML.
 *
 * formatHtmlContent() already escapes provider text before assembling HTML;
 * this is a second, belt-and-braces pass so a future escaping regression
 * cannot reach innerHTML.
 *
 * Two deviations from DOMPurify's defaults are required, because both drop
 * content the export pipeline deliberately produces:
 *
 *  - KaTeX renders MathML <semantics>/<annotation>. The default tag allowlist
 *    strips both, which silently discards the TeX source annotation that makes
 *    the equation selectable and searchable.
 *
 *  - `blob:` is not in DOMPurify's default ALLOWED_URI_REGEXP, so images
 *    captured as object URLs lose their src entirely and render broken.
 *    isUsefulMarkdownImageUrl() in export-pdf.ts explicitly admits blob:, so
 *    the sanitizer has to agree with it. blob: is restored only on <img src>
 *    and never on <a href>, so it cannot become a navigation target.
 */
import DOMPurify from 'dompurify'

/** Transient attribute used to carry a blob: src across sanitization. */
const BLOB_SRC_CARRIER = 'data-ace-blob-src'

let hooksInstalled = false

function installHooks(): void {
  if (hooksInstalled) return
  hooksInstalled = true

  DOMPurify.addHook('beforeSanitizeAttributes', (node) => {
    const element = node as Element
    if (element.tagName !== 'IMG' || typeof element.getAttribute !== 'function') return
    const src = element.getAttribute('src')
    if (src && src.startsWith('blob:')) element.setAttribute(BLOB_SRC_CARRIER, src)
  })

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    const element = node as Element
    if (typeof element.getAttribute !== 'function') return
    const preserved = element.getAttribute(BLOB_SRC_CARRIER)
    if (!preserved) return
    element.removeAttribute(BLOB_SRC_CARRIER)
    // Re-check both the tag and the scheme: the carrier attribute could also
    // have arrived in the untrusted input rather than from the hook above.
    if (element.tagName === 'IMG' && preserved.startsWith('blob:')) {
      element.setAttribute('src', preserved)
    }
  })
}

export function sanitizePreviewHtml(html: string): string {
  installHooks()
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['semantics', 'annotation'],
    ADD_ATTR: [BLOB_SRC_CARRIER],
  })
}
