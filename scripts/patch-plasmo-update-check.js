#!/usr/bin/env node

/**
 * Plasmo 0.90.5 starts an unawaited npm-registry version check for every CLI
 * command. In offline/restricted networks that request times out after the
 * extension has already bundled successfully and prints a misleading stack.
 *
 * Keep the upstream behavior by default, but let deterministic release builds
 * opt out through PLASMO_NO_UPDATE_CHECK. This postinstall patch is deliberately
 * tiny and idempotent so it can be removed when Plasmo exposes an official flag.
 *
 * postinstall warns and exits 0 if the CLI is missing or its shape drifted, so
 * contributor installs still succeed. Release builds that set
 * PLASMO_NO_UPDATE_CHECK must call isPlasmoUpdateCheckPatched() and fail if
 * this returns false.
 */
const fs = require('node:fs')
const path = require('node:path')

const cliPath = path.join(__dirname, '..', 'node_modules', 'plasmo', 'dist', 'index.js')
const original = 'fe(),kt(),process.env.NODE_ENV='
const patched = 'fe(),process.env.PLASMO_NO_UPDATE_CHECK||kt(),process.env.NODE_ENV='

function isPlasmoUpdateCheckPatched() {
  if (!fs.existsSync(cliPath)) return false
  return fs.readFileSync(cliPath, 'utf8').includes(patched)
}

function applyPatch() {
  if (!fs.existsSync(cliPath)) {
    console.warn('[postinstall] Plasmo CLI not found; update-check patch skipped.')
    process.exit(0)
  }

  const source = fs.readFileSync(cliPath, 'utf8')
  if (source.includes(patched)) process.exit(0)
  if (!source.includes(original)) {
    console.warn('[postinstall] Plasmo CLI shape changed; update-check patch skipped.')
    process.exit(0)
  }

  fs.writeFileSync(cliPath, source.replaceAll(original, patched))
  console.log('[postinstall] Patched Plasmo update check for deterministic builds.')
}

module.exports = {
  cliPath,
  original,
  patched,
  isPlasmoUpdateCheckPatched,
}

if (require.main === module) {
  applyPatch()
}
