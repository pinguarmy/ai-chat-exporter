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
  return fs
    .readdirSync(path.join(directory, relative), { withFileTypes: true })
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
  assert(
    JSON.stringify(unpackedFiles) === JSON.stringify(buildFiles),
    'Unpacked extension files drift from the Chrome build'
  )

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
  const hrefs = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map(
    match => match[1]
  )
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
  assert(
    !/\\ud83[de] /i.test(combinedSource),
    'Built role labels contain a truncated emoji surrogate'
  )
  assert(
    combinedSource.includes('fromCodePoint(128100)'),
    'Built user role label is missing its Unicode code point'
  )
  assert(
    combinedSource.includes('fromCodePoint(129302)'),
    'Built assistant role label is missing its Unicode code point'
  )
}

function verifyIcons() {
  for (const size of [16, 32, 48, 64, 128]) {
    const relativePath = manifest.icons?.[String(size)]
    assert(relativePath, `Manifest is missing the ${size}px icon`)
    const file = path.join(buildDir, relativePath)
    const png = fs.readFileSync(file)
    assert(png.toString('ascii', 1, 4) === 'PNG', `${relativePath} is not a PNG`)
    assert(
      png.readUInt32BE(16) === size && png.readUInt32BE(20) === size,
      `${relativePath} has wrong dimensions`
    )
    assert(png.length > 500, `${relativePath} looks like a placeholder icon`)
  }
}

// ---------------------------------------------------------------------------
// Bundle size and UI-catalogue guard
//
// Content scripts are injected into every ChatGPT/Claude/Gemini/DeepSeek/Grok
// page and render no UI, so they must not bundle any UI message catalogue.
// Extension pages and the worker ship English only; other locales are separate
// `.catalog` assets that are fetched on demand. The budgets leave ~15% headroom
// over the measured sizes; raise one deliberately when an entry legitimately
// grows.
// ---------------------------------------------------------------------------
const ENTRY_BUDGETS_BYTES = {
  'content script': 90_000,
  'static/background/index.js': 230_000,
  'popup.html': 450_000,
  'options.html': 290_000,
  'tabs/export-workspace.html': 450_000,
  'tabs/preview.html': 730_000,
  'tabs/recovery.html': 330_000
}
const LOCALE_CATALOGUE_BUDGET_BYTES = 40_000
const CATALOGUE_LOCALES = ['zh-CN', 'zh-TW', 'de', 'ja', 'ko']

function toUnicodeEscapes(text) {
  // Parcel's minifier writes non-ASCII as lowercase \uXXXX (UTF-16 code units).
  return text.replace(/[^\x00-\x7f]/g, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'))
}

function readEnglishKeys() {
  const source = fs.readFileSync(path.join(root, 'src/core/i18n/generated/en.ts'), 'utf8')
  const match = source.match(/export const KEYS: readonly string\[\] = (\[[\s\S]*?\n\])/)
  assert(match, 'Could not read the English key list from src/core/i18n/generated/en.ts')
  return JSON.parse(match[1])
}

/** Distinctive catalogue strings: English copy and the zh-CN/ja translations. */
function catalogueMarkers() {
  const keys = readEnglishKeys()
  const probes = ['Bulk Export', 'Export diagnostics', 'Open full export workspace']
  const markers = { english: [], translated: [] }
  for (const key of probes) {
    const index = keys.indexOf(key)
    assert(index >= 0, `Catalogue probe key is gone from the English catalogue: ${key}`)
    markers.english.push(key)
    for (const locale of ['zh-CN', 'ja']) {
      const values = JSON.parse(
        fs.readFileSync(path.join(root, 'src/core/i18n/generated', `${locale}.catalog`), 'utf8')
      )
      assert(values[index], `${locale} has no translation for probe key: ${key}`)
      markers.translated.push(values[index])
    }
  }
  return markers
}

function pageScripts(entryHtml) {
  const html = fs.readFileSync(path.join(buildDir, entryHtml), 'utf8')
  return [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1].replace(/^\//, ''))
}

function sizeOf(relativePath) {
  return fs.statSync(path.join(buildDir, relativePath)).size
}

function verifyBundleSizesAndCatalogues() {
  const contentScripts = [
    ...new Set((manifest.content_scripts || []).flatMap(script => script.js || []))
  ]
  assert(contentScripts.length > 0, 'No content scripts found in the manifest')

  const markers = catalogueMarkers()
  const offenders = []
  const checkSource = (relativePath, allowEnglishCatalogue) => {
    const source = fs.readFileSync(path.join(buildDir, relativePath), 'utf8')
    const lowered = source.toLowerCase()
    for (const text of markers.translated) {
      if (source.includes(text) || lowered.includes(toUnicodeEscapes(text)))
        offenders.push(`${relativePath} contains translated UI copy ${JSON.stringify(text)}`)
    }
    if (!allowEnglishCatalogue) {
      for (const text of markers.english) {
        if (source.includes(text))
          offenders.push(`${relativePath} contains UI catalogue copy ${JSON.stringify(text)}`)
      }
    }
  }
  for (const relativePath of contentScripts) checkSource(relativePath, false)
  // No script may carry a translated catalogue; locales are separate assets.
  for (const relativePath of listFiles(buildDir).filter(file => file.endsWith('.js'))) {
    if (!contentScripts.includes(relativePath)) checkSource(relativePath, true)
  }
  assert(
    offenders.length === 0,
    `UI message catalogue leaked into bundles that must not carry it (content scripts import core/i18n, directly or transitively, or a locale was bundled statically):\n  ${offenders.join('\n  ')}`
  )

  const catalogues = listFiles(buildDir).filter(file => file.endsWith('.catalog'))
  for (const locale of CATALOGUE_LOCALES) {
    assert(
      catalogues.some(file => path.basename(file).startsWith(`${locale}.`)),
      `The ${locale} locale catalogue asset is missing from the build`
    )
  }
  for (const file of catalogues) {
    const values = JSON.parse(fs.readFileSync(path.join(buildDir, file), 'utf8'))
    assert(Array.isArray(values), `${file} is not a catalogue array`)
  }

  const rows = []
  const check = (label, relativePath, budget) => {
    const bytes = sizeOf(relativePath)
    rows.push({ label, file: relativePath, bytes, budget })
  }
  for (const relativePath of contentScripts)
    check('content script', relativePath, ENTRY_BUDGETS_BYTES['content script'])
  check(
    'background',
    manifest.background.service_worker,
    ENTRY_BUDGETS_BYTES['static/background/index.js']
  )
  for (const page of Object.keys(ENTRY_BUDGETS_BYTES).filter(name => name.endsWith('.html'))) {
    for (const script of pageScripts(page)) check(page, script, ENTRY_BUDGETS_BYTES[page])
  }
  for (const file of catalogues) check('locale catalogue', file, LOCALE_CATALOGUE_BUDGET_BYTES)

  console.log(`${target} bundle sizes (uncompressed bytes):`)
  for (const row of rows) {
    console.log(
      `  ${row.label.padEnd(28)} ${row.file.padEnd(44)} ${String(row.bytes).padStart(8)} / ${row.budget}`
    )
  }
  const over = rows.filter(row => row.bytes > row.budget)
  assert(
    over.length === 0,
    `Bundle size budget exceeded:\n  ${over.map(row => `${row.file}: ${row.bytes} > ${row.budget} (${row.label})`).join('\n  ')}`
  )
}

assert(manifest.version === pkg.version, 'Built version does not match package.json')
assert(!manifest.permissions?.includes('tabs'), 'The broad tabs permission must not return')
if (target === 'firefox') {
  assert(
    manifest.permissions?.includes('unlimitedStorage'),
    'Firefox expanded storage permission is missing'
  )
  assert(
    !manifest.optional_permissions?.includes('unlimitedStorage'),
    'Firefox cannot request unlimitedStorage optionally'
  )
} else {
  assert(
    !manifest.permissions?.includes('unlimitedStorage'),
    'Chrome/Edge storage permission must remain optional'
  )
  assert(
    manifest.optional_permissions?.includes('unlimitedStorage'),
    'Optional expanded storage permission is missing'
  )
}
const contentScriptMatches = (manifest.content_scripts || []).flatMap(
  script => script.matches || []
)
assert(
  contentScriptMatches.includes('https://chatgpt.com/*'),
  'ChatGPT content script match is missing'
)
assert(
  contentScriptMatches.includes('https://chat.openai.com/*'),
  'Legacy ChatGPT content script match is missing'
)
verifyIcons()
verifyRoleLabelUnicode()
verifyBundleSizesAndCatalogues()
verifyFullPage('options.html', ['grid-template-columns:repeat(12,minmax(0,1fr))'])
verifyFullPage(path.join('tabs', 'preview.html'), [])

if (target === 'firefox') {
  const gecko = manifest.browser_specific_settings?.gecko
  assert(
    gecko?.id === pkg.manifest.browser_specific_settings.gecko.id,
    'Firefox ID drifted from package.json'
  )
  assert(
    gecko?.strict_min_version === pkg.manifest.browser_specific_settings.gecko.strict_min_version,
    'Firefox minimum version drifted from package.json'
  )
  assert(
    gecko?.data_collection_permissions?.required?.includes('none'),
    'Firefox data collection declaration is missing'
  )
  assert(
    Array.isArray(manifest.background?.scripts),
    'Firefox background.scripts fallback is missing'
  )
}

console.log(`${target} build verification passed`)
