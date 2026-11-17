# Source layout

Shared code is layered by directory; ESLint (`eslint.config.mjs`) enforces the
two rules that matter most. Each layer could later become its own package.

| Layer | Contains | May import |
| --- | --- | --- |
| `core/` | Pure, platform-independent logic: `Conversation` model and types, integrity/verification, references, selection/scope, filename, Markdown/HTML/PDF-blob/archive/share-redaction exporters, i18n, pure job/run state | `core/` only. No `chrome.*` (error). DOM is allowed only where inherent to rendering (HTML/PDF). |
| `providers/` | Provider-specific and parser-shared code: parser runtime, parser fallback, provider APIs (Grok, Gemini, ...), message normalizers, provider errors and reads | `core/`, `platform/`. Never `components/`, `hooks/`, `background/` (error). |
| `platform/` | Browser-extension adapters that touch `chrome.*`: settings store, downloads, export history, recovery drafts, snapshot cache, workspace session, the typed background message contract and `sendBackgroundMessage`, support/uninstall URL | `core/`, `providers/` types where needed. |
| `hooks/` | React hooks shared by pages (`use-*.ts`) | `core/`, `platform/`. |
| `components/`, `popup.tsx`, `options.tsx`, `tabs/` | UI (page components, mounted by `entrypoints/*/main.tsx`) | anything below |
| `background/`, `contents/` | Service worker modules and content-script parsers, started from `entrypoints/` | anything below |
| `entrypoints/` | WXT entrypoints: manifest options and thin wiring only | anything |

## Where new code goes

- No `chrome.*` and no provider knowledge: `core/`.
- Needs `chrome.*` (storage, downloads, tabs, runtime messaging): `platform/`.
  If the logic can be separated, keep the pure part in `core/` and inject the
  chrome-dependent function (see `core/manual-export-job.ts`,
  `core/scheduled-run-state.ts`, `platform/export-pdf-download.ts`).
- Understands one provider's API or DOM, or is shared by the parsers: `providers/`.
- Requests to the background worker: add the message to `BackgroundMessageSpec`
  in `platform/background-messages.ts` and call `sendBackgroundMessage`; do not
  call `chrome.runtime.sendMessage` directly for background requests.

## WXT constraints

Everything under `entrypoints/` is an entrypoint (or a page's `main.tsx`); never put shared
modules there. WXT also evaluates entrypoint files in Node to read their options, so they must
not run extension code at module level: the background wires itself in `defineBackground`
(`background/start.ts`) and each content entry loads its parser module from `main()`. The
background worker must register event listeners synchronously inside that function.

Pages are `entrypoints/<name>/index.html` + `main.tsx`, which calls `mountPage(Component)`; the
mount element is `#root`. `preview`, `recovery` and `export-workspace` are published as
`tabs/<name>.html` by a hook in `wxt.config.ts`, so code and tests keep opening those URLs.
The manifest comes from `wxt.config.ts` and the `manifest` field of `package.json`.

## i18n loading

Developers edit the per-locale source files in `core/i18n/locales/` (English
keys are the `MessageKey` type). `npm run i18n:generate` (run by `predev`,
checked by `npm run build` and a unit test) compiles them into
`core/i18n/generated/`: English (key text once) ships with every page, and every
other locale is a values-only UTF-8 asset (`*.catalog`, a JSON array aligned with
the English keys) fetched by `loadLocale()` from `/catalogs/<locale>.catalog`
(`wxt.config.ts` copies the generated files there). Assets rather than bundler JS chunks
because the Firefox background page has no `importScripts`, and they are not referenced
through `new URL(..., import.meta.url)` because Vite inlines every asset into library-mode
bundles such as the background worker.

- UI pages `await loadLocale(settings.locale)` where they load settings, before
  first render. Code that builds exported documents (`platform/export-download`,
  `platform/snapshot-download`, scheduled exports in the background worker)
  awaits `loadLocale(options.locale)` first. A missing chunk leaves English in
  effect; `loadLocale` never rejects.
- Content scripts render no UI and must never import `core/i18n` (directly or
  transitively): they would bundle the English catalogue, and the catalog
  assets are not web-accessible. `scripts/verify-build.js` fails the build if they do.
