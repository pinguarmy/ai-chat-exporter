#!/usr/bin/env node

/**
 * Export the synthetic multilingual corpus (tests/fixtures/multilingual) through
 * the production PDF exporter in headless Chromium and check, per language:
 *
 *   - the visible layer: text is either drawn by the PDF (Chinese/ASCII only) or
 *     left to the browser raster for every other script, never half and half;
 *   - the hidden text layer, decoded from the PDF itself (scripts/lib/pdf-text-layer.mjs):
 *     every expected phrase is present, every letter/mark/digit/symbol of the
 *     source appears at least once, and nothing is replaced by U+FFFD.
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
import { execFileSync } from 'node:child_process'
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

/**
 * The only entries whose characters are all inside the Helvetica/WinAnsi and
 * STSong/GB sets, so the exporter draws their text as PDF vector text. Every
 * other script must keep the browser raster as its visible layer.
 */
const VECTOR_ENTRIES = new Set(['zh-hans', 'zh-hant', 'fullwidth'])

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
const entries = corpus.entries.filter(entry => !only || only.includes(entry.id))
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
    const expectedLayer = VECTOR_ENTRIES.has(entry.id) ? 'vector' : 'raster'
    if (visibleLayer !== expectedLayer)
      failures.push(`visible layer is ${visibleLayer}, expected ${expectedLayer}`)
    results.push({
      id: entry.id,
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
      `${result.phrasesFound}/${result.phrasesTotal} phrases  ${result.ms}ms`
  )
  for (const failure of result.failures) console.log(`       ${failure}`)
}
const failed = results.filter(result => result.failures.length > 0)
if (failed.length > 0) {
  console.error(`PDF multilingual regression failed for: ${failed.map(r => r.id).join(', ')}`)
  process.exitCode = 1
}
