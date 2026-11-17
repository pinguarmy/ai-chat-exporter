#!/usr/bin/env node

/**
 * Export the synthetic multilingual corpus (tests/fixtures/multilingual) through
 * the production PDF exporter in headless Chromium and check, per language:
 *
 *   - the visible layer: text is drawn by the PDF only when every character is in
 *     Helvetica's WinAnsi set; every other script, Chinese included, is left to the
 *     browser raster, never half and half;
 *   - the hidden text layer, decoded from the PDF itself (scripts/lib/pdf-text-layer.mjs):
 *     every expected phrase is present, every letter/mark/digit/symbol of the
 *     source appears at least once, and nothing is replaced by U+FFFD.
 *
 * Poppler checks (no poppler-data is needed or assumed: nothing in the PDF refers to a
 * predefined CJK CMap or a non-embedded CJK font):
 *   - `pdftoppm` reports no font or CMap error;
 *   - Chinese is visible: every hidden-layer word that contains a CJK character has ink in a
 *     100 dpi render of the page (the old vector overlay rendered blank without poppler-data);
 *   - `pdftotext -raw` extracts the Chinese phrases;
 *   - no two words on the same line overlap (`pdftotext -bbox`), e.g. a metadata label and
 *     its value.
 * Two inline extras (`zh-code-mixed`, `latin-code`) cover Chinese identifiers in code blocks
 * and the pure-Latin vector path; they are reported separately from the corpus.
 *
 * Synthetic data only; it never opens a provider session or reads credentials.
 *
 * Usage:
 *   node scripts/pdf-multilingual-regression.mjs [--out DIR] [--only id,id] [--png]
 *
 * Requires Playwright Chromium (`npx playwright install chromium`). `--png`
 * additionally rasterizes pages with Poppler's `pdftoppm` for visual review.
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { extractPdfTextObjects } from './lib/pdf-text-layer.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = name => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const outDir = flag('--out')
const only = flag('--only')?.split(',')
const writePng = args.includes('--png')
const pdftoppm = process.env.PDFTOPPM_BIN || 'pdftoppm'

// The Poppler checks are part of the gate, so a missing tool must fail loudly
// with an actionable message instead of an ENOENT on a render that never ran.
for (const tool of [pdftoppm, 'pdftotext']) {
  const probe = spawnSync(tool, ['-v'], { encoding: 'utf8' })
  if (probe.error) {
    console.error(
      `${tool} is required for the multilingual PDF regression. Install Poppler ` +
        '(Debian/Ubuntu: apt-get install --no-install-recommends poppler-utils; macOS: brew install poppler).'
    )
    process.exit(2)
  }
}

/**
 * Inline entries (not part of the shared corpus). Only text inside Helvetica's
 * WinAnsi set is drawn by the PDF; Chinese must stay in the browser raster.
 */
const EXTRA_ENTRIES = [
  {
    id: 'zh-code-mixed',
    script: 'Hans',
    title: '混合 Mixed 中文 code',
    user: '解释 recursion 递归 (n=5)',
    assistant:
      '## 混合 Mixed\n\n**粗体中文 bold** 和 *斜体 italic* 以及 `code变量` 与 URL https://example.com/路径。\n\n- 阶乘 factorial\n\n```js\nconst 阶乘 = n => n <= 1 ? 1 : n * 阶乘(n - 1) // 递归\nconsole.log(阶乘(5))\n```\n',
    needles: ['混合 Mixed', '粗体中文 bold', 'code变量', '阶乘', 'n * 阶乘(n - 1) // 递归'],
    expectedLayer: 'raster',
    extra: true
  },
  {
    id: 'latin-code',
    script: 'Latin',
    title: 'English code',
    user: 'Show code',
    assistant:
      '## Code\n\nText here with `inline` code.\n\n```python\ndef fact(n):\n    return 1 if n <= 1 else n * fact(n - 1)\n```\n',
    needles: ['English code', 'Text here with', 'def fact(n):', 'n * fact(n - 1)'],
    expectedLayer: 'vector',
    extra: true
  }
]

const CJK_RE = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff01-\uff5e]/u
const CJK_SCRIPTS = new Set(['Hans', 'Hant', 'CJK-punct'])
/**
 * Scripts whose words Poppler reports reliably. Right-to-left text, combining marks,
 * Indic clusters and emoji sequences are split into pseudo-words with touching boxes by
 * Poppler's own layout, which would make an overlap check meaningless there.
 */
const OVERLAP_CHECKED_SCRIPTS = new Set([
  'Hans',
  'Hant',
  'Jpan',
  'Kore',
  'Cyrl',
  'Grek',
  'CJK-punct',
  'Code',
  'Latn-ext',
  'Latin'
])

/** Words of page 1 from `pdftotext -bbox` (PDF points, origin top-left). */
function pdfWords(pdfPath) {
  const out = run('pdftotext', ['-f', '1', '-l', '1', '-bbox', pdfPath, '-'])
  const decode = text =>
    text
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
  const words = [
    ...out.matchAll(
      /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)<\/word>/g
    )
  ]
  return words.map(([, x0, y0, x1, y1, text]) => ({
    x0: Number(x0),
    y0: Number(y0),
    x1: Number(x1),
    y1: Number(y1),
    text: decode(text)
  }))
}

/** Two words on one line whose boxes overlap horizontally: a label running into its value. */
function overlappingWords(words) {
  const overlaps = []
  for (const [index, a] of words.entries()) {
    for (const b of words.slice(index + 1)) {
      const sameLine = Math.abs((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2) < 1.5
      if (sameLine && b.x0 > a.x0 && b.x0 < a.x1 - 0.6 && b.x1 > a.x0 + 0.6) {
        overlaps.push(`${a.text} / ${b.text} (${(a.x1 - b.x0).toFixed(1)} pt)`)
      }
    }
  }
  return overlaps
}

/** Dark-pixel fraction of a PDF-point box in a P5 (binary greyscale) render. */
function inkFraction(pgm, box, dpi) {
  const scale = dpi / 72
  const x0 = Math.max(0, Math.floor(box.x0 * scale))
  const x1 = Math.min(pgm.width, Math.ceil(box.x1 * scale))
  const y0 = Math.max(0, Math.floor(box.y0 * scale))
  const y1 = Math.min(pgm.height, Math.ceil(box.y1 * scale))
  let dark = 0
  let total = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      total++
      if (pgm.data[y * pgm.width + x] < 160) dark++
    }
  }
  return total === 0 ? 0 : dark / total
}

function parsePgm(buffer) {
  const header = buffer
    .subarray(0, 64)
    .toString('latin1')
    .match(/^P5\s+(\d+)\s+(\d+)\s+255\s/)
  if (!header) throw new Error('Unexpected pdftoppm greyscale output')
  return {
    width: Number(header[1]),
    height: Number(header[2]),
    data: buffer.subarray(header[0].length)
  }
}

/**
 * Poppler checks on one exported PDF (see the header). Returns failure strings.
 */
async function checkWithPoppler(entry, pdfPath, workDirForPoppler) {
  const failures = []
  const base = path.join(workDirForPoppler, entry.id)
  const dpi = 100
  const rendered = spawnSync(
    pdftoppm,
    ['-gray', '-r', String(dpi), '-f', '1', '-l', '1', '-singlefile', pdfPath, base],
    { encoding: 'utf8' }
  )
  if (rendered.error) throw rendered.error
  if (rendered.status !== 0) {
    failures.push(`pdftoppm failed: ${rendered.stderr}`)
    return failures
  }
  if (/Syntax Error|Unknown CMap|CMap file|Unknown font/i.test(rendered.stderr || '')) {
    failures.push(
      `pdftoppm reported a font/CMap problem: ${(rendered.stderr || '').split('\n')[0]}`
    )
  }
  const pgm = parsePgm(await fsp.readFile(`${base}.pgm`))
  const words = pdfWords(pdfPath)

  const overlaps = OVERLAP_CHECKED_SCRIPTS.has(entry.script) ? overlappingWords(words) : []
  if (overlaps.length > 0) failures.push(`overlapping words: ${overlaps.slice(0, 3).join('; ')}`)

  if (CJK_SCRIPTS.has(entry.script)) {
    const cjkWords = words.filter(word => CJK_RE.test(word.text))
    if (cjkWords.length === 0) failures.push('pdftotext found no Chinese words on page 1')
    const blank = cjkWords.filter(word => inkFraction(pgm, word, dpi) < 0.02)
    if (blank.length > 0) {
      failures.push(
        `Chinese words with no ink in the Poppler render: ${blank
          .slice(0, 3)
          .map(w => w.text)
          .join(' ')}`
      )
    }
    const raw = run('pdftotext', ['-raw', pdfPath, '-'])
    const missing = (entry.pdfNeedles ?? [entry.title, ...entry.needles])
      .filter(phrase => CJK_RE.test(phrase))
      .filter(phrase => !squash(raw).includes(squash(phrase)))
    if (missing.length > 0) failures.push(`pdftotext -raw is missing: ${JSON.stringify(missing)}`)
  }
  return failures
}

function run(command, commandArgs) {
  return execFileSync(command, commandArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 128 * 1024 * 1024
  })
}

/** Remove layout whitespace and invisible controls; compare in NFC. */
function squash(value) {
  return value
    .normalize('NFC')
    .replace(/[\s\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]+/g, '')
}

const reverseCodePoints = value => Array.from(value).reverse().join('')

/**
 * Right-to-left text is stored in visual order (like Chrome's own PDFs) and
 * readers re-order it, so for those entries each word may match in either
 * direction instead of the whole phrase.
 */
function hasNeedle(layerText, needle, rtl) {
  const haystack = squash(layerText)
  if (haystack.includes(squash(needle))) return true
  if (!rtl) return false
  return needle
    .split(/\s+/)
    .filter(Boolean)
    .every(word => {
      const squashed = squash(word)
      return haystack.includes(squashed) || haystack.includes(squash(reverseCodePoints(word)))
    })
}

const corpus = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'tests/fixtures/multilingual/corpus.json'), 'utf8')
)
const entries = [...corpus.entries, ...EXTRA_ENTRIES].filter(
  entry => !only || only.includes(entry.id)
)
if (entries.length === 0) throw new Error('No corpus entries selected')

const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-chat-exporter-pdf-ml-'))
const bundlePath = path.join(workDir, 'export-pdf.bundle.js')
run(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
  path.join(repoRoot, 'src/core/export-pdf.ts'),
  '--bundle',
  '--format=iife',
  '--global-name=PdfExport',
  '--platform=browser',
  '--target=es2020',
  // i18n resolves locale assets from import.meta.url; IIFE bundles have none.
  '--define:import.meta.url=location.href',
  `--outfile=${bundlePath}`,
  '--log-level=error'
])

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const results = []
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
  page.on('pageerror', error => console.error('page error:', error.stack || error.message))
  // A real file:// URL (not about:blank) is required: bundled libraries build URLs from the location.
  const pagePath = path.join(workDir, 'render.html')
  await fsp.writeFile(
    pagePath,
    '<!doctype html><meta charset="utf-8"><body><script src="export-pdf.bundle.js"></script></body>'
  )
  await page.goto(pathToFileURL(pagePath).href)
  if (outDir) await fsp.mkdir(outDir, { recursive: true })

  for (const entry of entries) {
    const at = Date.UTC(2026, 0, 2, 3, 4, 5)
    const conversation = {
      id: `multilingual-${entry.id}`,
      title: entry.title,
      url: 'https://example.invalid/c/multilingual',
      platform: 'chatgpt',
      modelName: 'gpt-5',
      createdAt: at,
      messages: [
        { id: 'u', role: 'user', content: entry.user, timestamp: at },
        { id: 'a', role: 'assistant', content: entry.assistant, timestamp: at + 4000 }
      ]
    }
    const options = {
      format: 'pdf',
      includeMetadata: true,
      includeCodeBlocks: true,
      includeImages: true,
      includeUploadedFiles: true,
      exportArtifacts: true,
      pdfStyle: 'minimal',
      pdfTextLayer: true,
      assistantDisplayName: '',
      showMessageTimestamps: true
    }
    const started = Date.now()
    const base64 = await page.evaluate(
      async ([conv, opts]) => {
        const blob = await window.PdfExport.exportToPdfBlob(conv, opts)
        const bytes = new Uint8Array(await blob.arrayBuffer())
        let binary = ''
        for (let index = 0; index < bytes.length; index += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
        }
        return btoa(binary)
      },
      [conversation, options]
    )
    const pdfBytes = Buffer.from(base64, 'base64')
    const pdfPath = path.join(outDir || workDir, `${entry.id}.pdf`)
    await fsp.writeFile(pdfPath, pdfBytes)
    if (outDir && writePng) {
      run(pdftoppm, ['-png', '-r', '70', pdfPath, path.join(outDir, entry.id)])
    }

    const objects = extractPdfTextObjects(pdfBytes)
    const layerText = objects.map(item => item.text).join('\n')
    if (outDir) await fsp.writeFile(path.join(outDir, `${entry.id}.layer.txt`), layerText)
    const visibleLayer = objects.some(item => item.mode !== 3) ? 'vector' : 'raster'

    // `pdfNeedles` replaces the whole list where the PDF legitimately differs from Markdown.
    const phrases = entry.pdfNeedles ?? [entry.title, ...entry.needles]
    const missing = phrases.filter(phrase => !hasNeedle(layerText, phrase, entry.rtl))
    // Nothing may be dropped silently: every letter, mark, digit and symbol of
    // the source must appear somewhere in the hidden layer.
    const normalizedLayer = layerText.normalize('NFC')
    // Markdown syntax (code-fence info strings, backticks, math delimiters) is not content.
    const source = (entry.title + entry.user + entry.assistant)
      .replace(/^```.*$/gm, '')
      .replace(/[`$]/g, '')
      .normalize('NFC')
    const lostCharacters = [
      ...new Set(Array.from(source).filter(char => /[\p{L}\p{M}\p{N}\p{S}]/u.test(char)))
    ].filter(char => !normalizedLayer.includes(char))

    const failures = []
    if (missing.length > 0) failures.push(`missing phrases: ${JSON.stringify(missing)}`)
    if (lostCharacters.length > 0) failures.push(`characters lost: ${lostCharacters.join(' ')}`)
    if (layerText.includes('�')) failures.push('U+FFFD in the text layer')
    const expectedLayer = entry.expectedLayer ?? 'raster'
    if (visibleLayer !== expectedLayer)
      failures.push(`visible layer is ${visibleLayer}, expected ${expectedLayer}`)
    if (/STSong|UniGB/.test(pdfBytes.toString('latin1'))) {
      failures.push('the PDF refers to the non-embedded STSong/UniGB CJK resource')
    }
    failures.push(...(await checkWithPoppler(entry, pdfPath, workDir)))
    results.push({
      id: entry.id,
      extra: Boolean(entry.extra),
      ms: Date.now() - started,
      bytes: pdfBytes.length,
      visibleLayer,
      textObjects: objects.length,
      phrasesFound: phrases.length - missing.length,
      phrasesTotal: phrases.length,
      failures
    })
  }
} finally {
  await browser.close()
}

if (outDir) {
  await fsp.writeFile(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2) + '\n')
}
await fsp.rm(workDir, { recursive: true, force: true })
for (const result of results) {
  console.log(
    `${result.failures.length ? 'FAIL' : 'ok  '} ${result.id.padEnd(14)} ${result.visibleLayer.padEnd(6)} ` +
      `${result.phrasesFound}/${result.phrasesTotal} phrases  ${result.ms}ms${result.extra ? '  (extra)' : ''}`
  )
  for (const failure of result.failures) console.log(`       ${failure}`)
}
for (const [label, group] of [
  ['corpus', results.filter(result => !result.extra)],
  ['extra', results.filter(result => result.extra)]
]) {
  if (group.length > 0) {
    console.log(
      `${label}: ${group.filter(result => result.failures.length === 0).length}/${group.length} ok`
    )
  }
}
const failed = results.filter(result => result.failures.length > 0)
if (failed.length > 0) {
  console.error(`PDF multilingual regression failed for: ${failed.map(r => r.id).join(', ')}`)
  process.exitCode = 1
}
