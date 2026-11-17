#!/usr/bin/env node

/**
 * Production PDF regression for the two failures that are easy to miss in a
 * normal DOM/unit test: true English bold font selection and inline image
 * position. It deliberately uses a real Downloaded PDF page as a local image
 * fixture; no provider tab, cookie, or conversation data is read.
 *
 * Usage:
 *   node scripts/pdf-inline-media-regression.mjs [reference-pdf] [output-dir]
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const referencePdf = path.resolve(
  process.argv[2] ||
    path.join(os.homedir(), 'Downloads', '2026-08-05-浦东嘉里城相机维修指南-Google-Gemini.pdf')
)
const outputDir = path.resolve(
  process.argv[3] || path.join(repoRoot, 'output', 'pdf', 'inline-media-regression')
)
const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-chat-exporter-inline-media-'))
const bundlePath = path.join(workDir, 'export-pdf.bundle.js')
const pagePath = path.join(workDir, 'render.html')
const referencePage = path.join(workDir, 'reference-page.png')
const referencePhoto = path.join(workDir, 'camera-repair-photo.png')

const chromePath =
  process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

function run(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 128 * 1024 * 1024
  })
}

if (!fs.existsSync(referencePdf)) throw new Error(`Missing reference PDF: ${referencePdf}`)
await fsp.mkdir(outputDir, { recursive: true })
run('pdftoppm', [
  '-png',
  '-r',
  '300',
  '-f',
  '1',
  '-l',
  '1',
  '-singlefile',
  referencePdf,
  referencePage.replace(/\.png$/i, '')
])
// The source page contains a genuine wide Gemini place-card photo near its
// lower half. Crop the photo rather than using an entire raster PDF page: a
// full-page screenshot artificially forces the next paragraph onto a page of
// its own and would not exercise the responsive image path users see.
run('sips', [
  '--cropToHeightWidth',
  '460',
  '960',
  '--cropOffset',
  '2700',
  '720',
  referencePage,
  '--out',
  referencePhoto
])

const referenceImage = `data:image/png;base64,${fs.readFileSync(referencePhoto).toString('base64')}`
const conversation = {
  id: 'inline-media-regression',
  title: 'English PDF: bold text and inline Gemini card regression',
  url: 'https://gemini.google.com/app/local-inline-media-regression',
  platform: 'gemini',
  modelName: 'gemini-2.5-pro',
  messages: [
    {
      id: 'user',
      role: 'user',
      content:
        'Please retain the service-card text, bold emphasis, and the image where it appears in the answer.'
    },
    {
      id: 'assistant',
      role: 'assistant',
      content: `## Recommendation\n\n**Key decision:** This sentence must use a real bold PDF font at every zoom level.\n\n### Nikon repair shop\n\n**尼康维修店 / Nikon repair shop** · 4.6 · Camera repair service\n\niturn447234image0\n\n**Why this card stays here:** its image belongs directly below the shop details, before this follow-up paragraph. The Markdown transcript must retain both the Chinese card name and the English description.\n\n[Open the official Nikon service directory](https://www.nikon.com/service/)`,
      attachments: [{ type: 'image', name: 'Gemini camera-repair reference', url: referenceImage }]
    }
  ]
}

run(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
  path.join(repoRoot, 'src/core/export-pdf.ts'),
  '--bundle',
  '--format=iife',
  '--global-name=PdfExport',
  '--platform=browser',
  '--target=es2020',
  `--outfile=${bundlePath}`
])

const sourceBundle = JSON.stringify(conversation).replace(/<\//g, '<\\/')
const html = `<!doctype html>
<meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:#fff}#status{font:14px sans-serif;padding:24px}</style>
<div id="status">Rendering…</div>
<script src="file://${bundlePath.replaceAll('\\', '/')}" onerror="document.querySelector('#status').textContent='bundle load failed'"></script>
<script>
(async () => {
  const status = document.querySelector('#status')
  try {
    const conversation = ${sourceBundle}
    const options = { format: 'pdf', includeMetadata: true, includeCodeBlocks: true, includeImages: true, includeUploadedFiles: true, exportArtifacts: true, pdfStyle: 'minimal', pdfTextLayer: true, showMessageTimestamps: true }
    const layout = PdfExport.conversationToHtml(conversation, options)
    const probe = document.createElement('div')
    probe.innerHTML = layout
    const probeImage = probe.querySelector('img')
    document.body.dataset.imageLength = String(probeImage?.getAttribute('src')?.length || 0)
    document.body.dataset.order = JSON.stringify({
      card: layout.indexOf('Nikon repair shop'),
      image: layout.indexOf('Gemini camera-repair reference'),
      followup: layout.indexOf('Why this card stays here')
    })
    const blob = await PdfExport.exportToPdfBlob(conversation, options)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
    document.body.dataset.result = btoa(binary)
    status.textContent = 'DONE'
  } catch (error) {
    document.body.dataset.error = String(error && error.stack || error)
    status.textContent = 'ERROR: ' + (error && error.stack || error)
  }
})()
</script>`
await fsp.writeFile(pagePath, html, 'utf8')

const dom = run(chromePath, [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  '--allow-file-access-from-files',
  '--disable-dev-shm-usage',
  '--run-all-compositor-stages-before-draw',
  '--virtual-time-budget=120000',
  '--dump-dom',
  `file://${pagePath}`
])
const errorMatch = dom.match(/data-error="([^"]*)"/)
if (errorMatch) throw new Error(`Chrome export failed: ${errorMatch[1]}`)
const resultMatch = dom.match(/data-result="([^"]*)"/)
if (!resultMatch) throw new Error(`Chrome did not return a PDF. DOM tail: ${dom.slice(-1200)}`)
const orderMatch = dom.match(/data-order="([^"]*)"/)
const layoutOrder = orderMatch
  ? JSON.parse(orderMatch[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&'))
  : null
const embeddedImageLength = Number(dom.match(/data-image-length="(\d+)"/)?.[1] || 0)

const pdfPath = path.join(outputDir, 'English-inline-media-regression.pdf')
await fsp.writeFile(
  pdfPath,
  Buffer.from(resultMatch[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&'), 'base64')
)
const pageDir = path.join(outputDir, 'pages')
await fsp.mkdir(pageDir, { recursive: true })
// Page count can shrink after a layout fix. Remove only this script's prior
// numbered renders so an obsolete page-2.png cannot masquerade as a current
// visual-regression failure.
for (const entry of await fsp.readdir(pageDir)) {
  if (/^page-\d+\.png$/.test(entry)) await fsp.unlink(path.join(pageDir, entry))
}
run('pdftoppm', ['-png', pdfPath, path.join(pageDir, 'page')])
run('pdftotext', [pdfPath, path.join(outputDir, 'English-inline-media-regression.txt')])

const text = await fsp.readFile(path.join(outputDir, 'English-inline-media-regression.txt'), 'utf8')
const rawPdf = await fsp.readFile(pdfPath, 'latin1')
const info = run('pdfinfo', [pdfPath])
const imageList = run('pdfimages', ['-list', pdfPath])
const count = pattern => (rawPdf.match(pattern) || []).length
const report = {
  referencePdf,
  pdfPath,
  pageDir,
  pageCount: Number(info.match(/Pages:\s+(\d+)/)?.[1] || 0),
  imageCount: Math.max(
    0,
    imageList.split('\n').filter(line => /^\s*\d+\s+\d+\s+image\s+/i.test(line)).length
  ),
  layoutOrder,
  embeddedImageLength,
  searchableText: {
    englishBoldPhrase: text.includes('Key decision'),
    cardNameChinese: text.includes('尼康维修店'),
    cardNameEnglish: text.includes('Nikon repair shop')
  },
  // /F1 is Helvetica; /F2 is Helvetica-Bold in jsPDF's resource dictionary.
  visibleFontCommands: {
    helvetica: count(/\/F1\s+[\d.]+\s+Tf/g),
    helveticaBold: count(/\/F2\s+[\d.]+\s+Tf/g)
  },
  links: count(/\/Subtype \/Link/g)
}
await fsp.writeFile(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2) + '\n')

if (
  !layoutOrder ||
  !(
    layoutOrder.card >= 0 &&
    layoutOrder.card < layoutOrder.image &&
    layoutOrder.image < layoutOrder.followup
  )
) {
  throw new Error(`Inline image order regression: ${JSON.stringify(layoutOrder)}`)
}
if (report.embeddedImageLength !== referenceImage.length) {
  throw new Error(
    `Inline image source regression: ${report.embeddedImageLength} !== ${referenceImage.length}`
  )
}
if (
  !report.searchableText.englishBoldPhrase ||
  !report.searchableText.cardNameChinese ||
  !report.searchableText.cardNameEnglish
) {
  throw new Error(`Searchable transcript regression: ${JSON.stringify(report.searchableText)}`)
}
if (report.imageCount < 1 || report.visibleFontCommands.helveticaBold < 1 || report.links < 1) {
  throw new Error(`PDF media/font/link regression: ${JSON.stringify(report)}`)
}

console.log(JSON.stringify(report, null, 2))
