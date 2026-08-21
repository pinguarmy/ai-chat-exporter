#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const target = process.argv[2]
if (!['chrome', 'firefox', 'unpacked'].includes(target)) {
  throw new Error('Usage: node scripts/verify-build.js <chrome|firefox|unpacked>')
}

const root = path.join(__dirname, '..')
// Chrome is the default build output. The release script sets BUILD_DIR for
// the isolated Firefox staging directory so both manifests can be verified
// without mutating one another.
const buildDir = path.resolve(root, process.env.BUILD_DIR || 'build/chrome-mv3-prod')
const manifest = JSON.parse(fs.readFileSync(path.join(buildDir, 'manifest.json'), 'utf8'))
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function listFiles(directory, relative = '') {
  return fs.readdirSync(path.join(directory, relative), { withFileTypes: true })
    .flatMap(entry => {
      const child = path.join(relative, entry.name)
      return entry.isDirectory() ? listFiles(directory, child) : [child]
    })
    .sort()
}

function verifyUnpackedMirror() {
  const unpackedDir = path.join(root, 'ai-chat-exporter')
  assert(fs.existsSync(unpackedDir), 'Unpacked extension directory is missing')

  const buildFiles = listFiles(buildDir)
  const unpackedFiles = listFiles(unpackedDir)
  assert(JSON.stringify(unpackedFiles) === JSON.stringify(buildFiles), 'Unpacked extension files drift from the Chrome build')

  for (const relativePath of buildFiles) {
    const buildBytes = fs.readFileSync(path.join(buildDir, relativePath))
    const unpackedBytes = fs.readFileSync(path.join(unpackedDir, relativePath))
    assert(buildBytes.equals(unpackedBytes), `Unpacked extension differs: ${relativePath}`)
  }
}

if (target === 'unpacked') {
  verifyUnpackedMirror()
  console.log('unpacked build verification passed')
  process.exit(0)
}

function linkedStyles(entryHtml) {
  const html = fs.readFileSync(path.join(buildDir, entryHtml), 'utf8')
  const hrefs = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)]
    .map(match => match[1])
  return hrefs.map(href => ({
    href,
    css: fs.readFileSync(path.join(buildDir, href.replace(/^\//, '')), 'utf8')
  }))
}

function verifyFullPage(entryHtml, requiredMarkers) {
  const styles = linkedStyles(entryHtml)
  const popupIndex = styles.findIndex(file => file.css.includes('width:380px'))
  const pageIndex = styles.findIndex(file => file.css.includes('width:auto!important'))
  assert(popupIndex >= 0, `${entryHtml} is missing the shared popup styles`)
  assert(pageIndex > popupIndex, `${entryHtml} must load its full-page override after popup styles`)
  for (const marker of requiredMarkers) {
    assert(styles[pageIndex].css.includes(marker), `${entryHtml} is missing CSS marker: ${marker}`)
  }
}

function verifyRoleLabelUnicode() {
  const javascriptFiles = listFiles(buildDir).filter(relativePath => relativePath.endsWith('.js'))
  const combinedSource = javascriptFiles
    .map(relativePath => fs.readFileSync(path.join(buildDir, relativePath), 'utf8'))
    .join('\n')
  // Plasmo 0.90.5 once optimized the role emoji literals into only their high
  // surrogate (`\\ud83d ` / `\\ud83e `), producing � in every export.
  assert(!/\\ud83[de] /i.test(combinedSource), 'Built role labels contain a truncated emoji surrogate')
  assert(combinedSource.includes('fromCodePoint(128100)'), 'Built user role label is missing its Unicode code point')
  assert(combinedSource.includes('fromCodePoint(129302)'), 'Built assistant role label is missing its Unicode code point')
}

function verifyIcons() {
  for (const size of [16, 32, 48, 64, 128]) {
    const relativePath = manifest.icons?.[String(size)]
    assert(relativePath, `Manifest is missing the ${size}px icon`)
    const file = path.join(buildDir, relativePath)
    const png = fs.readFileSync(file)
    assert(png.toString('ascii', 1, 4) === 'PNG', `${relativePath} is not a PNG`)
    assert(png.readUInt32BE(16) === size && png.readUInt32BE(20) === size, `${relativePath} has wrong dimensions`)
    assert(png.length > 500, `${relativePath} looks like a placeholder icon`)
  }
}

assert(manifest.version === pkg.version, 'Built version does not match package.json')
assert(!manifest.permissions?.includes('tabs'), 'The broad tabs permission must not return')
const contentScriptMatches = (manifest.content_scripts || []).flatMap(script => script.matches || [])
assert(contentScriptMatches.includes('https://chatgpt.com/*'), 'ChatGPT content script match is missing')
assert(contentScriptMatches.includes('https://chat.openai.com/*'), 'Legacy ChatGPT content script match is missing')
verifyIcons()
verifyRoleLabelUnicode()
verifyFullPage('options.html', ['grid-template-columns:repeat(12,minmax(0,1fr))'])
verifyFullPage(path.join('tabs', 'preview.html'), [])

if (target === 'firefox') {
  const gecko = manifest.browser_specific_settings?.gecko
  assert(gecko?.id === pkg.manifest.browser_specific_settings.gecko.id, 'Firefox ID drifted from package.json')
  assert(gecko?.strict_min_version === pkg.manifest.browser_specific_settings.gecko.strict_min_version, 'Firefox minimum version drifted from package.json')
  assert(gecko?.data_collection_permissions?.required?.includes('none'), 'Firefox data collection declaration is missing')
  assert(Array.isArray(manifest.background?.scripts), 'Firefox background.scripts fallback is missing')
}

console.log(`${target} build verification passed`)
