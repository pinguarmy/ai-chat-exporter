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

/**
 * A private DOMPurify instance rather than the shared default export.
 *
 * The blob: support below is implemented with hooks, and hooks are global to
 * whichever instance they are registered on. jsPDF declares dompurify as an
 * optional dependency and lazily `import()`s it inside its `.html()` method,
 * which would resolve to that same shared default — so registering on it would
 * quietly change how jsPDF sanitizes too. Nothing calls `jsPDF.html()` today
 * (PDF export goes through html2canvas + addImage), so this is pre-emptive:
 * an isolated instance keeps the blob: exception scoped to our own rendering
 * no matter what a later change does.
 *
 * Created lazily so importing this module does not require a DOM.
 */
let purify: ReturnType<typeof DOMPurify> | null = null

function getPurify(): ReturnType<typeof DOMPurify> {
  if (purify) return purify

  const instance = DOMPurify(window)

  instance.addHook('beforeSanitizeAttributes', (node) => {
    const element = node as Element
    if (element.tagName !== 'IMG' || typeof element.getAttribute !== 'function') return
    const src = element.getAttribute('src')
    if (src && src.startsWith('blob:')) element.setAttribute(BLOB_SRC_CARRIER, src)
  })

  instance.addHook('afterSanitizeAttributes', (node) => {
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

  purify = instance
  return instance
}

export function sanitizePreviewHtml(html: string): string {
  return getPurify().sanitize(html, {
    ADD_TAGS: ['semantics', 'annotation'],
    ADD_ATTR: [BLOB_SRC_CARRIER],
  })
}
