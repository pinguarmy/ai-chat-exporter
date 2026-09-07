#!/usr/bin/env node
/**
 * Post-build script to add Firefox MV3 compatibility to the Plasmo manifest.
 * Run after `npx plasmo build` to fix:
 * 1. Missing browser_specific_settings.gecko.id
 * 2. Missing background.scripts fallback
 */
const fs = require('fs')
const path = require('path')

const manifestPath = path.join(__dirname, '..', 'build/chrome-mv3-prod/manifest.json')
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

// Add background.scripts fallback for Firefox
if (manifest.background && manifest.background.service_worker) {
  manifest.background.scripts = [manifest.background.service_worker]
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
console.log('Firefox compatibility patches applied to manifest.json')
