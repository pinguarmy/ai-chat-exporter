/** PDF layout, text layer and browser download; HTML generation is independent. */
import type { Conversation, ExportOptions, PdfStyle } from './types'
import { conversationToHtml, safePdfLinkTarget } from './export-html'
import { downloadAndWait, type DownloadWaitControl } from './download-completion'
import { throwIfExportCancelled } from './export-cancel'
export { platformDisplayName, formatModelDisplayName, getAssistantDisplayName, formatMessageTimestamp, conversationToHtml, generateArtifactsHtml, formatHtmlContent } from './export-html'

// Dynamic imports for jspdf and html2canvas
let jsPDFModule: any = null
let html2canvasModule: any = null

async function loadJsPDF() {
  if (!jsPDFModule) {
    jsPDFModule = await import('jspdf')
  }
  return jsPDFModule.jsPDF || jsPDFModule.default.jsPDF
}

async function loadHtml2Canvas() {
  if (!html2canvasModule) {
    html2canvasModule = await import('html2canvas')
  }
  return html2canvasModule.default || html2canvasModule
}

/**
 * Get PDF page dimensions based on page size
 * @param pageSize - Page size (A4 or Letter)
 * @returns Page dimensions in mm
 */
function getPageSizeDimensions(pageSize: 'A4' | 'Letter' = 'A4'): { width: number; height: number } {
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

    const rects = Array.from(anchor.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0)
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
async function waitForPdfImages(container: HTMLElement, timeoutMs = 6000, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return
  const images = Array.from(container.querySelectorAll<HTMLImageElement>('[data-pdf-block="image"] img, img[data-pdf-block="image"], .image img'))
  if (images.length === 0) return

  await Promise.all(images.map(image => {
    const removeIfUnavailable = () => {
      // Broken remote image URLs should not leave an empty framed box in the
      // PDF. Removing the figure also removes its pagination breakpoint.
      const renderedRect = image.getBoundingClientRect()
      const isTinyMarkdownAsset = image.classList.contains('markdown-image')
        && image.naturalWidth > 0
        && image.naturalHeight > 0
        && Math.max(image.naturalWidth, image.naturalHeight) < 120
        && Math.max(renderedRect.width, renderedRect.height) < 120
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
      let timeoutId: ReturnType<typeof setTimeout> | undefined
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
  }))
}

/** Size figures from the actual page budget instead of a fixed pixel cap. */
export function fitPdfImages(container: HTMLElement, maxPageHeightPx: number): number {
  // A media block should read as media, not as a tiny thumbnail in a mostly
  // empty page. Keep enough headroom for the heading/caption while allowing a
  // portrait screenshot to use most of a dedicated page when needed.
  const maxHeight = Math.max(220, Math.floor(maxPageHeightPx * 0.72))
  const images = Array.from(container.querySelectorAll<HTMLImageElement>('[data-pdf-block="image"] img, img[data-pdf-block="image"], .image img'))
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

function searchablePdfText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
    // STSong-Light is a BMP CJK font. Keeping surrogate pairs out of the
    // hidden layer avoids emitting invalid UCS-2 CIDs for emoji while leaving
    // the original emoji untouched in the raster visual layer.
    .replace(/[\uD800-\uDFFF]/g, '')
    .replace(/\u00A0/g, ' ')
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

function isIgnoredPdfTextElement(element: Element): boolean {
  return Boolean(element.closest('style, script, head, title, annotation, math, .latex, [aria-hidden="true"]'))
}

/**
 * Decide whether the browser text may safely be replaced by the visible PDF
 * vector layer. This must be stricter than "BMP only": Helvetica is written
 * as WinAnsi and the bundled CID path is deliberately limited to Chinese.
 * Any other script keeps the browser-rendered raster text visible.
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

function helveticaStyle(weight: number | undefined, style: string | undefined): 'normal' | 'bold' | 'italic' | 'bolditalic' {
  if (isPdfBold(weight) && isPdfItalic(style)) return 'bolditalic'
  if (isPdfBold(weight)) return 'bold'
  if (isPdfItalic(style)) return 'italic'
  return 'normal'
}

function latexSearchText(value: string): string {
  return value
    .replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g, '$1')
    .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1 / $2')
    .replace(/\\(?:left|right|,|;|!|\s+)/g, ' ')
    .replace(/\\[A-Za-z]+/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
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
    if (parent.closest('style, script, head, title, annotation, math, .latex, [aria-hidden="true"]')) continue

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

    for (let index = 0; index < value.length; index++) {
      const character = value[index]
      if (character === '\n' || character === '\r' || /[\uD800-\uDFFF]/.test(character)) continue
      try {
        range.setStart(node, index)
        range.setEnd(node, index + 1)
        const rect = Array.from(range.getClientRects()).find(item => item.width > 0 && item.height > 0)
        if (!rect) {
          // Browsers commonly omit collapsed whitespace from Range rects.
          // Hold it until the next visible glyph so copy/search preserves the
          // spaces that separate Latin identifiers and CJK text.
          if (character === ' ' || character === '\u00a0') pendingSpaces++
          continue
        }

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
          existing.glyphs?.push({
            text: character,
            left: rect.left - containerRect.left,
            right: rect.right - containerRect.left,
            top,
            bottom
          })
        } else {
          pendingSpaces = 0
          lineRuns.set(lineKey, {
            text: character,
            left: rect.left - containerRect.left,
            top,
            bottom,
            right: rect.right - containerRect.left,
            fontSize,
            fontWeight,
            fontStyle,
            glyphs: [{
              text: character,
              left: rect.left - containerRect.left,
              right: rect.right - containerRect.left,
              top,
              bottom
            }]
          })
        }
      } catch {
        // Detached or otherwise malformed text nodes are safe to skip.
      }
    }

    runs.push(...lineRuns.values())
  }

  // MathML token nodes are intentionally excluded from the visible vector
  // layer. Keep a plain source string at the same location so search/copy
  // still finds the equation while browser-rendered MathML remains the visual
  // source (and does not get split into overlapping glyph runs).
  container.querySelectorAll<HTMLElement>('.latex[data-latex-source]').forEach(element => {
    const source = searchablePdfText(latexSearchText(element.getAttribute('data-latex-source') || ''))
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

function pdfUnicodeCmap(font: any): string {
  const entries = Object.keys(font.metadata.toUnicode || {})
    .map(Number)
    .sort((a, b) => a - b)
    .map(code => {
      const target = Number(font.metadata.toUnicode[code])
      return `<${code.toString(16).padStart(4, '0')}><${target.toString(16).padStart(4, '0')}>`
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

/**
 * Install a tiny PDF-standard CJK font definition. STSong-Light is a
 * standard PDF CID font, so the extension does not need to ship a 5–20 MB
 * Chinese font file. The raster page remains the source for non-text visuals;
 * this font is used for the sharp visible/searchable text overlay.
 */
function installSearchablePdfFont(pdf: any, runs: PdfTextRun[]): { name: string; style: string; id: string } | null {
  if (typeof pdf?.addFont !== 'function' || !pdf.internal?.events?.getTopics) return null

  // jsPDF's bundled TTF listeners try to load a file whenever addFont is
  // called. Remove those per-document listeners before registering the
  // standard CID font; no later custom fonts are added to this document.
  const topics = pdf.internal.events.getTopics()
  for (const token of Object.keys(topics.addFont || {})) {
    pdf.internal.events.unsubscribe(token)
  }

  const name = '__ai_chat_exporter_cjk'
  // jsPDF 4.x treats the fourth argument as a font weight unless it is one
  // of its small set of legacy encodings. Pass the CJK encoding in the fifth
  // slot explicitly; UniGB-UCS2-H maps Unicode code points to the standard
  // STSong-Light CID font and is understood by Preview, Chrome and Poppler.
  pdf.addFont('STSong-Light', name, 'normal', undefined, 'UniGB-UCS2-H')
  const font = pdf.internal.getFont(name, 'normal')
  const widths: any = []
  widths.fof = 1000
  widths[0] = 1000
  // pdfEscape16 only needs to know whether a glyph has already been added;
  // using a constant-time lookup avoids scanning a huge array for every CJK
  // character in a long conversation.
  widths.indexOf = () => -1
  const codeMap: Record<string, number> = {}
  const toUnicode: Record<string, number> = {}
  for (const run of runs) {
    for (const character of run.text) {
      const code = character.charCodeAt(0)
      codeMap[code] = 1
      // Raw UniGB operators bypass jsPDF's pdfEscape16 helper, so populate
      // the ToUnicode map ourselves instead of relying on a later `text()`
      // call to discover the glyphs.
      toUnicode[code] = code
      // Match the browser's approximate advance widths so PDF extraction
      // does not invent a large gap between Latin words and CJK glyphs.
      if (code < 256) widths[code] = code === 32 ? 250 : 500
    }
  }
  font.metadata = {
    Unicode: { widths, kerning: { fof: 1000 } },
    cmap: { unicode: { codeMap } },
    glyIdsUsed: [0],
    toUnicode,
    characterToGlyph: (code: number) => code,
    widthOfGlyph: () => 1000
  }

  pdf.internal.events.subscribe('putFont', (args: any) => {
    if (args.font !== font) return

    const cmapObject = args.newObject()
    args.putStream({
      data: pdfUnicodeCmap(font),
      addLength1: true,
      objectId: cmapObject
    })
    args.out('endobj')

    const asciiWidths = Array.from({ length: 224 }, (_value, index) => index === 0 ? 250 : 500).join(' ')
    const descendant = args.newObject()
    args.out('<<')
    args.out('/Type /Font')
    args.out('/Subtype /CIDFontType0')
    args.out('/BaseFont /STSong-Light')
    args.out('/CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >>')
    args.out('/DW 1000')
    args.out(`/W [32 [${asciiWidths}] ]`)
    args.out('>>')
    args.out('endobj')

    font.objectNumber = args.newObject()
    args.out('<<')
    args.out('/Type /Font')
    args.out('/Subtype /Type0')
    args.out('/BaseFont /STSong-Light')
    args.out(`/ToUnicode ${cmapObject} 0 R`)
    args.out('/Encoding /UniGB-UCS2-H')
    args.out(`/DescendantFonts [${descendant} 0 R]`)
    args.out('>>')
    args.out('endobj')
    font.isAlreadyPutted = true
  })

  return { name, style: 'normal', id: font.id }
}

const PDF_POINTS_PER_MM = 72 / 25.4

function pdfTextHex(value: string): string {
  let hex = ''
  for (const character of value) {
    const codePoint = character.codePointAt(0) || 0
    if (codePoint > 0xffff) continue
    hex += codePoint.toString(16).padStart(4, '0')
  }
  return hex
}

const PDF_WIN_ANSI_BYTES: Record<number, number> = {
  0x2018: 0x91, 0x2019: 0x92, 0x201a: 0x82,
  0x201c: 0x93, 0x201d: 0x94, 0x201e: 0x84,
  0x2020: 0x86, 0x2021: 0x87, 0x2022: 0x95,
  0x2026: 0x85, 0x2030: 0x89, 0x2039: 0x8b,
  0x203a: 0x9b, 0x20ac: 0x80, 0x2122: 0x99,
  0x2013: 0x96, 0x2014: 0x97, 0x02c6: 0x88,
  0x02dc: 0x98, 0x0160: 0x8a, 0x0161: 0x9a,
  0x017d: 0x8e, 0x017e: 0x9e, 0x0192: 0x83
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

/** Widths used by the lightweight STSong / UniGB resource above. */
function pdfGlyphWidthUnits(value: string): number {
  let units = 0
  for (const character of value) {
    const codePoint = character.charCodeAt(0)
    if (codePoint > 0xffff) continue
    units += character === ' ' ? 250 : codePoint < 256 ? 500 : 1000
  }
  return units
}

function pdfNumber(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) < 0.0001) return '0'
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

function isCjkPdfCharacter(value: string): boolean {
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

function isSupportedVisiblePdfCharacter(character: string): boolean {
  // Layout/control characters have no glyph for the visible layer. Zero-width
  // formatting marks are stripped by searchablePdfText and must not force a
  // raster fallback on otherwise supported prose.
  if (/^[\t\n\r]$/.test(character) || /^[\u0000-\u001f\u007f\u200b-\u200d\ufeff]$/.test(character)) {
    return true
  }
  return pdfWinAnsiByte(character) !== null || isCjkPdfCharacter(character)
}

function addPdfTextLayer(
  pdf: any,
  font: { name: string; style: string; id: string },
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
  const fontEntry = pdf.internal?.getFont?.(font.name, font.style)
  const fontId = fontEntry?.id || font.id
  if (!fontId || typeof pdf.internal?.write !== 'function') return
  pdf.setTextColor(
    renderingMode === 'fill' ? 32 : 0,
    renderingMode === 'fill' ? 33 : 0,
    renderingMode === 'fill' ? 36 : 0
  )
  if (renderingMode === 'fill' && typeof pdf.setDrawColor === 'function') {
    pdf.setDrawColor(32, 33, 36)
  }

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
    const containsCjk = [...clean].some(isCjkPdfCharacter)
    const asciiStyle = helveticaStyle(fontWeight, fontStyle)
    const asciiFont = !containsCjk
      ? pdf.internal?.getFont?.('helvetica', asciiStyle)
      : null
    const useAsciiFont = Boolean(asciiFont?.id)
    const activeFontId = useAsciiFont ? asciiFont.id : fontId
    const encodedText = useAsciiFont ? pdfAsciiHex(clean) : pdfTextHex(clean)
    if (!encodedText) return
    const targetWidth = Math.max(0, right - left) * mmPerCssPixel * PDF_POINTS_PER_MM
    // Helvetica has proportional Latin metrics. The old fixed 500-unit
    // approximation made short labels such as `gpt-5-6-thinking` compensate
    // with very large PDF character spacing, which becomes especially ugly
    // when Preview is zoomed in. Ask jsPDF for the real Helvetica advance and
    // reserve the simple 1em CJK metric for the CJK resource.
    const measuredAsciiWidth = useAsciiFont && typeof pdf.getStringUnitWidth === 'function'
      ? pdf.getStringUnitWidth(clean, { font: asciiFont, fontSize, charSpace: 0 }) * fontSize
      : 0
    const naturalWidth = measuredAsciiWidth > 0
      ? measuredAsciiWidth
      : (pdfGlyphWidthUnits(clean) / 1000) * fontSize
    const characterCount = Array.from(clean).length
    // Keep the text layer visually faithful without using `Tc` as a layout
    // engine. Short metadata needs almost no correction; a tight cap leaves
    // it compact while longer prose can absorb small browser/font differences.
    const maxCharSpace = characterCount <= 40 ? fontSize * 0.025 : fontSize * 0.06
    const charSpace = characterCount > 1
      ? Math.max(-maxCharSpace, Math.min(maxCharSpace, (targetWidth - naturalWidth) / (characterCount - 1)))
      : 0
    const x = margin + Math.max(0, left) * mmPerCssPixel
    const fauxBoldCjk = renderingMode === 'fill' && !searchOnly && containsCjk && isPdfBold(fontWeight)

    pdf.internal.write('BT')
    pdf.internal.write(`/${activeFontId} ${pdfNumber(fontSize)} Tf`)
    pdf.internal.write(`${pdf.internal.getCoordinateString(x)} ${pdf.internal.getVerticalCoordinateString(currentY)} Td`)
    // The PDF-standard STSong resource has no bold face. Fill+stroke gives
    // CJK strong text a compact vector faux-bold while English uses genuine
    // Helvetica-Bold/BoldOblique. Both stay selectable and sharp at zoom.
    pdf.internal.write(`${renderingMode === 'invisible' || searchOnly ? 3 : fauxBoldCjk ? 2 : 0} Tr`)
    if (fauxBoldCjk) pdf.internal.write(`${pdfNumber(Math.max(0.14, fontSize * 0.022))} w`)
    if (Math.abs(charSpace) >= 0.01) pdf.internal.write(`${pdfNumber(charSpace)} Tc`)
    pdf.internal.write(`<${encodedText}> Tj`)
    if (Math.abs(charSpace) >= 0.01) pdf.internal.write('0 Tc')
    pdf.internal.write('ET')
    if (fauxBoldCjk) pdf.internal.write('0 w')
  }

  for (const run of runs) {
    if (run.top < pageStart - 1 || run.top >= pageEnd - 0.5) continue
    const text = searchablePdfText(run.text)
    if (!text.trim()) continue
    // jsPDF font sizes are points. The DOM measurements are CSS pixels, so
    // convert px -> mm using the page scale and then mm -> points. The old
    // implementation omitted the second conversion and produced a tiny,
    // visibly different overlay at normal zoom.
    const fontSize = Math.max(
      4.5,
      Math.min(36, run.fontSize * mmPerCssPixel * PDF_POINTS_PER_MM)
    )
    const currentY = margin + Math.min(pageHeight - 0.5, Math.max(1, run.bottom - pageStart)) * mmPerCssPixel
    // A range built from one DOM text node gives us exact per-character boxes.
    // Split CJK and Latin runs so identifiers and URLs keep a normal sans
    // face instead of inheriting the wide STSong CJK metrics.
    const glyphs = run.glyphs?.filter(glyph => searchablePdfText(glyph.text))
    if (!glyphs?.length) {
      writeSegment(text, run.left, run.right, currentY, fontSize, run.searchOnly, run.fontWeight, run.fontStyle)
      continue
    }

    let segmentText = ''
    let segmentLeft = glyphs[0].left
    let segmentRight = glyphs[0].right
    let segmentCjk = isCjkPdfCharacter(glyphs[0].text)
    for (const glyph of glyphs) {
      const glyphCjk = isCjkPdfCharacter(glyph.text)
      if (segmentText && glyphCjk !== segmentCjk) {
        writeSegment(segmentText, segmentLeft, segmentRight, currentY, fontSize, run.searchOnly, run.fontWeight, run.fontStyle)
        segmentText = ''
        segmentLeft = glyph.left
        segmentCjk = glyphCjk
      }
      if (!segmentText) segmentLeft = glyph.left
      segmentText += glyph.text
      segmentRight = glyph.right
    }
    if (segmentText) writeSegment(segmentText, segmentLeft, segmentRight, currentY, fontSize, run.searchOnly, run.fontWeight, run.fontStyle)
  }
}

function addPdfLinkLayer(
  pdf: any,
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
      const safeBreak = points
        .filter(point => point >= minimumUsefulPage && point <= target)
        .at(-1)
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
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    '.message', '.message-meta', '.role', '.timestamp',
    'p', 'li', 'pre', 'blockquote', 'table', 'tr',
    '.artifacts', 'footer'
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
      format: pageSize.toLowerCase() as any,
      // The custom STSong resource is written by a PDF event hook while the
      // page text itself is emitted as raw UniGB operators. Keep resources
      // deterministic so the hook cannot be skipped by jsPDF's used-font
      // bookkeeping.
      putOnlyUsedFonts: false
    })
    
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
      Math.min(
        maxPageHeightPx * preferredPagesPerChunk,
        maxHeightByPixels,
        maxHeightByArea
      )
    )
    const chunks = groupPdfPageSlices(slices, maxChunkHeight)
    const jpegQuality = bulkMode ? 0.9 : 0.96
    let pageIndex = 0

    const renderChunk = (start: number, height: number) => html2canvas(container, {
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
        0, sourceY, sourceCanvas.width, sourceHeight,
        0, 0, sourceCanvas.width, sourceHeight
      )

      if (pageStart > 0 && isLayoutOnlyCanvas(pageCanvas) && !useVectorText) return false

      if (pageIndex > 0) pdf.addPage()
      pageIndex++
      const renderedHeight = Math.min(
        (pageCanvas.height * imgWidth) / pageCanvas.width,
        pageHeight
      )
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
      addPdfLinkLayer(
        pdf,
        linkRegions,
        pageStart,
        pageCssHeight,
        contentWidth,
        imgWidth,
        10
      )
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
            throw new Error('PDF page rendering failed')
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
        const sourceEnd = Math.round(
          (relativeStart + slice.height) * pixelsPerCssPixel
        )
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

/**
 * Export conversation to PDF and auto-download
 * @param conversation - The conversation
 * @param options - Export options
 * @param filename - Filename for the downloaded file
 */
export async function exportToPdf(
  conversation: Conversation,
  options: ExportOptions,
  filename: string,
  downloadControl: DownloadWaitControl & { saveAs?: boolean } = {}
): Promise<void> {
  throwIfExportCancelled(downloadControl.signal)
  // Ensure filename has .pdf extension
  if (!filename.endsWith('.pdf')) {
    filename += '.pdf'
  }
  
  // Generate PDF blob
  const blob = await exportToPdfBlob(conversation, options, downloadControl.signal)
  throwIfExportCancelled(downloadControl.signal)
  
  // Create object URL
  const url = URL.createObjectURL(blob)
  
  try {
    // Auto-download using chrome.downloads API
    await downloadAndWait({
      url,
      filename,
      saveAs: downloadControl.saveAs ?? false
    }, 60_000, chrome.downloads, downloadControl)
  } finally {
    // Clean up object URL
    URL.revokeObjectURL(url)
  }
}
