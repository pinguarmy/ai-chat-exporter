/** PDF layout, text layer and rendering to a Blob; HTML generation is independent. */
import type { jsPDF } from 'jspdf'
import type { Conversation, ExportOptions, PdfStyle } from './types'
import { conversationToHtml, safePdfLinkTarget } from './export-html'
import { throwIfExportCancelled } from './export-cancel'
export {
  platformDisplayName,
  formatModelDisplayName,
  getAssistantDisplayName,
  formatMessageTimestamp,
  conversationToHtml,
  generateArtifactsHtml,
  formatHtmlContent
} from './export-html'

/** Slice of jsPDF's undocumented font object that the searchable-text layer touches. */
interface PdfFont {
  id: string
  isAlreadyPutted?: boolean
  metadata?: {
    Unicode: { widths: number[]; kerning: { fof: number } }
    cmap: { unicode: { codeMap: Record<string, number> } }
    glyIdsUsed: number[]
    toUnicode: Record<string, number>
    characterToGlyph: (code: number) => number
    widthOfGlyph: () => number
  }
  objectNumber?: number
}

/** Argument jsPDF passes to `putFont` listeners. */
interface PdfPutFontArgs {
  font: unknown
  newObject(): number
  putStream(options: { data: string; addLength1: boolean; objectId: number }): void
  out(line: string): void
}

/** The undocumented `pdf.internal` members this file relies on (jsPDF 4.x). */
interface PdfInternals {
  events: {
    getTopics(): Record<string, Record<string, unknown> | undefined>
    subscribe(topic: string, listener: (args: PdfPutFontArgs) => void): void
    unsubscribe(token: string): void
  }
  getFont(name: string, style: string): PdfFont
  write(line: string): void
  getCoordinateString(value: number): string
  getVerticalCoordinateString(value: number): string
}

/** A jsPDF instance whose `internal` is replaced by the narrow shape above. */
type PdfDocument = Omit<jsPDF, 'internal' | 'addFont'> & {
  internal: PdfInternals
  /** jsPDF's typings omit the CJK encodings it accepts at runtime (e.g. Identity-H). */
  addFont(
    postScriptName: string,
    id: string,
    fontStyle: string,
    fontWeight?: string | number,
    encoding?: string
  ): string
}

type JsPdfModule = typeof import('jspdf')
type Html2CanvasModule = typeof import('html2canvas')

// Dynamic imports for jspdf and html2canvas
let jsPDFModule: (JsPdfModule & { default?: Partial<JsPdfModule> }) | null = null
let html2canvasModule: Html2CanvasModule | null = null

async function loadJsPDF(): Promise<JsPdfModule['jsPDF']> {
  if (!jsPDFModule) {
    jsPDFModule = await import('jspdf')
  }
  return (jsPDFModule.jsPDF || jsPDFModule.default?.jsPDF) as JsPdfModule['jsPDF']
}

async function loadHtml2Canvas(): Promise<Html2CanvasModule['default']> {
  if (!html2canvasModule) {
    html2canvasModule = await import('html2canvas')
  }
  return html2canvasModule.default || (html2canvasModule as unknown as Html2CanvasModule['default'])
}

/**
 * Get PDF page dimensions based on page size
 * @param pageSize - Page size (A4 or Letter)
 * @returns Page dimensions in mm
 */
function getPageSizeDimensions(pageSize: 'A4' | 'Letter' = 'A4'): {
  width: number
  height: number
} {
  if (pageSize === 'Letter') {
    return { width: 216, height: 279 } // Letter in mm
  }
  return { width: 210, height: 297 } // A4 in mm
}

export interface PdfPageSlice {
  start: number
  height: number
}

export interface PdfRenderChunk {
  start: number
  height: number
  slices: PdfPageSlice[]
}

export interface PdfTextRun {
  text: string
  left: number
  top: number
  bottom: number
  right: number
  fontSize: number
  /** Browser-computed font styling is required for a faithful visible layer. */
  fontWeight?: number
  fontStyle?: string
  glyphs?: PdfTextGlyph[]
  /** Keep semantic source searchable while leaving a richer visual block alone. */
  searchOnly?: boolean
}

interface PdfTextGlyph {
  text: string
  left: number
  right: number
  top: number
  bottom: number
}

export interface PdfLinkRegion {
  url: string
  left: number
  top: number
  right: number
  bottom: number
}

/** Read link rectangles from the same DOM used to rasterize each PDF page. */
export function collectPdfLinkRegions(container: HTMLElement): PdfLinkRegion[] {
  const containerRect = container.getBoundingClientRect()
  const regions: PdfLinkRegion[] = []

  container.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(anchor => {
    const url = safePdfLinkTarget(anchor.getAttribute('href') || anchor.href || '')
    if (!url) return

    const rects = Array.from(anchor.getClientRects()).filter(
      rect => rect.width > 0 && rect.height > 0
    )
    for (const rect of rects) {
      regions.push({
        url,
        left: rect.left - containerRect.left,
        top: rect.top - containerRect.top,
        right: rect.right - containerRect.left,
        bottom: rect.bottom - containerRect.top
      })
    }
  })

  return regions
}

/**
 * Wait for image dimensions before measuring the document. A failed remote
 * image must not block export forever, so each image has a bounded timeout.
 */
async function waitForPdfImages(
  container: HTMLElement,
  timeoutMs = 6000,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) return
  const images = Array.from(
    container.querySelectorAll<HTMLImageElement>(
      '[data-pdf-block="image"] img, img[data-pdf-block="image"], .image img'
    )
  )
  if (images.length === 0) return

  await Promise.all(
    images.map(image => {
      const removeIfUnavailable = () => {
        // Broken remote image URLs should not leave an empty framed box in the
        // PDF. Removing the figure also removes its pagination breakpoint.
        const renderedRect = image.getBoundingClientRect()
        const isTinyMarkdownAsset =
          image.classList.contains('markdown-image') &&
          image.naturalWidth > 0 &&
          image.naturalHeight > 0 &&
          Math.max(image.naturalWidth, image.naturalHeight) < 120 &&
          Math.max(renderedRect.width, renderedRect.height) < 120
        if (image.complete && (image.naturalWidth === 0 || isTinyMarkdownAsset)) {
          const figure = image.closest('figure.image')
          if (figure) figure.remove()
          else image.remove()
          return true
        }
        return false
      }

      if (image.complete) {
        removeIfUnavailable()
        return Promise.resolve()
      }

      return new Promise<void>(resolve => {
        let settled = false
        // Declared before `finish` (which clears it) and assigned once the timer exists.
        let timeoutId: ReturnType<typeof setTimeout> | undefined = undefined
        const finish = () => {
          if (settled) return
          settled = true
          signal?.removeEventListener('abort', finish)
          image.removeEventListener('load', finish)
          image.removeEventListener('error', finish)
          if (timeoutId !== undefined) clearTimeout(timeoutId)
          removeIfUnavailable()
          resolve()
        }
        signal?.addEventListener('abort', finish, { once: true })
        image.addEventListener('load', finish, { once: true })
        image.addEventListener('error', finish, { once: true })
        timeoutId = setTimeout(finish, timeoutMs)
      })
    })
  )
}

/** Size figures from the actual page budget instead of a fixed pixel cap. */
export function fitPdfImages(container: HTMLElement, maxPageHeightPx: number): number {
  // A media block should read as media, not as a tiny thumbnail in a mostly
  // empty page. Keep enough headroom for the heading/caption while allowing a
  // portrait screenshot to use most of a dedicated page when needed.
  const maxHeight = Math.max(220, Math.floor(maxPageHeightPx * 0.72))
  const images = Array.from(
    container.querySelectorAll<HTMLImageElement>(
      '[data-pdf-block="image"] img, img[data-pdf-block="image"], .image img'
    )
  )
  images.forEach(image => {
    image.style.maxWidth = '100%'
    image.style.maxHeight = `${maxHeight}px`
    image.style.width = 'auto'
    image.style.height = 'auto'
  })

  // If the image would otherwise leave only a small remainder at the bottom
  // of its current page, use that remainder as the cap. This keeps a useful
  // image on the current page instead of manufacturing a mostly blank page.
  if (maxPageHeightPx > 0) {
    const containerTop = container.getBoundingClientRect().top
    images.forEach(image => {
      const rect = image.getBoundingClientRect()
      if (rect.height <= 0) return
      const top = rect.top - containerTop
      const nextPage = (Math.floor(top / maxPageHeightPx) + 1) * maxPageHeightPx
      const available = Math.floor(nextPage - top - 32)
      if (available >= 240 && rect.height > available) {
        image.style.maxHeight = `${available}px`
      }
    })
  }
  return maxHeight
}

export function searchablePdfText(value: string): string {
  return (
    value
      // eslint-disable-next-line no-control-regex -- strips control characters that PDF text objects cannot carry on purpose
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      // Zero-width space, BOM and bidi marks/overrides carry no text. ZWNJ and
      // ZWJ stay: they are spelling in Persian, Indic scripts and emoji.
      .replace(/[\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
      // Unpaired surrogates are invalid text; valid pairs (emoji, rare CJK)
      // are kept and mapped to private-use codes by the text-layer font.
      .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, pair =>
        pair.length === 2 ? pair : ''
      )
      .replace(/\u00A0/g, ' ')
  )
}

/**
 * Keep the page image for backgrounds, rules, table fills, and image
 * attachments, but draw transcript text as PDF text on top. This prevents
 * zoom blur without changing the existing HTML pagination model.
 */
function hidePdfTextForVectorOverlay(container: HTMLElement): () => void {
  const style = document.createElement('style')
  style.textContent = `
    .pdf-vector-base, .pdf-vector-base * {
      color: transparent !important;
      text-shadow: none !important;
    }
    .pdf-vector-base a {
      text-decoration-color: transparent !important;
    }
    .pdf-vector-base ::marker {
      color: transparent !important;
    }
    /* MathML has its own glyph painting path. Keep the browser-rendered
       equation visible and add only its plain source to the searchable layer. */
    .pdf-vector-base .latex,
    .pdf-vector-base .latex * {
      color: #202124 !important;
    }
  `
  container.classList.add('pdf-vector-base')
  container.appendChild(style)
  return () => {
    style.remove()
    container.classList.remove('pdf-vector-base')
  }
}

/**
 * Give each text block its own base direction (`dir="auto"`, resolved from its
 * first strong character) so Arabic, Hebrew and Persian paragraphs, lists,
 * quotes, tables and headings are right-aligned with punctuation on the correct
 * side, while English blocks in the same conversation stay left-to-right.
 * Code blocks and equations are left alone: code reads left-to-right.
 */
export function applyAutoTextDirection(container: HTMLElement): number {
  let count = 0
  container
    .querySelectorAll<HTMLElement>(
      'h1, h2, h3, h4, h5, h6, p, ul, ol, li, blockquote, th, td, figcaption'
    )
    .forEach(element => {
      if (element.hasAttribute('dir') || element.closest('pre, .latex')) return
      element.setAttribute('dir', 'auto')
      count++
    })
  return count
}

function isIgnoredPdfTextElement(element: Element): boolean {
  return Boolean(
    element.closest('style, script, head, title, annotation, math, .latex, [aria-hidden="true"]')
  )
}

/**
 * Decide whether the browser text may safely be replaced by the visible PDF
 * vector layer. This must be stricter than "BMP only": Helvetica is written
 * as WinAnsi, and its advance widths only approximate the browser's font, so
 * it is used only when every character fits it. Any other script, Chinese
 * included, keeps the browser-rendered raster text visible; the browser's own
 * glyphs and metrics are then the only layout that exists.
 */
export function selectPdfVisualTextMode(
  container: HTMLElement,
  runs: PdfTextRun[]
): 'vector' | 'raster' {
  if (runs.length === 0) return 'raster'

  const showText = typeof NodeFilter === 'undefined' ? 4 : NodeFilter.SHOW_TEXT
  const walker = document.createTreeWalker(container, showText)
  let node: Node | null
  while ((node = walker.nextNode())) {
    const parent = node.parentElement
    if (!parent || isIgnoredPdfTextElement(parent)) continue
    try {
      const style = getComputedStyle(parent)
      if (style.display === 'none' || style.visibility === 'hidden') continue
    } catch {
      // A DOM shim without computed style still benefits from the conservative
      // encoding check below.
    }

    for (const character of node.textContent || '') {
      if (!isSupportedVisiblePdfCharacter(character)) return 'raster'
    }
  }
  return 'vector'
}

function shouldSeparatePdfRuns(previous: string, next: string): boolean {
  const left = previous.slice(-1)
  const right = next.slice(0, 1)
  return /[A-Za-z0-9)]/.test(left) && /[A-Za-z0-9(]/.test(right)
}

function pdfFontWeight(value: string | undefined): number {
  const parsed = Number.parseInt(value || '', 10)
  if (Number.isFinite(parsed)) return parsed
  return /bold|bolder/i.test(value || '') ? 700 : 400
}

function isPdfBold(weight: number | undefined): boolean {
  return (weight || 400) >= 600
}

function isPdfItalic(style: string | undefined): boolean {
  return /italic|oblique/i.test(style || '')
}

function helveticaStyle(
  weight: number | undefined,
  style: string | undefined
): 'normal' | 'bold' | 'italic' | 'bolditalic' {
  if (isPdfBold(weight) && isPdfItalic(style)) return 'bolditalic'
  if (isPdfBold(weight)) return 'bold'
  if (isPdfItalic(style)) return 'italic'
  return 'normal'
}

/** Common LaTeX commands and their Unicode text, for the equation's hidden-layer source. */
const LATEX_TEXT_SYMBOLS: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  varepsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  pi: 'π',
  rho: 'ρ',
  sigma: 'σ',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'φ',
  varphi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Xi: 'Ξ',
  Pi: 'Π',
  Sigma: 'Σ',
  Phi: 'Φ',
  Psi: 'Ψ',
  Omega: 'Ω',
  infty: '∞',
  partial: '∂',
  nabla: '∇',
  int: '∫',
  iint: '∬',
  oint: '∮',
  sum: '∑',
  prod: '∏',
  sqrt: '√',
  cdot: '·',
  times: '×',
  div: '÷',
  pm: '±',
  mp: '∓',
  leq: '≤',
  le: '≤',
  geq: '≥',
  ge: '≥',
  neq: '≠',
  ne: '≠',
  approx: '≈',
  equiv: '≡',
  sim: '∼',
  propto: '∝',
  to: '→',
  rightarrow: '→',
  leftarrow: '←',
  Rightarrow: '⇒',
  Leftarrow: '⇐',
  leftrightarrow: '↔',
  Leftrightarrow: '⇔',
  mapsto: '↦',
  in: '∈',
  notin: '∉',
  subset: '⊂',
  subseteq: '⊆',
  supset: '⊃',
  cup: '∪',
  cap: '∩',
  forall: '∀',
  exists: '∃',
  neg: '¬',
  land: '∧',
  lor: '∨',
  emptyset: '∅',
  ldots: '…',
  cdots: '⋯',
  dots: '…',
  circ: '∘',
  angle: '∠',
  degree: '°',
  hbar: 'ħ',
  ell: 'ℓ',
  Re: 'ℜ',
  Im: 'ℑ',
  aleph: 'ℵ',
  langle: '⟨',
  rangle: '⟩'
}

/**
 * Plain-text form of a LaTeX formula for the PDF's hidden layer. Commands map
 * to their Unicode symbol (`\pi` becomes `π`) instead of vanishing, fractions
 * and roots keep their operands, and unknown commands keep their name.
 */
export function latexSearchText(value: string): string {
  let text = value.replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g, '$1')
  // Innermost first, so a nested \frac{\sqrt{\pi}}{2} resolves in a few passes.
  for (let pass = 0; pass < 6; pass++) {
    const next = text
      .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1 / $2')
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, '√$1')
    if (next === text) break
    text = next
  }
  return text
    .replace(/\\(?:left|right|,|;|!|:|\s+)/g, ' ')
    .replace(/\\([A-Za-z]+)/g, (_match, name: string) => LATEX_TEXT_SYMBOLS[name] ?? name)
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const RTL_PDF_CHARACTER =
  /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc\u{10800}-\u{10fff}\u{1e800}-\u{1efff}]/u

/**
 * Right-to-left text must reach the PDF in visual (left-to-right on the page)
 * order, which is how PDF producers store it and what readers such as PDFium
 * and Poppler expect when they re-apply the bidi algorithm for search and copy.
 * The DOM gives logical order, so a line containing Arabic/Hebrew/etc. is
 * re-sequenced by the measured position of each glyph; no bidi implementation
 * is needed because the browser has already laid every character out.
 */
export function reorderPdfRunVisually(run: PdfTextRun): PdfTextRun {
  if (!run.glyphs || run.glyphs.length < 2 || !RTL_PDF_CHARACTER.test(run.text)) return run
  // Combining marks and joiners travel with the character they follow.
  const clusters: PdfTextGlyph[] = []
  for (const glyph of run.glyphs) {
    const previous = clusters.at(-1)
    // eslint-disable-next-line no-misleading-character-class -- the class lists the joiners/selectors on purpose
    if (previous && /^[\p{M}\u200c\u200d\ufe0f]+$/u.test(glyph.text)) {
      previous.text += glyph.text
    } else {
      clusters.push({ ...glyph })
    }
  }
  const ordered = clusters
    .map((glyph, index) => ({ glyph, index }))
    .sort(
      (a, b) =>
        (a.glyph.left + a.glyph.right) / 2 - (b.glyph.left + b.glyph.right) / 2 || a.index - b.index
    )
    .map(({ glyph }) => {
      // Readers reverse right-to-left runs character by character when they
      // convert the stored visual order back to logical order, so a cluster
      // inside such a run is stored mark-first to read back base-first.
      const characters = Array.from(glyph.text)
      return RTL_PDF_CHARACTER.test(characters[0]) && characters.length > 1
        ? { ...glyph, text: characters.reverse().join('') }
        : glyph
    })
  return { ...run, glyphs: ordered, text: ordered.map(glyph => glyph.text).join('') }
}

/**
 * Extract browser line boxes into a lightweight text layer model. Character
 * ranges are used because a single Range rect does not tell us which text
 * belongs to which wrapped line.
 */
export function collectPdfTextRuns(container: HTMLElement): PdfTextRun[] {
  // Per-character Range measurement is the accurate way to preserve wrapped
  // lines, but it can monopolize the extension page for enormous transcripts.
  // In that exceptional case, returning no runs keeps the complete browser
  // rendering as the visual source instead of approximating layout.
  const MAX_RANGE_LAYOUT_CHARACTERS = 250_000
  if ((container.textContent || '').length > MAX_RANGE_LAYOUT_CHARACTERS) return []

  const containerRect = container.getBoundingClientRect()
  const showText = typeof NodeFilter === 'undefined' ? 4 : NodeFilter.SHOW_TEXT
  const walker = document.createTreeWalker(container, showText)
  const runs: PdfTextRun[] = []
  let node: Node | null

  while ((node = walker.nextNode())) {
    const parent = node.parentElement
    const value = node.textContent || ''
    if (!parent || !value.trim()) continue
    // MathML contains an <annotation> child carrying the original TeX source.
    // It is useful for accessibility in the HTML preview, but emitting that
    // hidden source into the PDF text layer would duplicate the equation and
    // make search results look like raw `\\[...\\]` markup.
    if (
      parent.closest('style, script, head, title, annotation, math, .latex, [aria-hidden="true"]')
    )
      continue

    let style: CSSStyleDeclaration | null = null
    try {
      style = getComputedStyle(parent)
      if (style.display === 'none' || style.visibility === 'hidden') continue
    } catch {
      // A DOM shim may not implement computed styles. Layout rects remain
      // sufficient for the optional text layer in that environment.
    }
    const fontSize = Math.max(1, Number.parseFloat(style?.fontSize || '16') || 16)
    const fontWeight = pdfFontWeight(style?.fontWeight)
    const fontStyle = style?.fontStyle || 'normal'
    const lineRuns = new Map<number, PdfTextRun>()
    const range = document.createRange()
    let pendingSpaces = 0
    // Zero-width characters (ZWJ/ZWNJ, variation selectors, tag characters)
    // have no Range rect. They belong to the preceding glyph, or to the next
    // one when they open the text node.
    let pendingMarks = ''
    let lastRun: PdfTextRun | null = null
    let lastGlyph: PdfTextGlyph | null = null

    // Walk code points, not UTF-16 units, so emoji and other astral characters
    // are measured and kept whole instead of being dropped as lone surrogates.
    for (let index = 0; index < value.length;) {
      const start = index
      const codePoint = value.codePointAt(index) ?? 0
      index += codePoint > 0xffff ? 2 : 1
      const piece = value.slice(start, index)
      if (piece === '\n' || piece === '\r' || (codePoint >= 0xd800 && codePoint <= 0xdfff)) continue
      try {
        range.setStart(node, start)
        range.setEnd(node, index)
        const rect = Array.from(range.getClientRects()).find(
          item => item.width > 0 && item.height > 0
        )
        if (!rect) {
          // Browsers commonly omit collapsed whitespace from Range rects.
          // Hold it until the next visible glyph so copy/search preserves the
          // spaces that separate Latin identifiers and CJK text.
          if (piece === ' ' || piece === '\u00a0') pendingSpaces++
          else if (lastRun && lastGlyph) {
            lastRun.text += piece
            lastGlyph.text += piece
          } else pendingMarks += piece
          continue
        }
        const character = pendingMarks + piece
        pendingMarks = ''

        const top = rect.top - containerRect.top
        const bottom = rect.bottom - containerRect.top
        const lineKey = Math.round(top * 2) / 2
        const existing = lineRuns.get(lineKey)
        if (existing) {
          if (pendingSpaces > 0) {
            const spaceStart = existing.right
            const spaceEnd = Math.max(spaceStart, rect.left - containerRect.left)
            const spaceWidth = Math.max(fontSize * 0.22, (spaceEnd - spaceStart) / pendingSpaces)
            for (let spaceIndex = 0; spaceIndex < pendingSpaces; spaceIndex++) {
              const left = spaceStart + spaceIndex * spaceWidth
              existing.glyphs?.push({
                text: ' ',
                left,
                right: left + spaceWidth,
                top,
                bottom
              })
            }
            existing.text += ' '.repeat(pendingSpaces)
          }
          pendingSpaces = 0
          existing.text += character
          existing.left = Math.min(existing.left, rect.left - containerRect.left)
          existing.right = Math.max(existing.right, rect.right - containerRect.left)
          existing.bottom = Math.max(existing.bottom, bottom)
          lastGlyph = {
            text: character,
            left: rect.left - containerRect.left,
            right: rect.right - containerRect.left,
            top,
            bottom
          }
          existing.glyphs?.push(lastGlyph)
          lastRun = existing
        } else {
          pendingSpaces = 0
          lastGlyph = {
            text: character,
            left: rect.left - containerRect.left,
            right: rect.right - containerRect.left,
            top,
            bottom
          }
          lastRun = {
            text: character,
            left: rect.left - containerRect.left,
            top,
            bottom,
            right: rect.right - containerRect.left,
            fontSize,
            fontWeight,
            fontStyle,
            glyphs: [lastGlyph]
          }
          lineRuns.set(lineKey, lastRun)
        }
      } catch {
        // Detached or otherwise malformed text nodes are safe to skip.
      }
    }

    for (const lineRun of lineRuns.values()) runs.push(reorderPdfRunVisually(lineRun))
  }

  // MathML token nodes are intentionally excluded from the visible vector
  // layer. Keep a plain source string at the same location so search/copy
  // still finds the equation while browser-rendered MathML remains the visual
  // source (and does not get split into overlapping glyph runs).
  container.querySelectorAll<HTMLElement>('.latex[data-latex-source]').forEach(element => {
    const source = searchablePdfText(
      latexSearchText(element.getAttribute('data-latex-source') || '')
    )
    if (!source.trim()) return
    const rect = element.getBoundingClientRect()
    let style: CSSStyleDeclaration | null = null
    try {
      style = getComputedStyle(element)
    } catch {
      // A DOM shim may not expose computed style; the default is adequate.
    }
    const fontSize = Math.max(1, Number.parseFloat(style?.fontSize || '16') || 16)
    runs.push({
      text: source,
      left: rect.left - containerRect.left,
      top: rect.top - containerRect.top,
      bottom: rect.bottom - containerRect.top,
      right: rect.right - containerRect.left,
      fontSize,
      fontWeight: pdfFontWeight(style?.fontWeight),
      fontStyle: style?.fontStyle || 'normal',
      searchOnly: true
    })
  })

  const ordered = runs
    .map(run => ({
      ...run,
      text: searchablePdfText(run.text),
      glyphs: run.glyphs?.filter(glyph => searchablePdfText(glyph.text))
    }))
    .filter(run => run.text.trim())
    .sort((a, b) => a.top - b.top || a.left - b.left)

  // Merge adjacent inline nodes (for example <strong> and plain text) back
  // into one PDF line without joining separate table cells or columns.
  const merged: PdfTextRun[] = []
  for (const run of ordered) {
    const previous = merged.at(-1)
    const joinDistance = Math.max(8, run.fontSize * 2)
    if (
      previous &&
      previous.searchOnly === run.searchOnly &&
      previous.fontWeight === run.fontWeight &&
      previous.fontStyle === run.fontStyle &&
      Math.abs(previous.top - run.top) <= 2 &&
      run.left >= previous.left - 1 &&
      run.left <= previous.right + joinDistance
    ) {
      const separator = shouldSeparatePdfRuns(previous.text, run.text) ? ' ' : ''
      previous.text += separator + run.text
      if (separator && previous.glyphs) {
        previous.glyphs.push({
          text: separator,
          left: previous.right,
          right: run.left,
          top: run.top,
          bottom: run.bottom
        })
      }
      if (previous.glyphs && run.glyphs) previous.glyphs.push(...run.glyphs)
      previous.right = Math.max(previous.right, run.right)
      previous.bottom = Math.max(previous.bottom, run.bottom)
    } else {
      merged.push(run)
    }
  }
  return merged
}

/** UTF-16BE hex of one code point, as a ToUnicode destination requires. */
function pdfUtf16Hex(codePoint: number): string {
  if (codePoint <= 0xffff) return codePoint.toString(16).padStart(4, '0')
  const offset = codePoint - 0x10000
  const high = 0xd800 + (offset >> 10)
  const low = 0xdc00 + (offset & 0x3ff)
  return high.toString(16) + low.toString(16)
}

/**
 * Give every distinct character of the text layer a 16-bit code. BMP
 * characters keep their own code point (so the visible CJK/Latin overlay is
 * unchanged); characters outside the BMP (emoji, tag sequences, rare CJK) get
 * a free private-use code, and the ToUnicode CMap maps it back to the real
 * character. The hidden layer is invisible, so the code only has to be unique.
 */
export function buildPdfCodeTable(texts: Iterable<string>): {
  codeOf: (character: string) => number
  toUnicode: Record<string, number>
} {
  const bmp = new Set<number>()
  const astral = new Set<number>()
  for (const text of texts) {
    for (const character of text) {
      const codePoint = character.codePointAt(0) ?? 0
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue
      ;(codePoint > 0xffff ? astral : bmp).add(codePoint)
    }
  }
  const assigned = new Map<number, number>()
  const toUnicode: Record<string, number> = {}
  for (const codePoint of bmp) {
    assigned.set(codePoint, codePoint)
    toUnicode[codePoint] = codePoint
  }
  let nextPrivate = 0xe000
  for (const codePoint of [...astral].sort((a, b) => a - b)) {
    while (nextPrivate <= 0xf8ff && bmp.has(nextPrivate)) nextPrivate++
    // More than ~6,000 distinct astral characters in one document: map the
    // overflow to U+FFFD so the loss is visible in extracted text, never silent.
    const code = nextPrivate <= 0xf8ff ? nextPrivate++ : 0xfffd
    assigned.set(codePoint, code)
    toUnicode[code] = code === 0xfffd ? 0xfffd : codePoint
  }
  return {
    codeOf: character => {
      const codePoint = character.codePointAt(0) ?? 0
      return assigned.get(codePoint) ?? (codePoint > 0xffff ? 0xfffd : codePoint)
    },
    toUnicode
  }
}

function pdfUnicodeCmap(font: PdfFont): string {
  const toUnicodeMap = font.metadata?.toUnicode ?? {}
  const entries = Object.keys(toUnicodeMap)
    .map(Number)
    .sort((a, b) => a - b)
    .map(code => {
      const target = Number(toUnicodeMap[code])
      return `<${code.toString(16).padStart(4, '0')}><${pdfUtf16Hex(target)}>`
    })
  const chunks: string[] = []
  for (let index = 0; index < entries.length; index += 100) {
    const chunk = entries.slice(index, index + 100)
    chunks.push(`${chunk.length} beginbfchar\n${chunk.join('\n')}\nendbfchar`)
  }
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000><ffff>',
    'endcodespacerange',
    ...chunks,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end'
  ].join('\n')
}

/** The hidden-text CID font plus the character-to-code table built for one document. */
interface PdfTextFont {
  codeOf: (character: string) => number
  /**
   * Identity-H font for the hidden layer of every line the standard Helvetica
   * resource cannot encode (Chinese, Japanese, Korean, Cyrillic, Arabic, ...).
   * Its codes are plain CIDs, so every reader decodes them through the
   * ToUnicode CMap alone: no predefined CJK CMap and no font data are needed.
   * Absent when the document is pure Latin-1 text.
   */
  unicodeId?: string
}

/**
 * Install the hidden-text font. No glyph outlines are embedded: the font is
 * invisible (render mode 3) and only carries the ToUnicode map, so the package
 * does not need to ship a multi-megabyte CJK font. The visible layer of any
 * text outside Helvetica's character set is the browser raster.
 *
 * Chinese used to be drawn as visible vector text with the non-embedded
 * `STSong-Light` / `UniGB-UCS2-H` resource. Viewers that lack a CJK substitute
 * (Poppler without poppler-data) drew nothing, and the browser's DOM metrics
 * never matched the substitute font's advances, so labels overlapped values.
 */
function installSearchablePdfFont(pdf: PdfDocument, runs: PdfTextRun[]): PdfTextFont | null {
  if (typeof pdf?.addFont !== 'function' || !pdf.internal?.events?.getTopics) return null
  const { codeOf, toUnicode } = buildPdfCodeTable(runs.map(run => run.text))
  if (!runs.some(run => [...run.text].some(isForeignPdfCharacter))) return { codeOf }

  // jsPDF's bundled TTF listeners try to load a file whenever addFont is
  // called. Remove those per-document listeners before registering the
  // font; no later custom fonts are added to this document.
  const topics = pdf.internal.events.getTopics()
  for (const token of Object.keys(topics.addFont || {})) {
    pdf.internal.events.unsubscribe(token)
  }

  // jsPDF 4.x treats the fourth argument as a font weight unless it is one
  // of its small set of legacy encodings; the encoding goes in the fifth slot.
  pdf.addFont('ArialUnicodeMS', '__ai_chat_exporter_uni', 'normal', undefined, 'Identity-H')
  const unicodeFont = pdf.internal.getFont('__ai_chat_exporter_uni', 'normal')
  const widths = [] as number[] & { fof?: number }
  widths.fof = 1000
  widths[0] = 1000
  widths.indexOf = () => -1
  const codeMap: Record<string, number> = {}
  for (const key of Object.keys(toUnicode)) codeMap[Number(key)] = 1
  unicodeFont.metadata = {
    Unicode: { widths, kerning: { fof: 1000 } },
    cmap: { unicode: { codeMap } },
    glyIdsUsed: [0],
    toUnicode,
    characterToGlyph: (code: number) => code,
    widthOfGlyph: () => 1000
  }

  pdf.internal.events.subscribe('putFont', (args: PdfPutFontArgs) => {
    if (args.font !== unicodeFont) return
    const cmapObject = args.newObject()
    args.putStream({
      data: pdfUnicodeCmap(unicodeFont),
      addLength1: true,
      objectId: cmapObject
    })
    args.out('endobj')

    const descriptor = args.newObject()
    args.out('<< /Type /FontDescriptor /FontName /ArialUnicodeMS /Flags 4')
    args.out('/FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 900 /Descent -200')
    args.out('/CapHeight 700 /StemV 80 >>')
    args.out('endobj')

    const descendant = args.newObject()
    args.out('<<')
    args.out('/Type /Font')
    args.out('/Subtype /CIDFontType2')
    args.out('/BaseFont /ArialUnicodeMS')
    args.out('/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>')
    args.out(`/FontDescriptor ${descriptor} 0 R`)
    args.out('/CIDToGIDMap /Identity')
    args.out('/DW 1000')
    args.out(`/W [${pdfUnicodeWidthArray(toUnicode)}]`)
    args.out('>>')
    args.out('endobj')

    unicodeFont.objectNumber = args.newObject()
    args.out('<<')
    args.out('/Type /Font')
    args.out('/Subtype /Type0')
    args.out('/BaseFont /ArialUnicodeMS')
    args.out(`/ToUnicode ${cmapObject} 0 R`)
    args.out('/Encoding /Identity-H')
    args.out(`/DescendantFonts [${descendant} 0 R]`)
    args.out('>>')
    args.out('endobj')
    unicodeFont.isAlreadyPutted = true
  })

  return { codeOf, unicodeId: unicodeFont.id }
}

const PDF_POINTS_PER_MM = 72 / 25.4

/** Two-byte hex codes for the CID font; nothing is dropped (see buildPdfCodeTable). */
export function pdfTextHex(value: string, codeOf: (character: string) => number): string {
  let hex = ''
  for (const character of value) hex += codeOf(character).toString(16).padStart(4, '0')
  return hex
}

const PDF_WIN_ANSI_BYTES: Record<number, number> = {
  0x2018: 0x91,
  0x2019: 0x92,
  0x201a: 0x82,
  0x201c: 0x93,
  0x201d: 0x94,
  0x201e: 0x84,
  0x2020: 0x86,
  0x2021: 0x87,
  0x2022: 0x95,
  0x2026: 0x85,
  0x2030: 0x89,
  0x2039: 0x8b,
  0x203a: 0x9b,
  0x20ac: 0x80,
  0x2122: 0x99,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02c6: 0x88,
  0x02dc: 0x98,
  0x0160: 0x8a,
  0x0161: 0x9a,
  0x017d: 0x8e,
  0x017e: 0x9e,
  0x0192: 0x83
}

function pdfWinAnsiByte(character: string): number | null {
  const codePoint = character.codePointAt(0) || 0
  if (codePoint >= 0x20 && codePoint <= 0x7e) return codePoint
  if (codePoint >= 0xa0 && codePoint <= 0xff) return codePoint
  return PDF_WIN_ANSI_BYTES[codePoint] ?? null
}

function pdfAsciiHex(value: string): string {
  let hex = ''
  for (const character of value) {
    const byte = pdfWinAnsiByte(character)
    if (byte === null) continue
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

/**
 * Typical advance (1/1000 em) of one character in the Identity-H hidden-text
 * font. The font has no outlines, so this only has to be close enough that
 * fitting a line to its measured width needs a small `Tc`; with a flat 1em per
 * character, Thai or Devanagari lines get a large negative spacing and readers
 * split them into one character per line.
 */
export function pdfUnicodeAdvanceUnits(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0
  if (codePoint === 0x20) return 250
  // Combining marks, joiners, variation selectors and tag characters add no width.
  // eslint-disable-next-line no-misleading-character-class -- the class lists the joiners/selectors on purpose
  if (/^[\p{M}\u200c\u200d\ufe0f\u{e0020}-\u{e007f}]$/u.test(character)) return 0
  if (codePoint < 0x100) return 500
  if (
    codePoint > 0xffff || // emoji and other astral characters
    isCjkPdfCharacter(character) ||
    (codePoint >= 0x3040 && codePoint <= 0x30ff) || // kana
    (codePoint >= 0xac00 && codePoint <= 0xd7af) || // Hangul syllables
    (codePoint >= 0x1100 && codePoint <= 0x11ff) // Hangul jamo
  ) {
    return 1000
  }
  return 550 // Latin extended, Greek, Cyrillic, Hebrew, Arabic, Indic, Thai, ...
}

/** Natural width of `value` in the Identity-H hidden-text font. */
export function pdfUnicodeWidthUnits(value: string): number {
  let units = 0
  for (const character of value) units += pdfUnicodeAdvanceUnits(character)
  return units
}

/** `/W` array body for the Identity-H font: `code [widths...]` runs for assigned codes. */
export function pdfUnicodeWidthArray(toUnicode: Record<string, number>): string {
  const codes = Object.keys(toUnicode)
    .map(Number)
    .sort((a, b) => a - b)
  const parts: string[] = []
  let start = 0
  let widths: number[] = []
  const flush = () => {
    if (widths.length > 0) parts.push(`${start} [${widths.join(' ')}]`)
    widths = []
  }
  for (const code of codes) {
    if (widths.length > 0 && code !== start + widths.length) flush()
    if (widths.length === 0) start = code
    widths.push(pdfUnicodeAdvanceUnits(String.fromCodePoint(toUnicode[code])))
  }
  flush()
  return parts.join(' ')
}

function pdfNumber(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) < 0.0001) return '0'
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

export function isCjkPdfCharacter(value: string): boolean {
  const codePoint = value.codePointAt(0) || 0
  return (
    (codePoint >= 0x3000 && codePoint <= 0x303f) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff01 && codePoint <= 0xff5e) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6)
  )
}

/**
 * A character the standard Helvetica (WinAnsi) resource cannot draw: Chinese,
 * Kana, Hangul, Arabic, Hebrew, Indic, Thai, Cyrillic, Greek, Vietnamese,
 * emoji, ... Such text keeps the browser raster as its visible layer, and its
 * hidden layer uses the code table of the Identity-H font so that nothing is
 * lost from search and copy.
 */
export function isForeignPdfCharacter(character: string): boolean {
  return pdfWinAnsiByte(character) === null && searchablePdfText(character) !== ''
}

export function isSupportedVisiblePdfCharacter(character: string): boolean {
  // Layout/control characters have no glyph for the visible layer. Zero-width
  // formatting marks are stripped by searchablePdfText and must not force a
  // raster fallback on otherwise supported prose.
  if (
    /^[\t\n\r]$/.test(character) ||
    // eslint-disable-next-line no-control-regex -- classifies control characters as non-renderable on purpose
    /^[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]$/.test(character)
  ) {
    return true
  }
  return pdfWinAnsiByte(character) !== null
}

export interface PdfTextSegment {
  text: string
  left: number
  right: number
}

/**
 * The pieces of one text run that are written as separate PDF text objects.
 * A run is one object (one font, one `Tc`) spanning the full extent of the
 * run: glyph boxes of right-to-left text run against the logical order, and
 * splitting at script boundaries would only fragment Latin and CJK words in
 * the readers that extract the hidden layer.
 */
export function planPdfTextSegments(
  run: Pick<PdfTextRun, 'text' | 'left' | 'right'>
): PdfTextSegment[] {
  const text = searchablePdfText(run.text)
  if (!text.trim()) return []
  return [{ text, left: run.left, right: run.right }]
}

/**
 * Extra spacing (`Tc`, points) that fits a hidden text object to the width the
 * browser laid it out in. Latin gets a small cap so the layer stays faithful;
 * foreign-script text (including Chinese) has no usable font metrics here, so
 * it is fitted exactly and cannot overshoot the line.
 */
export function pdfCharSpace(
  targetWidth: number,
  naturalWidth: number,
  characterCount: number,
  fontSize: number,
  exactFit = false
): number {
  if (characterCount <= 1) return 0
  const raw = (targetWidth - naturalWidth) / (characterCount - 1)
  if (exactFit) return raw
  const maxCharSpace = characterCount <= 40 ? fontSize * 0.025 : fontSize * 0.06
  return Math.max(-maxCharSpace, Math.min(maxCharSpace, raw))
}

/**
 * Horizontal scaling (`Tz`, as a factor) that makes a text object end where the
 * browser's text ended. `Tc` is capped (see pdfCharSpace), so a base-14
 * Helvetica run that is wider than the browser's face (for example a bold
 * metadata label in a narrower serif) would otherwise run into the next run on
 * the line: the hidden layer then selects and extracts overlapping words.
 * Invisible text may be fitted freely; visible text only within a small band so
 * the glyphs stay recognisable.
 */
export function pdfHorizontalScale(
  targetWidth: number,
  naturalWidth: number,
  charSpace: number,
  characterCount: number,
  visible: boolean
): number {
  const fitted = naturalWidth + charSpace * Math.max(0, characterCount - 1)
  if (!(targetWidth > 0) || !(fitted > 0)) return 1
  const [low, high] = visible ? [0.85, 1.15] : [0.5, 2]
  const scale = Math.max(low, Math.min(high, targetWidth / fitted))
  return Math.abs(scale - 1) < 0.005 ? 1 : scale
}

function addPdfTextLayer(
  pdf: PdfDocument,
  font: PdfTextFont,
  runs: PdfTextRun[],
  pageStart: number,
  pageHeight: number,
  contentWidth: number,
  imageWidth: number,
  margin: number,
  renderingMode: 'invisible' | 'fill' = 'invisible'
): void {
  const mmPerCssPixel = imageWidth / contentWidth
  const pageEnd = pageStart + pageHeight
  if (typeof pdf.internal?.write !== 'function') return
  pdf.setTextColor(
    renderingMode === 'fill' ? 32 : 0,
    renderingMode === 'fill' ? 33 : 0,
    renderingMode === 'fill' ? 36 : 0
  )

  const writeSegment = (
    text: string,
    left: number,
    right: number,
    currentY: number,
    fontSize: number,
    searchOnly = false,
    fontWeight?: number,
    fontStyle?: string
  ): void => {
    const clean = searchablePdfText(text)
    if (!clean) return
    // Anything Helvetica cannot encode goes through the Identity-H font's code
    // table; it is never dropped.
    const containsForeign = [...clean].some(isForeignPdfCharacter)
    const asciiFont = !containsForeign
      ? pdf.internal?.getFont?.('helvetica', helveticaStyle(fontWeight, fontStyle))
      : null
    const asciiFontId = asciiFont?.id
    const useAsciiFont = Boolean(asciiFontId)
    const unicodeFontId = font.unicodeId
    const activeFontId = useAsciiFont ? asciiFontId : unicodeFontId
    if (!activeFontId) return
    const encodedText = useAsciiFont ? pdfAsciiHex(clean) : pdfTextHex(clean, font.codeOf)
    if (!encodedText) return
    const targetWidth = Math.max(0, right - left) * mmPerCssPixel * PDF_POINTS_PER_MM
    // Helvetica has proportional Latin metrics. The old fixed 500-unit
    // approximation made short labels such as `gpt-5-6-thinking` compensate
    // with very large PDF character spacing, which becomes especially ugly
    // when Preview is zoomed in. Ask jsPDF for the real Helvetica advance.
    const measuredAsciiWidth =
      useAsciiFont && typeof pdf.getStringUnitWidth === 'function'
        ? pdf.getStringUnitWidth(clean, { font: asciiFont, fontSize, charSpace: 0 }) * fontSize
        : 0
    const naturalWidth =
      measuredAsciiWidth > 0 ? measuredAsciiWidth : (pdfUnicodeWidthUnits(clean) / 1000) * fontSize
    const characterCount = Array.from(clean).length
    // Keep the text layer visually faithful without using `Tc` as a layout
    // engine. Short metadata needs almost no correction; a tight cap leaves
    // it compact while longer prose can absorb small browser/font differences.
    const charSpace = pdfCharSpace(
      targetWidth,
      naturalWidth,
      characterCount,
      fontSize,
      containsForeign
    )
    const x = margin + Math.max(0, left) * mmPerCssPixel
    const horizontalScale = pdfHorizontalScale(
      targetWidth,
      naturalWidth,
      charSpace,
      characterCount,
      renderingMode === 'fill' && !searchOnly
    )

    pdf.internal.write('BT')
    pdf.internal.write(`/${activeFontId} ${pdfNumber(fontSize)} Tf`)
    pdf.internal.write(
      `${pdf.internal.getCoordinateString(x)} ${pdf.internal.getVerticalCoordinateString(currentY)} Td`
    )
    pdf.internal.write(`${renderingMode === 'invisible' || searchOnly ? 3 : 0} Tr`)
    if (Math.abs(charSpace) >= 0.01) pdf.internal.write(`${pdfNumber(charSpace)} Tc`)
    if (horizontalScale !== 1) pdf.internal.write(`${pdfNumber(horizontalScale * 100)} Tz`)
    pdf.internal.write(`<${encodedText}> Tj`)
    if (horizontalScale !== 1) pdf.internal.write('100 Tz')
    if (Math.abs(charSpace) >= 0.01) pdf.internal.write('0 Tc')
    pdf.internal.write('ET')
  }

  for (const run of runs) {
    if (run.top < pageStart - 1 || run.top >= pageEnd - 0.5) continue
    const text = searchablePdfText(run.text)
    if (!text.trim()) continue
    // jsPDF font sizes are points. The DOM measurements are CSS pixels, so
    // convert px -> mm using the page scale and then mm -> points. The old
    // implementation omitted the second conversion and produced a tiny,
    // visibly different overlay at normal zoom.
    const fontSize = Math.max(4.5, Math.min(36, run.fontSize * mmPerCssPixel * PDF_POINTS_PER_MM))
    const currentY =
      margin + Math.min(pageHeight - 0.5, Math.max(1, run.bottom - pageStart)) * mmPerCssPixel
    // A range built from one DOM text node gives us exact per-character boxes.
    for (const segment of planPdfTextSegments(run)) {
      writeSegment(
        segment.text,
        segment.left,
        segment.right,
        currentY,
        fontSize,
        run.searchOnly,
        run.fontWeight,
        run.fontStyle
      )
    }
  }
}

function addPdfLinkLayer(
  pdf: PdfDocument,
  links: PdfLinkRegion[],
  pageStart: number,
  pageHeight: number,
  contentWidth: number,
  imageWidth: number,
  margin: number
): void {
  if (typeof pdf?.link !== 'function') return

  const mmPerCssPixel = imageWidth / contentWidth
  const pageEnd = pageStart + pageHeight
  for (const link of links) {
    if (link.bottom <= pageStart || link.top >= pageEnd) continue

    const top = Math.max(pageStart, link.top)
    const bottom = Math.min(pageEnd, link.bottom)
    const left = Math.max(0, link.left)
    const right = Math.min(contentWidth, link.right)
    const width = Math.max(0, right - left) * mmPerCssPixel
    const height = Math.max(0, bottom - top) * mmPerCssPixel
    if (width < 0.5 || height < 0.5) continue

    pdf.link(
      margin + left * mmPerCssPixel,
      margin + (top - pageStart) * mmPerCssPixel,
      width,
      height,
      { url: link.url }
    )
  }
}

function collectPdfImageBreakpoints(container: HTMLElement, maxPageHeightPx: number): number[] {
  const containerTop = container.getBoundingClientRect().top
  return Array.from(container.querySelectorAll<HTMLElement>('[data-pdf-block="image"], .image'))
    .flatMap(element => {
      const rect = element.getBoundingClientRect()
      const top = rect.top - containerTop
      const bottom = rect.bottom - containerTop
      // Only force a new page when the image still crosses the next nominal
      // page boundary after dynamic fitting. Images that fit stay with the
      // preceding text and avoid a large blank remainder.
      const nextPage = Math.ceil((top + 1) / maxPageHeightPx) * maxPageHeightPx
      return bottom > nextPage ? [top] : []
    })
    .filter(point => point > 0)
}

function measurePdfContentHeight(container: HTMLElement): number {
  const containerTop = container.getBoundingClientRect().top
  const root = container.querySelector<HTMLElement>('.conversation')
  const rootBottom = root
    ? root.getBoundingClientRect().bottom - containerTop
    : container.scrollHeight
  const measured = Math.max(container.scrollHeight || 0, rootBottom)
  if (measured <= 0) return 0
  // The temporary wrapper has 40px of padding for canvas safety. Measuring
  // the conversation root avoids turning that trailing padding into an empty
  // final PDF page.
  return Math.max(1, Math.min(container.scrollHeight || rootBottom, rootBottom + 2))
}

/** Split a rendered document into bounded page crops. */
export function calculatePdfPageSlices(
  contentHeight: number,
  maxPageHeight: number,
  breakpoints: number[] = [],
  preferredBreakpoints: number[] = []
): PdfPageSlice[] {
  if (contentHeight <= 0 || maxPageHeight <= 0) return []

  const points = [...new Set(breakpoints)]
    .filter(point => point > 0 && point < contentHeight)
    .sort((a, b) => a - b)
  const slices: PdfPageSlice[] = []
  let start = 0

  while (start < contentHeight) {
    const remaining = contentHeight - start
    // Layout rounding and the hidden render wrapper can leave a few pixels
    // after the final real block. Do not turn that tail into a blank PDF page.
    if (slices.length > 0 && remaining <= 8) {
      slices[slices.length - 1].height += remaining
      break
    }
    const target = Math.min(start + maxPageHeight, contentHeight)
    let end = target

    if (target < contentHeight) {
      const minimumUsefulPage = start + maxPageHeight * 0.6
      const preferred = [...new Set(preferredBreakpoints)]
        .filter(point => point >= start + maxPageHeight * 0.25 && point <= target)
        .sort((a, b) => a - b)
        .at(-1)
      const safeBreak = points.filter(point => point >= minimumUsefulPage && point <= target).at(-1)
      if (preferred !== undefined) end = preferred
      else if (safeBreak !== undefined) end = safeBreak
    }

    if (end <= start + 1) end = target
    slices.push({ start, height: end - start })
    start = end
  }

  return slices
}

/** Group adjacent pages into a canvas-safe render chunk. */
export function groupPdfPageSlices(
  slices: PdfPageSlice[],
  maxChunkHeight: number
): PdfRenderChunk[] {
  if (maxChunkHeight <= 0) return []

  const chunks: PdfRenderChunk[] = []
  let current: PdfRenderChunk | null = null

  for (const slice of slices) {
    const sliceEnd = slice.start + slice.height
    const nextHeight = current ? sliceEnd - current.start : slice.height

    if (current && nextHeight > maxChunkHeight) {
      chunks.push(current)
      current = null
    }

    if (!current) {
      current = { start: slice.start, height: slice.height, slices: [slice] }
    } else {
      current.slices.push(slice)
      current.height = sliceEnd - current.start
    }
  }

  if (current) chunks.push(current)
  return chunks
}

function isProbablyBlackCanvas(canvas: HTMLCanvasElement): boolean {
  if (typeof canvas.getContext !== 'function') return false
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context || canvas.width === 0 || canvas.height === 0) return false

  try {
    let black = 0
    let samples = 0
    for (let y = 0; y < canvas.height; y += Math.max(1, Math.floor(canvas.height / 12))) {
      for (let x = 0; x < canvas.width; x += Math.max(1, Math.floor(canvas.width / 12))) {
        const pixel = context.getImageData(x, y, 1, 1).data
        if (pixel[0] < 12 && pixel[1] < 12 && pixel[2] < 12) black++
        samples++
      }
    }
    return samples > 0 && black / samples > 0.9
  } catch {
    return false
  }
}

/**
 * Detect a crop that contains only a layout rule (or no ink at all). Browser
 * layout rounding can leave a final slice with a message border but no
 * readable content; emitting it creates a visually blank PDF page.
 */
function isLayoutOnlyCanvas(canvas: HTMLCanvasElement): boolean {
  if (typeof canvas.getContext !== 'function') return false
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context || canvas.width === 0 || canvas.height === 0) return false

  try {
    const stepX = Math.max(1, Math.floor(canvas.width / 160))
    const stepY = Math.max(1, Math.floor(canvas.height / 160))
    let minY = canvas.height
    let maxY = -1
    let hits = 0

    for (let y = 0; y < canvas.height; y += stepY) {
      for (let x = 0; x < canvas.width; x += stepX) {
        const pixel = context.getImageData(x, y, 1, 1).data
        if (pixel[3] > 0 && Math.min(pixel[0], pixel[1], pixel[2]) < 240) {
          minY = Math.min(minY, y)
          maxY = Math.max(maxY, y)
          hits++
        }
      }
    }

    if (hits === 0) return true
    return maxY - minY <= Math.max(10, Math.floor(canvas.height * 0.01))
  } catch {
    return false
  }
}

function collectPdfBreakpoints(container: HTMLElement): number[] {
  const containerTop = container.getBoundingClientRect().top
  const selectors = [
    'header',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    '.message',
    '.message-meta',
    '.role',
    '.timestamp',
    'p',
    'li',
    'pre',
    'blockquote',
    'table',
    'tr',
    '.artifacts',
    'footer'
  ].join(',')
  const points: number[] = []

  container.querySelectorAll<HTMLElement>(selectors).forEach(element => {
    const rect = element.getBoundingClientRect()
    points.push(rect.top - containerTop)
    // A conversation heading or timestamp is only a useful break point before it. A
    // break immediately after either one leaves an orphaned "Assistant"
    // heading at the bottom of a PDF page (a common failure in long chats).
    if (!/^H[1-6]$/.test(element.tagName) && !element.matches('.message-meta, .role, .timestamp')) {
      points.push(rect.bottom - containerTop)
    }
  })

  // Range rects expose the browser's actual line boxes. Their bottoms are safe
  // crop points even when one paragraph is taller than a whole PDF page.
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    const parent = node.parentElement
    if (!node.textContent?.trim() || !parent) continue
    if (parent.closest('style, script, h1, h2, h3, h4, h5, h6, .role')) continue

    const range = document.createRange()
    range.selectNodeContents(node)
    if (typeof range.getClientRects !== 'function') continue
    for (const rect of range.getClientRects()) {
      points.push(rect.bottom - containerTop + 1)
    }
  }

  return points
}

/**
 * Export conversation to PDF blob
 * @param conversation - The conversation
 * @param options - Export options
 * @returns PDF as Blob
 */
export async function exportToPdfBlob(
  conversation: Conversation,
  options: ExportOptions,
  signal?: AbortSignal
): Promise<Blob> {
  throwIfExportCancelled(signal)
  const html = conversationToHtml(conversation, options)

  // Create a hidden container for rendering
  const container = document.createElement('div')
  const pdfStyle: PdfStyle = options.pdfStyle === 'classic' ? 'classic' : 'minimal'
  // `innerHTML` parses this full document as a fragment, so the generated
  // <body> class does not become the render root's class. Mirror the document
  // root classes onto the actual element passed to html2canvas.
  container.classList.add('pdf-document-root', `pdf-style-${pdfStyle}`)
  container.style.cssText = `
    position: absolute;
    left: -9999px;
    top: 0;
    width: 800px;
    box-sizing: border-box;
    background: white;
    padding: 40px;
  `
  // The wrapper is our own trusted markup (layout plus the <style> block from
  // getPrintStyles), so it is inserted as-is. Sanitizing here instead would
  // strip that stylesheet and destroy the PDF layout — the untrusted parts are
  // already sanitized where they are produced, in formatHtmlContent() and
  // generateArtifactsHtml().
  container.innerHTML = html
  // The footer is useful in the HTML/preview representation, but in a
  // paginated PDF it can become the only element on a final otherwise blank
  // page. The document title/platform metadata already carries provenance.
  container.querySelector('footer')?.remove()
  applyAutoTextDirection(container)
  document.body.appendChild(container)
  let restoreVectorBase: (() => void) | null = null

  try {
    await waitForPdfImages(container, 6000, signal)
    throwIfExportCancelled(signal)

    // Reading layout after insertion resolves current styles without adding a
    // fixed delay to every item in a bulk export.
    const contentWidth = container.scrollWidth || 800

    // Render bounded chunks. A single canvas for a long Gemini conversation
    // exceeds browser limits, while one html2canvas call per page is too slow.
    const html2canvas = await loadHtml2Canvas()
    throwIfExportCancelled(signal)

    // Load jsPDF and create PDF
    const jsPDF = await loadJsPDF()
    throwIfExportCancelled(signal)
    const pageSize = options.format === 'pdf' ? 'A4' : 'Letter'
    const dimensions = getPageSizeDimensions(pageSize as 'A4' | 'Letter')

    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: pageSize.toLowerCase(),
      // The hidden-text font is written by a PDF event hook while the page
      // text itself is emitted as raw operators. Keep resources deterministic
      // so the hook cannot be skipped by jsPDF's used-font bookkeeping.
      putOnlyUsedFonts: false
    }) as unknown as PdfDocument

    const imgWidth = dimensions.width - 20 // 10mm margins
    const pageHeight = dimensions.height - 20 // 10mm top and bottom margins

    const maxPageHeightPx = (contentWidth * pageHeight) / imgWidth
    fitPdfImages(container, maxPageHeightPx)
    const contentHeight = measurePdfContentHeight(container)
    const textRuns = options.pdfTextLayer === false ? [] : collectPdfTextRuns(container)
    const linkRegions = collectPdfLinkRegions(container)
    const searchableFont = textRuns.length > 0 ? installSearchablePdfFont(pdf, textRuns) : null
    const useVectorText = Boolean(
      searchableFont && selectPdfVisualTextMode(container, textRuns) === 'vector'
    )
    restoreVectorBase = useVectorText ? hidePdfTextForVectorOverlay(container) : null
    const slices = calculatePdfPageSlices(
      contentHeight,
      maxPageHeightPx,
      collectPdfBreakpoints(container),
      collectPdfImageBreakpoints(container, maxPageHeightPx)
    )

    const bulkMode = options.pdfRenderMode === 'bulk'
    // 3x keeps the raster fallback and image-heavy pages readable when users
    // zoom in. Vector text is drawn separately below, so this is primarily an
    // image/background quality setting in the normal path.
    const renderScale = bulkMode ? 2 : 3
    const preferredPagesPerChunk = bulkMode ? 4 : 3
    const maxHeightByPixels = 8192 / renderScale
    const maxHeightByArea = 16_000_000 / (contentWidth * renderScale * renderScale)
    const maxChunkHeight = Math.max(
      maxPageHeightPx,
      Math.min(maxPageHeightPx * preferredPagesPerChunk, maxHeightByPixels, maxHeightByArea)
    )
    const chunks = groupPdfPageSlices(slices, maxChunkHeight)
    const jpegQuality = bulkMode ? 0.9 : 0.96
    let pageIndex = 0

    const renderChunk = (start: number, height: number) =>
      html2canvas(container, {
        scale: renderScale,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        imageTimeout: 6000,
        y: start,
        width: contentWidth,
        height: Math.ceil(height),
        windowWidth: contentWidth,
        windowHeight: Math.ceil(height)
      })

    const appendPage = (
      sourceCanvas: HTMLCanvasElement,
      sourceY: number,
      sourceHeight: number,
      pageStart: number,
      pageCssHeight: number
    ): boolean => {
      const pageCanvas = document.createElement('canvas')
      pageCanvas.width = sourceCanvas.width
      pageCanvas.height = sourceHeight
      const context = pageCanvas.getContext('2d')
      if (!context) throw new Error('Unable to create PDF page canvas')
      context.drawImage(
        sourceCanvas,
        0,
        sourceY,
        sourceCanvas.width,
        sourceHeight,
        0,
        0,
        sourceCanvas.width,
        sourceHeight
      )

      if (pageStart > 0 && isLayoutOnlyCanvas(pageCanvas) && !useVectorText) return false

      if (pageIndex > 0) pdf.addPage()
      pageIndex++
      const renderedHeight = Math.min((pageCanvas.height * imgWidth) / pageCanvas.width, pageHeight)
      pdf.addImage(
        pageCanvas.toDataURL('image/jpeg', jpegQuality),
        'JPEG',
        10,
        10,
        imgWidth,
        renderedHeight,
        undefined,
        'FAST'
      )
      if (searchableFont) {
        addPdfTextLayer(
          pdf,
          searchableFont,
          textRuns,
          pageStart,
          pageCssHeight,
          contentWidth,
          imgWidth,
          10,
          useVectorText ? 'fill' : 'invisible'
        )
      }
      addPdfLinkLayer(pdf, linkRegions, pageStart, pageCssHeight, contentWidth, imgWidth, 10)
      return true
    }

    for (const chunk of chunks) {
      // html2canvas does not expose an AbortSignal API. Check on both sides
      // of every bounded chunk so Stop takes effect before the next expensive
      // raster pass or PDF append.
      throwIfExportCancelled(signal)
      let chunkCanvas: HTMLCanvasElement | null = null
      try {
        chunkCanvas = await renderChunk(chunk.start, chunk.height)
        throwIfExportCancelled(signal)
        if (isProbablyBlackCanvas(chunkCanvas)) {
          throw new Error('PDF render chunk was black')
        }
      } catch (error) {
        // A failed or black multi-page chunk falls back to single-page renders
        // without restarting the whole bulk export.
        if (chunk.slices.length === 1) throw error
        for (const slice of chunk.slices) {
          throwIfExportCancelled(signal)
          const pageCanvas = await renderChunk(slice.start, slice.height)
          throwIfExportCancelled(signal)
          if (isProbablyBlackCanvas(pageCanvas)) {
            throw new Error('PDF page rendering failed', { cause: error })
          }
          appendPage(pageCanvas, 0, pageCanvas.height, slice.start, slice.height)
        }
        continue
      }

      const pixelsPerCssPixel = chunkCanvas.height / Math.ceil(chunk.height)
      for (const slice of chunk.slices) {
        throwIfExportCancelled(signal)
        const relativeStart = slice.start - chunk.start
        const sourceY = Math.round(relativeStart * pixelsPerCssPixel)
        const sourceEnd = Math.round((relativeStart + slice.height) * pixelsPerCssPixel)
        appendPage(
          chunkCanvas,
          sourceY,
          Math.max(1, sourceEnd - sourceY),
          slice.start,
          slice.height
        )
      }
    }

    // Return as Blob
    return pdf.output('blob')
  } finally {
    // Clean up temporary DOM elements
    restoreVectorBase?.()
    document.body.removeChild(container)
  }
}
