#!/usr/bin/env node

/**
 * Export a real Downloads PDF through the production PDF renderer and run
 * machine-readable checks for text search, link annotations, formulas, and
 * image pagination. This uses only a local file; it never opens a provider
 * session or records browser credentials.
 *
 * Usage:
 *   node scripts/pdf-current-regression.mjs [input-pdf] [output-dir]
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const inputPdf = path.resolve(process.argv[2] || path.join(os.homedir(), 'Downloads', 'Google-AI-Search-Watch.pdf'))
const outputDir = path.resolve(process.argv[3] || path.join(repoRoot, 'output', 'pdf', 'visual-regression'))
const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-chat-exporter-pdf-current-'))
const bundlePath = path.join(workDir, 'export-pdf.bundle.js')
const pagePath = path.join(workDir, 'render.html')

const chromePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const pdftoppm = process.env.PDFTOPPM_BIN || 'pdftoppm'
const pdfinfo = process.env.PDFINFO_BIN || 'pdfinfo'
const pdftotext = process.env.PDFTOTEXT_BIN || 'pdftotext'
const pdfimages = process.env.PDFIMAGES_BIN || 'pdfimages'

if (!fs.existsSync(inputPdf)) throw new Error(`Missing input PDF: ${inputPdf}`)
await fsp.mkdir(outputDir, { recursive: true })

function run(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 128 * 1024 * 1024
  })
}

function dataUrl(filePath, mime = 'image/png') {
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`
}

function renderFirstPage(input, target) {
  const prefix = target.replace(/\.png$/i, '')
  run(pdftoppm, ['-png', '-f', '1', '-l', '1', '-singlefile', input, prefix])
  return `${prefix}.png`
}

function normalizeSourceText(value) {
  // The source PDF is a raster-first export, but Poppler can recover the
  // visible text. Collapse its layout whitespace for a useful regression
  // transcript, then turn the recovered URLs into actual Markdown links.
  const compact = value.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  return compact.replace(/(https?:\/\/[^\s<>()]+)/g, '[$1]($1)')
}

const sourceText = normalizeSourceText(run(pdftotext, ['-layout', inputPdf, '-']))
const referencePage = renderFirstPage(inputPdf, path.join(workDir, 'reference-page-1.png'))
const formula = String.raw`\[\text{citation share}=\frac{\text{domain citations}}{\text{all citations}}\]`
const conversation = {
  id: 'visual-regression-google-ai-search-watch',
  title: 'Google AI Search Watch — improved PDF regression',
  url: 'https://chatgpt.com/c/local-pdf-regression',
  platform: 'chatgpt',
  // Keep this as the raw API slug so the regression catches accidental
  // letter-spaced build identifiers in the rendered conversation header.
  modelName: 'gpt-5-6-thinking',
  createdAt: Date.UTC(2026, 6, 31, 10, 50, 37),
  messages: [
    {
      id: 'regression-user',
      role: 'user',
      content: '请检查这份研究导出：文字应可搜索，链接应可点击，公式应正常排版。',
      timestamp: Date.UTC(2026, 6, 31, 10, 50, 37)
    },
    {
      id: 'regression-assistant',
      role: 'assistant',
      content: `## 真实 Downloads 内容回归\n\n${sourceText}\n\n## 版式检查\n\n| 检查项 | 预期结果 |\n| --- | --- |\n| 搜索文字 | 可选中、可搜索 |\n| 链接 | 点击打开原网页 |\n| LaTeX | 渲染为公式 |\n\n${formula}`,
      timestamp: Date.UTC(2026, 6, 31, 10, 52, 11),
      attachments: [{ type: 'image', name: path.basename(referencePage), url: dataUrl(referencePage) }]
    }
  ]
}

run(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
  path.join(repoRoot, 'src/core/export-pdf.ts'),
  '--bundle', '--format=iife', '--global-name=PdfExport', '--platform=browser', '--target=es2020',
  `--outfile=${bundlePath}`
])

const sourceBundle = JSON.stringify(conversation).replace(/<\//g, '<\\/')
const html = `<!doctype html>
<meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:#fff}#status{font:14px sans-serif;padding:24px;white-space:pre-wrap}</style>
<div id="status">Rendering…</div>
<script src="file://${bundlePath.replaceAll('\\', '/')}" onerror="document.querySelector('#status').textContent='bundle load failed'"></script>
<script>
(async () => {
  const status = document.querySelector('#status')
  try {
    const conversation = ${sourceBundle}
    const options = {
      format: 'pdf', includeMetadata: true, includeCodeBlocks: true,
      includeImages: true, includeUploadedFiles: true, exportArtifacts: true,
      pdfStyle: 'minimal', pdfTextLayer: true, assistantDisplayName: '',
      showMessageTimestamps: true
    }
    const blob = await PdfExport.exportToPdfBlob(conversation, options)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
    }
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
  '--headless', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
  '--disable-dev-shm-usage', '--run-all-compositor-stages-before-draw',
  '--virtual-time-budget=120000', '--dump-dom', `file://${pagePath}`
])
const errorMatch = dom.match(/data-error="([^"]*)"/)
if (errorMatch) throw new Error(`Chrome export failed: ${errorMatch[1]}`)
const resultMatch = dom.match(/data-result="([^"]*)"/)
if (!resultMatch) throw new Error(`Chrome did not return a PDF. DOM tail: ${dom.slice(-1200)}`)

const pdfPath = path.join(outputDir, 'Google-AI-Search-Watch-improved.pdf')
await fsp.writeFile(pdfPath, Buffer.from(resultMatch[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&'), 'base64'))
const pngPath = renderFirstPage(pdfPath, path.join(outputDir, 'Google-AI-Search-Watch-improved-page-1.png'))
const pageDir = path.join(outputDir, 'Google-AI-Search-Watch-improved-pages')
await fsp.mkdir(pageDir, { recursive: true })
run(pdftoppm, ['-png', pdfPath, path.join(pageDir, 'page')])

const textPath = path.join(outputDir, 'Google-AI-Search-Watch-improved.txt')
run(pdftotext, [pdfPath, textPath])
const text = await fsp.readFile(textPath, 'utf8')
const info = run(pdfinfo, [pdfPath])
const imageInfo = run(pdfimages, ['-list', pdfPath])
const rawPdf = await fsp.readFile(pdfPath, 'latin1')
const count = token => (rawPdf.match(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
const report = {
  inputPdf,
  pdfPath,
  pngPath,
  pageDir,
  pageCount: Number(info.match(/Pages:\s+(\d+)/)?.[1] || 0),
  textBytes: Buffer.byteLength(text),
  searchableTerms: {
    chinese: text.includes('搜索文字'),
    modelName: text.includes('GPT-5.6'),
    timestamp: text.includes('2026')
  },
  rawLatexDelimiters: /\\\[|\\\]|\\frac\{|\\text\{/.test(text),
  annotations: { annots: count('/Annots'), links: count('/Subtype /Link'), uris: count('/URI') },
  identityHFont: rawPdf.includes('/Encoding /Identity-H'),
  imageCount: Math.max(0, imageInfo.split('\n').filter(line => /^\s*\d+\s+\d+\s+image\s+/i.test(line)).length)
}
const reportPath = path.join(outputDir, 'Google-AI-Search-Watch-improved-report.json')
await fsp.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
