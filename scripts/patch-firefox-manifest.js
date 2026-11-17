#!/usr/bin/env node
/**
 * Post-build script to add Firefox MV3 compatibility to the Plasmo manifest.
 * Run after `npx plasmo build` to fix:
 * 1. Missing browser_specific_settings.gecko.id
 * 2. Missing background.scripts fallback
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const buildDir = path.resolve(root, process.env.BUILD_DIR || 'build/chrome-mv3-prod')
const manifestPath = path.join(buildDir, 'manifest.json')
const packagePath = path.join(__dirname, '..', 'package.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'))

// Keep the Firefox identity/version from package.json and add the AMO field
// that Plasmo does not currently emit.
const gecko = pkg.manifest?.browser_specific_settings?.gecko
if (!gecko?.id || !gecko?.strict_min_version) {
  throw new Error('Missing Firefox gecko settings in package.json')
}
manifest.browser_specific_settings = {
  ...manifest.browser_specific_settings,
  gecko: {
    ...gecko,
    data_collection_permissions: { required: ['none'] }
  }
}

// Firefox does not support unlimitedStorage as an optional permission. Declare
// it at install time there; the application still requires explicit opt-in to
// expanded recovery storage, and keeps its default limits until then.
manifest.optional_permissions = (manifest.optional_permissions || []).filter(
  permission => permission !== 'unlimitedStorage'
)
manifest.permissions = [...new Set([...(manifest.permissions || []), 'unlimitedStorage'])]

// Add background.scripts fallback for Firefox
if (manifest.background && manifest.background.service_worker) {
  manifest.background.scripts = [manifest.background.service_worker]
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
console.log('Firefox compatibility patches applied to manifest.json')
