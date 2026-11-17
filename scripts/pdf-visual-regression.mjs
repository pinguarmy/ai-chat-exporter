#!/usr/bin/env node

/**
 * Generate repeatable PDF visual-regression samples from the real exports in a
 * user's Downloads folder. The script intentionally uses the production
 * exportToPdfBlob path in a headless Chrome page, then runs Poppler checks over
 * the resulting PDFs. It never opens a provider session or records cookies.
 *
 * Usage:
 *   node scripts/pdf-visual-regression.mjs [downloads-dir] [output-dir]
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const downloadsDir = path.resolve(process.argv[2] || path.join(os.homedir(), 'Downloads'))
const outputDir = path.resolve(
  process.argv[3] || path.join(os.tmpdir(), 'ai-chat-exporter-pdf-visual-regression')
)
const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-chat-exporter-pdf-'))
const bundlePath = path.join(workDir, 'export-pdf.bundle.js')
const pagePath = path.join(workDir, 'render.html')

const chromePath =
  process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const pdftoppm = process.env.PDFTOPPM_BIN || 'pdftoppm'
const pdfinfo = process.env.PDFINFO_BIN || 'pdfinfo'
const pdftotext = process.env.PDFTOTEXT_BIN || 'pdftotext'
const pdfimages = process.env.PDFIMAGES_BIN || 'pdfimages'

const files = {
  aiMarkdown: path.join(downloadsDir, 'AI4Science-breakthroughs-investments-challenges.md'),
  aiReferencePdf: path.join(
    downloadsDir,
    'AI4Science-breakthroughs-investments-challenges (1).pdf'
  ),
  cameraMarkdown: path.join(downloadsDir, '浦东嘉里城相机维修指南-Google-Gemini.md'),
  cameraReferencePdf: path.join(downloadsDir, '浦东嘉里城相机维修指南-Google-Gemini (3).pdf'),
  djiReferencePdf: path.join(downloadsDir, '大疆-4G-模块上网.pdf')
}

function requireFile(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing regression input: ${filePath}`)
}

for (const filePath of [
  files.aiMarkdown,
  files.cameraMarkdown,
  files.aiReferencePdf,
  files.cameraReferencePdf,
  files.djiReferencePdf
]) {
  requireFile(filePath)
}

await fsp.mkdir(outputDir, { recursive: true })

function run(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 128 * 1024 * 1024
  })
}

function renderFirstPageToPng(pdfPath, targetPath) {
  const prefix = targetPath.replace(/\.png$/i, '')
  run(pdftoppm, ['-png', '-f', '1', '-l', '1', '-singlefile', pdfPath, prefix])
  return `${prefix}.png`
}

async function renderAllPagesToPng(pdfPath, targetDir, stem) {
  await fsp.mkdir(targetDir, { recursive: true })
  const prefix = path.join(targetDir, stem)
  run(pdftoppm, ['-png', pdfPath, prefix])
  return (await fsp.readdir(targetDir))
    .filter(file => file.startsWith(`${stem}-`) && file.endsWith('.png'))
    .sort()
    .map(file => path.join(targetDir, file))
}

function dataUrl(filePath, mime = 'image/png') {
  const encoded = fs.readFileSync(filePath).toString('base64')
  return `data:${mime};base64,${encoded}`
}

function section(markdown, marker, nextMarker) {
  const start = markdown.indexOf(marker)
  if (start < 0) return ''
  const contentStart = start + marker.length
  const end = nextMarker ? markdown.indexOf(nextMarker, contentStart) : -1
  return markdown
    .slice(contentStart, end < 0 ? markdown.length : end)
    .replace(/^\s*\*[^\n]+\*\s*\n/, '')
    .trim()
}

function conversationFromMarkdown(markdownPath, title, platform, imagePath) {
  const markdown = fs.readFileSync(markdownPath, 'utf8')
  const user = section(markdown, '### 👤 User', '### 🤖 Assistant')
  const assistant = section(markdown, '### 🤖 Assistant', '\n\n---')
  const messages = [
    { id: `${platform}-user`, role: 'user', content: user || '请导出这份对话。' },
    {
      id: `${platform}-assistant`,
      role: 'assistant',
      content: assistant || markdown,
      attachments: imagePath
        ? [{ type: 'image', name: path.basename(imagePath), url: dataUrl(imagePath) }]
        : []
    }
  ]
  return {
    id: `visual-regression-${platform}`,
    title,
    url:
      platform === 'gemini'
        ? 'https://gemini.google.com/app/local-regression'
        : 'https://grok.com/c/local-regression',
    platform,
    messages
  }
}

function djiConversation(imagePath) {
  return {
    id: 'visual-regression-dji',
    title: '大疆 4G 模块上网（图片与表格回归）',
    url: 'https://chatgpt.com/c/local-regression',
    platform: 'chatgpt',
    messages: [
      {
        id: 'dji-user',
        role: 'user',
        content: '请整理这份大疆 4G 模块上网资料，并保留图片与对比表。'
      },
      {
        id: 'dji-assistant',
        role: 'assistant',
        content: `## 设备对比\n\n| 设备 | 能直连 4G | 能发射 Wi-Fi | 能多设备共享 | 主要用途 |\n| --- | --- | --- | --- | --- |\n| 大疆 4G 模块 | 是 | 通常不能 | 通常不能 | 大疆增强图传 |\n| 随身 Wi-Fi / MiFi | 是 | 是 | 是 | 给手机、电脑共享网络 |\n\n这是一份真实下载页面的图片回归样本。文字层应能搜索“设备对比”和“随身 Wi-Fi”。`,
        attachments: [{ type: 'image', name: path.basename(imagePath), url: dataUrl(imagePath) }]
      }
    ]
  }
}

const aiPage = renderFirstPageToPng(
  files.aiReferencePdf,
  path.join(workDir, 'ai-reference-page-1.png')
)
const cameraPage = renderFirstPageToPng(
  files.cameraReferencePdf,
  path.join(workDir, 'camera-reference-page-1.png')
)
const djiPage = renderFirstPageToPng(
  files.djiReferencePdf,
  path.join(workDir, 'dji-reference-page-1.png')
)

run(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
  path.join(repoRoot, 'src/core/export-pdf.ts'),
  '--bundle',
  '--format=iife',
  '--global-name=PdfExport',
  '--platform=browser',
  '--target=es2020',
  `--outfile=${bundlePath}`
])

const samples = [
  {
    name: 'AI4Science-minimal',
    conversation: conversationFromMarkdown(
      files.aiMarkdown,
      'AI4Science breakthroughs, investments & challenges',
      'grok',
      aiPage
    )
  },
  {
    name: 'camera-repair-minimal',
    conversation: conversationFromMarkdown(
      files.cameraMarkdown,
      '浦东嘉里城相机维修指南',
      'gemini',
      cameraPage
    )
  },
  { name: 'dji-4g-image-table-minimal', conversation: djiConversation(djiPage) }
]

const sourceBundle = JSON.stringify(samples).replace(/<\//g, '<\\/')
const html = `<!doctype html>
<meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:#fff}#status{font:14px sans-serif;padding:24px;white-space:pre-wrap}</style>
<div id="status">Rendering PDF samples…</div>
<script src="file://${bundlePath.replaceAll('\\', '/')}" onerror="document.querySelector('#status').textContent='bundle load failed'"></script>
<script>
(async () => {
  const status = document.querySelector('#status')
  try {
    const samples = ${sourceBundle}
    const options = { format: 'pdf', includeMetadata: true, includeCodeBlocks: true, includeImages: true, includeUploadedFiles: true, exportArtifacts: true, pdfStyle: 'minimal', pdfTextLayer: true }
    const results = []
    for (const sample of samples) {
      const blob = await PdfExport.exportToPdfBlob(sample.conversation, options)
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let binary = ''
      const chunk = 0x8000
      for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
      results.push({ name: sample.name, data: btoa(binary) })
      status.textContent = 'Rendered ' + results.length + '/' + samples.length + ' samples…'
    }
    document.body.dataset.results = JSON.stringify(results)
    status.textContent = 'DONE'
  } catch (error) {
    status.textContent = 'ERROR: ' + (error && error.stack || error)
    document.body.dataset.error = String(error && error.stack || error)
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
const resultMatch = dom.match(/data-results="([^"]*)"/)
const errorMatch = dom.match(/data-error="([^"]*)"/)
if (errorMatch) throw new Error(`Chrome export failed: ${errorMatch[1]}`)
if (!resultMatch)
  throw new Error(`Chrome did not return sample data. DOM tail: ${dom.slice(-1000)}`)

const decodedResults = JSON.parse(resultMatch[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&'))
const reports = []
for (const result of decodedResults) {
  const pdfPath = path.join(outputDir, `${result.name}.pdf`)
  await fsp.writeFile(pdfPath, Buffer.from(result.data, 'base64'))
  const pngPath = renderFirstPageToPng(pdfPath, path.join(outputDir, `${result.name}-page-1.png`))
  const pageImageDir = path.join(outputDir, `${result.name}-pages`)
  const pageImages = await renderAllPagesToPng(pdfPath, pageImageDir, result.name)
  const info = run(pdfinfo, [pdfPath])
  const textPath = path.join(outputDir, `${result.name}.txt`)
  run(pdftotext, [pdfPath, textPath])
  const text = await fsp.readFile(textPath, 'utf8')
  const imageInfo = run(pdfimages, ['-list', pdfPath])
  const pageCount = Number(info.match(/Pages:\s+(\d+)/)?.[1] || 0)
  reports.push({
    name: result.name,
    pdfPath,
    pngPath,
    pageImageDir,
    pageImages,
    pageCount,
    textBytes: Buffer.byteLength(text),
    textPreview: text.replace(/\s+/g, ' ').trim().slice(0, 180),
    imageCount: Math.max(
      0,
      imageInfo.split('\n').filter(line => /^\s*\d+\s+\d+\s+image\s+/i.test(line)).length
    )
  })
}

const reportPath = path.join(outputDir, 'report.json')
await fsp.writeFile(
  reportPath,
  JSON.stringify({ generatedAt: new Date().toISOString(), reports }, null, 2) + '\n'
)
console.log(JSON.stringify({ outputDir, reportPath, reports }, null, 2))
