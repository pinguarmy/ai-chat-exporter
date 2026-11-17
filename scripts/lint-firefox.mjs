#!/usr/bin/env node
// Runs `web-ext lint` on the staged Firefox package (build/firefox-mv3).
//
// Fails on any error, and on any warning that is not in KNOWN_WARNINGS below.
// Each known warning documents why it is accepted; a NEW warning code, or a
// known code appearing in a file that is not listed, fails the check so that
// regressions are noticed instead of drowning in an existing warning count.
// Run `npm run build` first.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_SOURCE_DIR = 'build/firefox-mv3'

/**
 * `files` are regular expressions over the path web-ext reports, relative to
 * the package root. An entry without `files` accepts the code anywhere
 * (manifest-level warnings).
 */
export const KNOWN_WARNINGS = [
  {
    code: 'KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION',
    reason:
      'strict_min_version 140 predates Firefox for Android support for data_collection_permissions (142). Raising the minimum would drop users, so the maintainer owns that decision; the key is ignored on Android 140-141.'
  },
  {
    code: 'DANGEROUS_EVAL',
    files: [/^chunks\/index\.es-[\w-]+\.js$/],
    reason:
      'Bundled core-js global-object fallback (`Function("return this")()`) used by the PDF stack. Not first-party code and takes no dynamic input.'
  },
  {
    code: 'UNSAFE_VAR_ASSIGNMENT',
    files: [
      // React DOM's SVG innerHTML shim lives in the shared React chunk (named after
      // src/mount-page.tsx, the first module that imports react-dom) of every React page.
      /^chunks\/mount-page-[\w-]+\.js$/,
      // Shared export renderers (DOMPurify) bundled into the preview and workspace pages.
      /^chunks\/export-html-[\w-]+\.js$/,
      // Vendored PDF/DOM libraries: html2canvas font probe, jsPDF html plugin and DOMPurify.
      /^chunks\/(html2canvas|jspdf\.es\.min)-[\w-]+\.js$/,
      // DOMPurify plus the offscreen PDF render container in src/core/export-pdf.ts,
      // which receives markup that is already escaped/sanitized where it is generated.
      /^chunks\/export-pdf-download-[\w-]+\.js$/
    ],
    reason:
      'innerHTML assignments in bundled React DOM, html2canvas, jsPDF and DOMPurify, and the reviewed offscreen PDF container in src/core/export-pdf.ts (trusted wrapper plus content sanitized upstream).'
  }
]

const normalize = file =>
  String(file ?? '')
    .replaceAll('\\', '/')
    .replace(/^\/+/, '')

export function isKnownWarning(message) {
  const file = normalize(message.file)
  return KNOWN_WARNINGS.some(
    known => known.code === message.code && (!known.files || known.files.some(re => re.test(file)))
  )
}

/** Pure evaluation of a `web-ext lint -o json` report. */
export function evaluateLintReport(report) {
  const errors = report?.errors ?? []
  const warnings = report?.warnings ?? []
  const unexpected = warnings.filter(message => !isKnownWarning(message))
  return {
    errors,
    unexpected,
    accepted: warnings.length - unexpected.length,
    ok: errors.length === 0 && unexpected.length === 0
  }
}

const describe = message =>
  `${message.code} ${normalize(message.file) || '(manifest)'} - ${message.message}`

export function main(argv = process.argv.slice(2)) {
  const sourceDir = path.resolve(root, argv[0] ?? DEFAULT_SOURCE_DIR)
  if (!existsSync(path.join(sourceDir, 'manifest.json'))) {
    console.error(
      `Firefox package not found at ${path.relative(root, sourceDir)}. Run \`npm run build\` first.`
    )
    return 1
  }

  const webExtBin = path.join(root, 'node_modules/web-ext/bin/web-ext.js')
  const result = spawnSync(
    process.execPath,
    [
      webExtBin,
      'lint',
      '--source-dir',
      sourceDir,
      '--artifacts-dir',
      path.join(root, 'build/web-ext-artifacts'),
      '--no-config-discovery',
      '--no-input',
      '--output',
      'json'
    ],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )

  let report
  try {
    report = JSON.parse(result.stdout)
  } catch {
    console.error('web-ext lint did not produce a JSON report.')
    if (result.stderr) console.error(result.stderr.trim())
    return 1
  }

  const { errors, unexpected, accepted, ok } = evaluateLintReport(report)
  console.log(
    `web-ext lint: ${errors.length} errors, ${unexpected.length} unexpected warnings, ${accepted} documented warnings accepted, ${report.summary?.notices ?? 0} notices`
  )
  for (const message of errors) console.error(`ERROR   ${describe(message)}`)
  for (const message of unexpected) console.error(`WARNING ${describe(message)}`)
  if (!ok) {
    console.error(
      'Fix the finding, or document a justified exception in KNOWN_WARNINGS (scripts/lint-firefox.mjs) and docs/MAINTENANCE.md.'
    )
    return 1
  }
  if (result.status !== 0) {
    console.error(`web-ext exited with status ${result.status}.`)
    return 1
  }
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
