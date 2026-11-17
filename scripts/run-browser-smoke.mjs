#!/usr/bin/env node
/**
 * Runs the four built-extension browser checks concurrently.
 *
 * Each script owns a unique temp profile, download directory and evidence
 * directory (`mkdtemp`), binds no fixed port, and only reads the built
 * extension, so they cannot interfere with each other. Output is prefixed per
 * script; the process exits non-zero if any script fails, after all finished,
 * so one failure never hides another. `npm run test:browser` runs the same
 * scripts one at a time (the release workflow keeps using that).
 *
 * Requires a prior `npm run build` and the Playwright Chromium install.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SMOKE_SCRIPTS = [
  'extension-smoke.mjs',
  'scheduled-download-smoke.mjs',
  'ux-experience-smoke.mjs',
  'pdf-multilingual-regression.mjs'
]

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))

function prefixLines(stream, target, label) {
  let pending = ''
  stream.setEncoding('utf8')
  stream.on('data', chunk => {
    pending += chunk
    const lines = pending.split('\n')
    pending = lines.pop()
    for (const line of lines) target.write(`[${label}] ${line}\n`)
  })
  stream.on('end', () => {
    if (pending) target.write(`[${label}] ${pending}\n`)
  })
}

function runScript(script) {
  const label = script.replace(/\.mjs$/, '')
  const started = Date.now()
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(scriptsDir, script)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env
    })
    prefixLines(child.stdout, process.stdout, label)
    prefixLines(child.stderr, process.stderr, label)
    child.on('error', error => {
      process.stderr.write(`[${label}] failed to start: ${error.message}\n`)
      resolve({ script, code: 1, seconds: (Date.now() - started) / 1000 })
    })
    child.on('close', (code, signal) =>
      resolve({ script, code: code ?? (signal ? 1 : 0), seconds: (Date.now() - started) / 1000 })
    )
  })
}

const started = Date.now()
const results = await Promise.all(SMOKE_SCRIPTS.map(runScript))
console.log('\nBrowser smoke summary')
for (const { script, code, seconds } of results) {
  console.log(`  ${code === 0 ? 'PASS' : 'FAIL'}  ${script}  ${seconds.toFixed(1)}s`)
}
console.log(`  total wall time ${((Date.now() - started) / 1000).toFixed(1)}s`)
process.exit(results.every(result => result.code === 0) ? 0 : 1)
