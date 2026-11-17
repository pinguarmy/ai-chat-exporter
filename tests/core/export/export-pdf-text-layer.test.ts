/**
 * PDF text layer, character classification and rendering pipeline.
 *
 * Runs the real jsPDF with jsdom (layout, canvas and html2canvas are stubbed)
 * and decodes the resulting PDF bytes, so these tests assert on what the
 * exporter actually writes: font resources, text render modes, hex strings and
 * ToUnicode maps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyAutoTextDirection,
  buildPdfCodeTable,
  calculatePdfPageSlices,
  collectPdfLinkRegions,
  collectPdfTextRuns,
  conversationToHtml,
  exportToPdfBlob,
  fitPdfImages,
  groupPdfPageSlices,
  isCjkPdfCharacter,
  isForeignPdfCharacter,
  latexSearchText,
  isSupportedVisiblePdfCharacter,
  pdfCharSpace,
  pdfHorizontalScale,
  pdfTextHex,
  pdfUnicodeAdvanceUnits,
  pdfUnicodeWidthArray,
  pdfUnicodeWidthUnits,
  planPdfTextSegments,
  reorderPdfRunVisually,
  searchablePdfText,
  selectPdfVisualTextMode,
  type PdfTextRun
} from '../../../src/core/export-pdf'
import { extractPdfTextObjects } from '../../../scripts/lib/pdf-text-layer.mjs'
import type { Conversation, ExportOptions } from '../../../src/core/types'
import {
  multilingualConversation,
  multilingualEntries,
  type MultilingualEntry
} from '../../helpers/multilingual-corpus'
import '../../helpers/i18n-catalogs'

/** 4x4 white JPEG; jsPDF only needs a decodable header. */
const TINY_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAEAAQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD0CiiigD//2Q=='

vi.mock('html2canvas', () => ({
  default: vi.fn(async () => fakeCanvas(2400, 1800))
}))

function fakeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

interface Box {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
  x: number
  y: number
  toJSON: () => object
}
const box = (left: number, top: number, width: number, height: number): Box => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
  x: left,
  y: top,
  toJSON: () => ({})
})

const RTL = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/

/**
 * jsdom has no layout. Give every text node its own line and every character a
 * 9px box (mirrored for right-to-left text), the page a fixed size, and
 * anchors a link rectangle.
 */
function installLayout() {
  const lineOf = new WeakMap<Node, number>()
  let nextLine = 0
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => box(0, 0, 800, 4000) as DOMRect
  )
  vi.spyOn(HTMLAnchorElement.prototype, 'getClientRects').mockImplementation(
    () => [box(40, 30, 120, 12)] as unknown as DOMRectList
  )
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get: () => 800
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => 4000
  })
  Range.prototype.getClientRects = function (this: Range) {
    const node = this.startContainer
    if (!lineOf.has(node)) lineOf.set(node, nextLine++)
    const index = this.startOffset
    const data = node.textContent ?? ''
    const left = RTL.test(data) ? 700 - index * 9 : 40 + index * 9
    return [box(left, 20 + (lineOf.get(node) ?? 0) * 24, 9, 16)] as unknown as DOMRectList
  }
  Range.prototype.selectNodeContents = function () {}
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        drawImage: () => undefined,
        getImageData: () => ({ data: [255, 255, 255, 255] })
      }) as unknown as CanvasRenderingContext2D
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => TINY_JPEG)
}

const baseOptions: ExportOptions = {
  format: 'pdf',
  includeMetadata: true,
  includeCodeBlocks: true,
  includeImages: true,
  pdfTextLayer: true,
  pdfStyle: 'minimal'
}

async function exportPdf(conversation: Conversation, options: Partial<ExportOptions> = {}) {
  const blob = await exportToPdfBlob(conversation, { ...baseOptions, ...options })
  // jsdom's Blob has no arrayBuffer().
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
  const raw = Buffer.from(bytes).toString('latin1')
  return {
    raw,
    objects: extractPdfTextObjects(bytes),
    text: extractPdfTextObjects(bytes)
      .map(o => o.text)
      .join('\n')
  }
}

function simpleConversation(content: string, title = 'Title'): Conversation {
  return {
    id: 'c1',
    title,
    url: 'https://example.invalid/c/1',
    platform: 'chatgpt',
    messages: [{ id: 'm1', role: 'assistant', content, timestamp: Date.UTC(2026, 0, 2) }]
  }
}

describe('PDF character classification', () => {
  it('separates what the PDF can draw from what stays in the browser raster', () => {
    for (const ok of ['a', 'Z', '9', 'é', '—', '“', '€', '\n', '\u200D']) {
      expect(isSupportedVisiblePdfCharacter(ok), ok).toBe(true)
    }
    // Chinese and full-width characters are raster too: the viewer's CJK
    // substitute font cannot be trusted to exist or to match browser metrics.
    for (const raster of [
      '中',
      '。',
      '，',
      'Ａ',
      'ひ',
      'カ',
      '한',
      'ع',
      'ש',
      'क',
      'ก',
      'я',
      'α',
      'ế',
      '😀',
      'ł',
      '∀'
    ]) {
      expect(isSupportedVisiblePdfCharacter(raster), raster).toBe(false)
    }
  })

  it('treats ideographs and CJK punctuation as CJK, but not kana or Hangul', () => {
    for (const cjk of ['中', '漢', '。', '、', '（', '～', '￥', '︰']) {
      expect(isCjkPdfCharacter(cjk), cjk).toBe(true)
    }
    for (const other of ['a', 'あ', 'ア', '한', 'ع']) {
      expect(isCjkPdfCharacter(other), other).toBe(false)
    }
  })

  it('calls a character foreign when Helvetica cannot encode it', () => {
    expect(isForeignPdfCharacter('я')).toBe(true)
    expect(isForeignPdfCharacter('😀')).toBe(true)
    expect(isForeignPdfCharacter('é')).toBe(false)
    // Chinese goes through the Identity-H hidden-text font like every other script.
    expect(isForeignPdfCharacter('中')).toBe(true)
    expect(isForeignPdfCharacter('，')).toBe(true)
    expect(isForeignPdfCharacter('Ａ')).toBe(true)
    // Zero-width spaces carry no text, so they never force the CID path.
    expect(isForeignPdfCharacter('\u200B')).toBe(false)
  })

  it('normalizes text for the hidden layer without losing spelling', () => {
    expect(searchablePdfText('a\u0001b\u007fc')).toBe('abc')
    expect(searchablePdfText('a\u200Bb\uFEFFc\u202Ed\u200Fe')).toBe('abcde')
    expect(searchablePdfText('می\u200Cخواهم')).toBe('می\u200Cخواهم')
    expect(searchablePdfText('👩\u200D💻')).toBe('👩\u200D💻')
    expect(searchablePdfText('x\ud83dy\ude00z')).toBe('xyz')
    expect(searchablePdfText('a b')).toBe('a b')
  })
})

describe('math in the PDF page', () => {
  it('keeps Greek letters, operators and nested fractions in the hidden-layer source', () => {
    expect(latexSearchText(String.raw`\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}`)).toBe(
      '∫_0^∞ e^-x^2 dx = √π / 2'
    )
    expect(
      latexSearchText(String.raw`\text{citation share}=\frac{\text{domain}}{\text{all}}`)
    ).toBe('citation share=domain / all')
    expect(latexSearchText(String.raw`\alpha \leq \beta \Rightarrow \foo_{1}`)).toBe(
      'α ≤ β ⇒ foo_1'
    )
    expect(latexSearchText(String.raw`\left( \sum_{i=1}^n i \right)`)).toBe('( ∑_i=1^n i )')
  })

  it('renders inline formulas as block MathML so the rasterizer paints them', () => {
    const html = conversationToHtml(
      simpleConversation('Euler: $e^{i\\pi}+1=0$ and $$x^2$$'),
      baseOptions
    )
    expect(html.match(/<math[^>]*display="block"/g)).toHaveLength(2)
    expect(html).not.toMatch(/<math(?![^>]*display="block")/)
    expect(html).toContain('data-latex-source="e^{i\\pi}+1=0"')
  })
})

describe('Identity-H hidden-text font metrics', () => {
  it('gives scripts realistic advances so fitting a line needs only a small Tc', () => {
    expect(pdfUnicodeAdvanceUnits(' ')).toBe(250)
    expect(pdfUnicodeAdvanceUnits('a')).toBe(500)
    expect(pdfUnicodeAdvanceUnits('я')).toBe(550)
    expect(pdfUnicodeAdvanceUnits('ก')).toBe(550)
    expect(pdfUnicodeAdvanceUnits('한')).toBe(1000)
    expect(pdfUnicodeAdvanceUnits('か')).toBe(1000)
    expect(pdfUnicodeAdvanceUnits('中')).toBe(1000)
    expect(pdfUnicodeAdvanceUnits('😀')).toBe(1000)
    for (const zeroWidth of ['\u0301', '\u0e48', '\u094d', '\u200d', '\u200c', '\ufe0f']) {
      expect(pdfUnicodeAdvanceUnits(zeroWidth), zeroWidth).toBe(0)
    }
    expect(pdfUnicodeWidthUnits('ab я')).toBe(500 + 500 + 250 + 550)
  })

  it('emits one /W run per block of consecutive codes', () => {
    const table = buildPdfCodeTable(['abc', 'я', '😀'])
    const array = pdfUnicodeWidthArray(table.toUnicode)
    expect(array).toContain('97 [500 500 500]')
    expect(array).toContain('1103 [550]')
    expect(array).toMatch(/57344 \[1000\]$/)
  })
})

describe('PDF text-layer code table', () => {
  it('keeps BMP characters as their own code and maps emoji to free private-use codes', () => {
    const table = buildPdfCodeTable(['a中я', '😀🇯🇵'])
    expect(table.codeOf('a')).toBe(0x61)
    expect(table.codeOf('中')).toBe(0x4e2d)
    expect(table.codeOf('')).toBe(0xe000)
    const codes = ['😀', '🇯', '🇵'].map(table.codeOf)
    expect(new Set(codes).size).toBe(3)
    for (const code of codes) {
      expect(code).toBeGreaterThanOrEqual(0xe001) // skips the private-use code the text really uses
      expect(code).toBeLessThanOrEqual(0xf8ff)
    }
    expect(table.toUnicode[codes[0]]).toBe(0x1f600)
    expect(table.toUnicode[0x4e2d]).toBe(0x4e2d)
    expect(Object.keys(table.toUnicode).length).toBe(7)
  })

  it('never drops an overflow character silently', () => {
    const astral = Array.from({ length: 6500 }, (_, i) => String.fromCodePoint(0x20000 + i))
    const table = buildPdfCodeTable([astral.join('')])
    const overflow = astral.map(table.codeOf).filter(code => code === 0xfffd)
    expect(overflow.length).toBeGreaterThan(0)
    expect(table.toUnicode[0xfffd]).toBe(0xfffd)
    expect(table.codeOf('\ud800')).toBe(0xd800)
  })

  it('encodes every character, including astral ones, as a four-digit code', () => {
    const table = buildPdfCodeTable(['Aя😀'])
    expect(pdfTextHex('Aя😀', table.codeOf)).toBe(
      '0041' + '044f' + table.codeOf('😀').toString(16).padStart(4, '0')
    )
  })
})

describe('PDF text segmentation and spacing', () => {
  const glyph = (text: string, left: number, right = left + 9) => ({
    text,
    left,
    right,
    top: 0,
    bottom: 16
  })
  const run = (glyphs: ReturnType<typeof glyph>[]): PdfTextRun => ({
    text: glyphs.map(item => item.text).join(''),
    left: glyphs[0].left,
    right: glyphs.at(-1)!.right,
    top: 0,
    bottom: 16,
    fontSize: 16,
    glyphs
  })

  it('keeps a whole line, Latin and CJK together, in one text object', () => {
    // Splitting at script boundaries used to leave a gap around every Chinese
    // identifier in a code line; one object spans the full extent of the run.
    const segments = planPdfTextSegments(
      run([glyph('a', 0), glyph('b', 9), glyph('中', 18), glyph('文', 27), glyph('c', 36)])
    )
    expect(segments).toEqual([{ text: 'ab中文c', left: 0, right: 45 }])
    expect(
      planPdfTextSegments(run([glyph('a', 0), glyph('я', 9), glyph('中', 18), glyph('b', 27)]))
    ).toEqual([{ text: 'aя中b', left: 0, right: 36 }])
  })

  it('returns one segment for runs without glyph boxes and none for blanks', () => {
    expect(planPdfTextSegments({ text: 'x²', left: 1, right: 20 })).toEqual([
      { text: 'x²', left: 1, right: 20 }
    ])
    expect(planPdfTextSegments({ text: ' \u200B ', left: 1, right: 2 })).toEqual([])
  })

  it('fits foreign text exactly and caps everything else', () => {
    expect(pdfCharSpace(100, 80, 1, 12)).toBe(0)
    expect(pdfCharSpace(100, 80, 11, 12)).toBeCloseTo(0.3) // capped at 0.025em for short text
    expect(pdfCharSpace(100, 80, 11, 12, true)).toBe(2)
    expect(pdfCharSpace(10, 80, 11, 12)).toBeCloseTo(-0.3)
    expect(pdfCharSpace(100, 80, 101, 12)).toBeCloseTo(0.2) // 20 / 100, within the 0.06em cap
    expect(pdfCharSpace(500, 80, 101, 12)).toBeCloseTo(0.72)
  })

  it('squeezes a too-wide label to the browser width so it cannot run into its value', () => {
    // A bold Helvetica label (17 characters, 7 pt) that is 8 pt wider than the
    // browser's serif: Tc is capped at 0.025em, Tz closes the remaining gap.
    const target = 60
    const natural = 68
    const charSpace = pdfCharSpace(target, natural, 17, 7)
    expect(charSpace).toBeCloseTo(-0.175)
    const scale = pdfHorizontalScale(target, natural, charSpace, 17, false)
    expect((natural + charSpace * 16) * scale).toBeCloseTo(target)
    // Visible text is only nudged within a small band; invisible text is fitted freely.
    expect(pdfHorizontalScale(target, 100, 0, 17, true)).toBe(0.85)
    expect(pdfHorizontalScale(target, 100, 0, 17, false)).toBe(0.6)
    expect(pdfHorizontalScale(100, 60, 0, 17, true)).toBe(1.15)
    // Already close, exactly fitted or unmeasurable text is left alone.
    expect(pdfHorizontalScale(100, 99.8, 0, 5, true)).toBe(1)
    expect(pdfHorizontalScale(0, 50, 0, 5, false)).toBe(1)
    expect(pdfHorizontalScale(50, 0, 0, 5, false)).toBe(1)
  })
})

describe('right-to-left runs are stored in visual order', () => {
  const glyph = (text: string, left: number) => ({
    text,
    left,
    right: left + 9,
    top: 0,
    bottom: 16
  })

  it('re-sequences a right-to-left line by measured position', () => {
    const logical = ['س', 'ل', 'ا', 'م'].map((c, i) => glyph(c, 100 - i * 9))
    const run: PdfTextRun = {
      text: 'سلام',
      left: 64,
      right: 109,
      top: 0,
      bottom: 16,
      fontSize: 16,
      glyphs: logical
    }
    expect(reorderPdfRunVisually(run).text).toBe('مالس')
  })

  it('keeps Latin and digit runs intact inside a right-to-left line', () => {
    // Visual order, left to right: "A1" then the Hebrew word (logical: word, "A1").
    const glyphs = [glyph('ש', 100), glyph('ל', 91), glyph('A', 40), glyph('1', 49)]
    const run: PdfTextRun = {
      text: 'שלA1',
      left: 40,
      right: 109,
      top: 0,
      bottom: 16,
      fontSize: 16,
      glyphs
    }
    expect(reorderPdfRunVisually(run).text).toBe('A1לש')
  })

  it('stores a base+mark cluster mark-first so readers read it back base-first', () => {
    const glyphs = [glyph('ב', 100), glyph('ְ', 100), glyph('ר', 91)]
    const run: PdfTextRun = {
      text: 'בְר',
      left: 91,
      right: 109,
      top: 0,
      bottom: 16,
      fontSize: 16,
      glyphs
    }
    expect(reorderPdfRunVisually(run).text).toBe('ר' + 'ְב')
  })

  it('does not touch left-to-right runs or runs without glyph boxes', () => {
    const ltr: PdfTextRun = {
      text: 'ab',
      left: 0,
      right: 18,
      top: 0,
      bottom: 16,
      fontSize: 16,
      glyphs: [glyph('a', 0), glyph('b', 9)]
    }
    expect(reorderPdfRunVisually(ltr)).toBe(ltr)
    const bare: PdfTextRun = { text: 'שלום', left: 0, right: 4, top: 0, bottom: 1, fontSize: 12 }
    expect(reorderPdfRunVisually(bare)).toBe(bare)
  })
})

describe('layout helpers', () => {
  beforeEach(() => installLayout())
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('gives each text block its own direction but leaves code alone', () => {
    const container = document.createElement('div')
    container.innerHTML =
      '<h1>t</h1><p>a</p><ul><li>x</li></ul><pre><code>c</code></pre><p dir="ltr">k</p><div class="latex"><p>m</p></div><table><tr><th>h</th><td>d</td></tr></table><blockquote>q</blockquote>'
    const count = applyAutoTextDirection(container)
    expect(container.querySelector('p')?.getAttribute('dir')).toBe('auto')
    expect(container.querySelector('li')?.getAttribute('dir')).toBe('auto')
    expect(container.querySelector('th')?.getAttribute('dir')).toBe('auto')
    expect(container.querySelector('p[dir="ltr"]')).not.toBeNull()
    expect(container.querySelector('.latex p')?.hasAttribute('dir')).toBe(false)
    expect(container.querySelector('pre')?.hasAttribute('dir')).toBe(false)
    expect(count).toBe(7)
  })

  it('collects link rectangles only for safe URLs', () => {
    const container = document.createElement('div')
    container.innerHTML =
      '<a href="https://example.com/a">ok</a><a href="javascript:alert(1)">bad</a><a href="/x">rel</a>'
    document.body.appendChild(container)
    const regions = collectPdfLinkRegions(container)
    expect(regions.map(item => item.url)).toEqual(['https://example.com/a'])
    expect(regions[0]).toMatchObject({ left: 40, top: 30, right: 160, bottom: 42 })
  })

  it('caps image height by the page and fits tall images into the remaining space', () => {
    const container = document.createElement('div')
    container.innerHTML = '<figure class="image" data-pdf-block="image"><img src="x.png"></figure>'
    document.body.appendChild(container)
    const image = container.querySelector('img')!
    image.getBoundingClientRect = () => box(0, 700, 300, 900) as DOMRect
    const max = fitPdfImages(container, 1000)
    expect(max).toBe(720)
    expect(image.style.maxHeight).toBe('268px')
    expect(fitPdfImages(container, 0)).toBe(220)
  })

  it('measures runs per line, keeps spaces, and merges adjacent inline nodes', () => {
    const container = document.createElement('div')
    container.innerHTML = '<p>Hello <strong>wörld</strong> 😀 ok</p><p>skip</p>'
    container.querySelectorAll('p')[1].setAttribute('aria-hidden', 'true')
    document.body.appendChild(container)
    const runs = collectPdfTextRuns(container)
    const texts = runs.map(item => item.text)
    expect(texts.join('|')).toContain('Hello')
    expect(texts.join('|')).toContain('😀')
    expect(texts.join('|')).not.toContain('skip')
    expect(runs.every(item => item.fontSize === 16)).toBe(true)
  })

  it('keeps zero-width joiners attached to the preceding glyph', () => {
    const container = document.createElement('div')
    container.textContent = 'a\u200Dbc'
    document.body.appendChild(container)
    const original = Range.prototype.getClientRects
    Range.prototype.getClientRects = function (this: Range) {
      const char = (this.startContainer.textContent ?? '')[this.startOffset]
      return (char === '\u200D' ? [] : original.call(this)) as unknown as DOMRectList
    }
    const [run] = collectPdfTextRuns(container)
    expect(run.text).toBe('a\u200Dbc')
    expect(run.glyphs?.map(item => item.text)).toEqual(['a\u200D', 'b', 'c'])
  })

  it('chooses the raster layer for any text the PDF fonts cannot draw', () => {
    const container = document.createElement('div')
    container.innerHTML = '<p>Plain English é</p><p style="display:none">한글</p>'
    expect(selectPdfVisualTextMode(container, [{ text: 'x' } as PdfTextRun])).toBe('vector')
    container.innerHTML = '<p>Plain</p><p>ひらがな</p>'
    expect(selectPdfVisualTextMode(container, [{ text: 'x' } as PdfTextRun])).toBe('raster')
    container.innerHTML = '<p>Plain</p><p>中文</p>'
    expect(selectPdfVisualTextMode(container, [{ text: 'x' } as PdfTextRun])).toBe('raster')
    expect(selectPdfVisualTextMode(container, [])).toBe('raster')
  })

  it('slices tall documents on safe breaks and groups slices into render chunks', () => {
    const slices = calculatePdfPageSlices(3000, 1000, [980, 1990], [])
    expect(slices.reduce((sum, slice) => sum + slice.height, 0)).toBe(3000)
    expect(slices.every(slice => slice.height <= 1000)).toBe(true)
    const chunks = groupPdfPageSlices(slices, 2100)
    expect(chunks.every(chunk => chunk.height <= 2100)).toBe(true)
    expect(chunks.flatMap(chunk => chunk.slices)).toEqual(slices)
    expect(calculatePdfPageSlices(0, 1000)).toEqual([])
    expect(groupPdfPageSlices(slices, 0)).toEqual([])
  })
})

describe('end-to-end PDF text layer (real jsPDF)', () => {
  beforeEach(() => installLayout())
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('draws Latin text as vector text without any CJK font resource', async () => {
    const { objects, text, raw } = await exportPdf(
      simpleConversation('Hello wörld “quotes”', 'Title')
    )
    expect(objects.some(item => item.mode === 0)).toBe(true)
    expect(text).toContain('Hello')
    expect(text).toContain('Title')
    expect(raw).not.toContain('/Encoding /Identity-H')
    expect(raw).not.toContain('STSong')
    expect(raw.startsWith('%PDF-')).toBe(true)
  })

  it('keeps Chinese in the browser raster and only in the Identity-H hidden layer', async () => {
    const { objects, text, raw } = await exportPdf(
      simpleConversation('你好，世界！Hello wörld “quotes” ＡＢＣ１２３', '标题')
    )
    // Nothing is drawn by the PDF itself: Latin is not drawn half-and-half either.
    expect(objects.length).toBeGreaterThan(0)
    expect(objects.every(item => item.mode === 3)).toBe(true)
    // A self-contained font: no non-embedded Adobe CJK resource or predefined CMap
    // that a viewer without poppler-data or a CJK font would draw as blanks.
    expect(raw).not.toContain('STSong')
    expect(raw).not.toContain('UniGB')
    expect(raw).not.toMatch(/\/Registry \(Adobe\) \/Ordering \(GB1\)/)
    expect(raw).toContain('/Encoding /Identity-H')
    expect(raw).toContain('/ToUnicode')
    expect(text).toContain('你好，世界！')
    expect(text).toContain('Hello')
    expect(text).toContain('ＡＢＣ１２３')
    expect(text).toContain('标题')
  })

  it('keeps the browser raster visible for foreign scripts and loses nothing from the hidden layer', async () => {
    const content = [
      'Привет мир',
      'ελληνικά',
      '한국어',
      'ひらがな',
      'שלום',
      'مرحبا',
      'हिन्दी',
      'ไทย',
      'Việt 😀 👨\u200D👩\u200D👧\u200D👦'
    ].join('\n\n')
    const { objects, text } = await exportPdf(simpleConversation(content))
    expect(objects.every(item => item.mode === 3)).toBe(true)
    for (const piece of [
      'Привет',
      'ελληνικά',
      '한국어',
      'ひらがな',
      'हिन्दी',
      'ไทย',
      'Việt',
      '😀'
    ]) {
      expect(text, piece).toContain(piece)
    }
    expect(text).toContain('👨\u200D👩\u200D👧\u200D👦')
    // Right-to-left words are stored in visual order.
    expect(text).toContain('םולש')
    expect(text).toContain('ابحرم')
    expect(text).not.toContain('�')
  })

  it('writes a ToUnicode CMap that maps private-use codes back to astral characters', async () => {
    const { raw } = await exportPdf(simpleConversation('rocket 🚀'))
    const bfchar = raw.match(/<(e[0-9a-f]{3})><d83ddc80|<(e[0-9a-f]{3})><d83d[0-9a-f]{4}>/)
    expect(bfchar).not.toBeNull()
    expect(raw).toContain('beginbfchar')
    expect(raw).toContain('/ToUnicode')
  })

  it('adds the Identity-H hidden-text font only when the document needs it', async () => {
    const plain = await exportPdf(simpleConversation('Hello wörld'))
    expect(plain.raw).not.toContain('/Encoding /Identity-H')
    const foreign = await exportPdf(simpleConversation('Привет 你好'))
    expect(foreign.raw).toContain('/Encoding /Identity-H')
    expect(foreign.raw).toContain('/CIDFontType2')
    expect(foreign.raw).toMatch(/\/FontDescriptor \d+ 0 R/)
    expect(foreign.objects.filter(item => item.cid).length).toBeGreaterThan(0)
  })

  it('omits the text layer entirely when disabled', async () => {
    const { objects, raw } = await exportPdf(simpleConversation('Hello'), { pdfTextLayer: false })
    expect(objects).toEqual([])
    expect(raw).not.toContain('/Encoding /Identity-H')
  })

  it('adds link annotations for safe links', async () => {
    const { raw } = await exportPdf(simpleConversation('See [docs](https://example.com/docs) now.'))
    expect(raw).toContain('/URI (https://example.com/docs)')
  })

  it.each(multilingualEntries.map(entry => [entry.id, entry] as [string, MultilingualEntry]))(
    'exports %s without dropping a letter, mark or digit from the hidden layer',
    async (_id, entry) => {
      const { text } = await exportPdf(multilingualConversation(entry))
      const layer = text.normalize('NFC')
      const source = (entry.title + entry.user + entry.assistant)
        .replace(/^```.*$/gm, '')
        .replace(/[`$]/g, '')
        .normalize('NFC')
      const lost = [...new Set(Array.from(source))]
        .filter(char => /[\p{L}\p{M}\p{N}\p{S}]/u.test(char))
        .filter(char => !layer.includes(char))
      expect(lost).toEqual([])
      expect(text).not.toContain('�')
    }
  )

  it('renders bulk mode and Letter pages', async () => {
    const { raw } = await exportPdf(simpleConversation('Bulk 中文 ok'), {
      pdfRenderMode: 'bulk',
      format: 'pdf'
    })
    expect(raw).toContain('/MediaBox')
  })
})
