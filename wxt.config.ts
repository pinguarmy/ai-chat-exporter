import { readdirSync } from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'wxt'
import pkg from './package.json'

/**
 * WXT build configuration.
 *
 * The manifest identity (permissions, host permissions, Firefox gecko id and
 * minimum version, locale, homepage) lives in the `manifest` field of
 * package.json so that `scripts/verify-build.js` and the manifest contract
 * tests check the exact same source this file builds from.
 *
 * Output layout (build/<browser>-mv3/) is consumed by scripts/build-all.sh,
 * scripts/verify-build.js, scripts/lint-firefox.mjs and the browser smoke tests.
 */

const CATALOG_DIR = path.resolve(__dirname, 'src/core/i18n/generated')

const {
  browser_specific_settings: browserSpecificSettings,
  optional_permissions,
  ...shared
} = pkg.manifest

/** Extension pages that must keep their historical `tabs/<name>.html` URLs. */
const TAB_PAGES = new Set(['export-workspace', 'preview', 'recovery'])

export default defineConfig({
  srcDir: 'src',
  outDir: 'build',
  modules: ['@wxt-dev/module-react'],
  // Imports stay explicit (see src/README.md); no auto-import globals.
  imports: false,
  // WXT defaults Firefox to MV2; this extension ships MV3 everywhere.
  manifestVersion: 3,
  manifest: ({ browser }) => {
    const firefox = browser === 'firefox'
    return {
      name: pkg.displayName,
      description: pkg.description,
      author: pkg.author,
      ...shared,
      // Firefox does not support unlimitedStorage as an optional permission, so it
      // is declared at install time there. The application still requires explicit
      // opt-in to expanded recovery storage and keeps its default limits until then.
      permissions: firefox ? [...shared.permissions, 'unlimitedStorage'] : shared.permissions,
      optional_permissions: firefox ? [] : optional_permissions,
      // Chrome/Edge store manifests have never carried Gecko settings.
      ...(firefox && {
        browser_specific_settings: {
          gecko: {
            ...browserSpecificSettings.gecko,
            data_collection_permissions: { required: ['none'] }
          }
        }
      })
    }
  },
  hooks: {
    // UI locale catalogues are plain assets fetched on demand by core/i18n from
    // /catalogs/<locale>.catalog (see the note in src/core/i18n/index.ts).
    'build:publicAssets': (_wxt, files) => {
      for (const name of readdirSync(CATALOG_DIR).filter(file => file.endsWith('.catalog'))) {
        files.push({ absoluteSrc: path.join(CATALOG_DIR, name), relativeDest: `catalogs/${name}` })
      }
    },
    // The popup <title> stays (it is the page title); the manifest keeps the
    // browser's own default action tooltip, which is the localized extension name.
    'build:manifestGenerated': (_wxt, manifest) => {
      if (manifest.action) delete manifest.action.default_title
    },
    // The three full-page tools are published under tabs/ (tabs/preview.html,
    // tabs/recovery.html, tabs/export-workspace.html). Code and smoke tests open
    // those URLs, so they are part of the extension's runtime contract.
    'entrypoints:found': (_wxt, infos) => {
      for (const info of infos) {
        if (info.type === 'unlisted-page' && TAB_PAGES.has(info.name)) {
          info.name = `tabs/${info.name}`
        }
      }
    }
  }
})
