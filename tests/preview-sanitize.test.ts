/**
 * Preview sanitizer contract.
 *
 * The sanitizer sits between formatHtmlContent() and innerHTML, so it has two
 * jobs that pull in opposite directions: strip anything executable, and keep
 * every construct the export pipeline legitimately emits. DOMPurify's defaults
 * satisfy the first but not the second, so both halves are pinned here.
 */
import { describe, expect, it } from 'vitest'
import { renderToString } from 'katex'
import { sanitizePreviewHtml } from '../src/lib/preview-sanitize'

describe('preview sanitizer — blocks active content', () => {
  it('strips event handlers, scripts, and javascript: targets', () => {
    expect(sanitizePreviewHtml('<img src=x onerror=alert(1)>')).not.toContain('onerror')
    expect(sanitizePreviewHtml('<script>alert(1)</script>')).not.toContain('script')
    expect(sanitizePreviewHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:')
    expect(sanitizePreviewHtml('<iframe src="https://evil.example"></iframe>')).not.toContain('iframe')
    expect(sanitizePreviewHtml('<svg><animate onbegin=alert(1) /></svg>')).not.toContain('onbegin')
  })

  it('does not let the blob: carrier attribute become an escape hatch', () => {
    // The carrier is an implementation detail of the hook. Untrusted input
    // that supplies it directly must not be able to smuggle a scheme through,
    // and the attribute itself must never survive into the output.
    const smuggled = sanitizePreviewHtml(
      '<img data-ace-blob-src="javascript:alert(1)" alt="x" />'
    )
    expect(smuggled).not.toContain('javascript:')
    expect(smuggled).not.toContain('data-ace-blob-src')

    // A blob: URL on a non-image tag must not be promoted to a live target.
    const anchor = sanitizePreviewHtml(
      '<a data-ace-blob-src="blob:https://claude.ai/abc" href="#">x</a>'
    )
    expect(anchor).not.toContain('data-ace-blob-src')
    expect(anchor).not.toContain('blob:')
  })
})

describe('preview sanitizer — preserves legitimate export output', () => {
  it('keeps https, data:, and blob: image sources', () => {
    // blob: is absent from DOMPurify's default ALLOWED_URI_REGEXP, so without
    // the hook these images would silently render broken.
    expect(sanitizePreviewHtml('<img src="https://x.example/a.png" />'))
      .toContain('src="https://x.example/a.png"')
    expect(sanitizePreviewHtml('<img src="data:image/png;base64,iVBORw0KGgo=" />'))
      .toContain('src="data:image/png;base64,iVBORw0KGgo="')
    expect(sanitizePreviewHtml('<img src="blob:https://claude.ai/abc-123" />'))
      .toContain('src="blob:https://claude.ai/abc-123"')
  })

  it('keeps blob: images alongside a hostile sibling in one pass', () => {
    const out = sanitizePreviewHtml(
      '<img src="blob:https://claude.ai/keep" /><img src="x" onerror="alert(1)" />'
    )
    expect(out).toContain('blob:https://claude.ai/keep')
    expect(out).not.toContain('onerror')
  })

  it('keeps KaTeX MathML including the TeX source annotation', () => {
    const rendered = renderToString('\\frac{a}{b}', {
      displayMode: true,
      output: 'mathml',
      throwOnError: false,
    })
    const sanitized = sanitizePreviewHtml(rendered)

    expect(sanitized).toContain('<math')
    expect(sanitized).toContain('<semantics>')
    expect(sanitized).toContain('<annotation')
    expect(sanitized).toContain('encoding="application/x-tex"')
    expect(sanitized).toContain('<mfrac>')
  })

  it('keeps code-block language and PDF layout data attributes', () => {
    expect(sanitizePreviewHtml('<pre data-language="ts"><code>x</code></pre>'))
      .toContain('data-language="ts"')
    expect(sanitizePreviewHtml('<div class="latex" data-latex-source="x^2"></div>'))
      .toContain('data-latex-source="x^2"')
  })

  it('keeps ordinary links', () => {
    expect(sanitizePreviewHtml('<a href="https://example.com">x</a>'))
      .toContain('href="https://example.com"')
    expect(sanitizePreviewHtml('<a href="mailto:a@b.com">x</a>'))
      .toContain('href="mailto:a@b.com"')
  })
})
