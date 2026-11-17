# Maintenance Guide

For releases, start with the [three-store release guide](release-workflow.md).
That document owns the publishing sequence and credential/recovery instructions.

AI Chat Exporter is a WXT (Vite), React, and TypeScript browser extension. Content
scripts parse supported chat platforms into the shared `Conversation` type.
The Markdown and PDF exporters then render that normalized data.

## Quality gates

Run these commands before every release:

```bash
npm ci
npm test
npm run lint
npm run test:services
npm run build
npm run lint:firefox
npm run test:browser
```

## CI layout

`ci.yml` runs three independent jobs in parallel, and `verify` (named `Test, lint, and build`,
the check to require on `main`) fails unless all three succeed:

| Job | Runs |
| --- | --- |
| `unit` | `npm run test:coverage` (the whole suite once, with thresholds) and the `coverage-report` artifact |
| `static` | `npm run lint` (typecheck, test typecheck, ESLint, Prettier), `npm run test:services`, `npm audit --omit=dev --audit-level=high` |
| `package` | `npm run build`, `npm run lint:firefox`, Playwright Chromium and Poppler, `npm run test:browser:parallel` |

Caching: `.github/actions/setup-project` restores `node_modules` keyed on OS, architecture, exact
Node version and the hash of `package-lock.json` plus `patches/`. A hit skips `npm ci` (patch-package
output is inside the cache) and only runs `npx wxt prepare`; a miss runs `npm ci`. The `package` job
caches `~/.cache/ms-playwright` per Playwright version. `playwright install-deps chromium` still runs
every time, because it installs the CJK, Thai and emoji fonts the multilingual PDF regression needs;
Poppler then installs with `--no-install-recommends` from the same apt lists. Docs-only changes still run every
job because tests under `tests/tooling` read docs, workflows and scripts.

`release.yml` runs the same checks sequentially before any tag or publishing step, runs the suite once
through the coverage gate, runs the smoke scripts one at a time (`npm run test:browser`), and caches
no executables because that job holds publishing secrets.

`npm run test:browser:parallel` (`scripts/run-browser-smoke.mjs`) runs the same four smoke scripts
concurrently. They use separate temp profiles, download and evidence directories, so do not make
them share fixed paths or ports.

`npm run lint:firefox` runs `web-ext lint` (the `web-ext` devDependency) on the staged
`build/firefox-mv3` package through `scripts/lint-firefox.mjs`, so it needs a prior
`npm run build`. It fails on any error and on any warning that is not a documented exception;
CI and the release workflow run it right after the build. At the last check it reported 0 errors
and 8 accepted warnings, all documented with reasons in `KNOWN_WARNINGS` in that script
(file patterns match WXT chunk names under `chunks/`):

- `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION`: `strict_min_version` 140 predates Firefox for
  Android support for `data_collection_permissions` (142). Raising the minimum drops users, so it
  is a maintainer decision.
- `DANGEROUS_EVAL` in the bundled core-js `Function("return this")()` global fallback.
- `UNSAFE_VAR_ASSIGNMENT` for `innerHTML` in bundled React DOM, html2canvas, jsPDF and DOMPurify,
  and in the offscreen PDF container in `src/core/export-pdf.ts`, which only receives markup that
  is escaped or sanitized where it is generated.

A new warning code, or an accepted code in a new file, fails the check. Fix the cause or add a
justified entry to `KNOWN_WARNINGS`, and update this list.

`npm run test:browser` needs the unpacked Chromium build from
`npm run build`. It loads `ai-chat-exporter/` in Playwright Chromium and
checks that the service worker, popup, options, and preview pages render.
It does not log into providers. A separate native-download smoke uses a temporary browser profile and Chrome's default download behavior to verify real same-path scheduled overwrite, fresh content, overwrite opt-out, and the full-ID/last-message filename tokens. Playwright's normal `allowAndName` download interception assigns UUID filenames and cannot prove filesystem replacement; do not use those paths as overwrite evidence.

`npm run lint` runs four checks in order: `npm run typecheck` (`tsc --noEmit` for `src/`,
browser and `chrome` types only), `npm run typecheck:tests` (`tsconfig.tests.json`, adds Node
and Vitest types), `npm run lint:eslint` (ESLint 9 flat config in `eslint.config.mjs`), and
`npm run format:check` (Prettier with `.prettierrc.json`). Typechecking runs with `strict: true`,
`noImplicitOverride` and `noFallthroughCasesInSwitch` (set explicitly in `tsconfig.json`, which extends the
WXT-generated `.wxt/tsconfig.json`; `npm ci` runs `wxt prepare` to create it) and rejects unused locals and
parameters.
`noUncheckedIndexedAccess` is deliberately off: enabling it currently reports about 130 errors in
`src/` and 480 in `tests/`, concentrated in the export renderers and provider fallbacks. ESLint runs every rule as an error, including the layer boundaries described
in `src/README.md`: `src/core` may not use `chrome.*` or import platform, provider, UI or
background code. The Prettier reformat commit is listed in `.git-blame-ignore-revs`.
`npm run test:services` runs the feedback backend tests and needs Node 22.5 or newer
(`node:sqlite`); CI and `.nvmrc` use Node 22. Shared
API timestamp normalization lives in `api-message-normalizer.ts`; provider
pagination and branch-selection rules remain provider-specific.

`npm run build` creates three archives: the Chrome/Edge package,
`ai-chat-exporter-firefox.zip`, and `ai-chat-exporter-source.zip`. The build runs `wxt build -b chrome` and `wxt build -b firefox` (configuration in `wxt.config.ts`,
output in `build/chrome-mv3` and `build/firefox-mv3`); there is no post-build manifest patching.
The source archive is for Firefox AMO source review and is not installable. It uses
`git archive` from the selected tracked Git ref and a top-level
`ai-chat-exporter-<package version>-source/` directory. The tracked
`.gitattributes` applies `export-ignore` to generated/dependency/cache/private
output, including `node_modules`, `build`, `.wxt`, the generated
`/ai-chat-exporter` mirror, ZIPs, TypeScript build-info files, and `.env`
variants. Untracked files are not included by `git archive`. Set
`SOURCE_ARCHIVE_REF` to override the source ref when reproducible tagged
packaging is needed.

The browser-package verifier checks:

- package and manifest versions match;
- the broad `tabs` permission is absent;
- 16, 32, 48, 64, and 128 pixel icons are real PNGs, not placeholders;
- options and preview load their full-page CSS after shared popup styles;
- Firefox keeps the package-defined ID and minimum version;
- every extension page URL the code opens exists at its published path (`popup.html`, `options.html`,
  `tabs/preview.html`, `tabs/recovery.html`, `tabs/export-workspace.html`);
- locale catalogs ship as `catalogs/<locale>.catalog` files and are never embedded in a script as data
  URIs (Vite inlines assets into library-mode bundles such as the background worker);
- each HTML page's static script graph (entry script plus preloaded shared chunks) and each background and
  content script stays within its size budget;
- Firefox declares no data collection and uses `background.scripts` (WXT emits the MV3 event-page form).

## Build tooling (WXT)

- `wxt.config.ts` is the single build configuration. The manifest identity (permissions, optional and
  host permissions, locale, homepage, Firefox gecko id and minimum version) is read from the `manifest`
  field of `package.json`; the config derives the browser differences: Firefox declares
  `unlimitedStorage` at install time (it cannot be optional there) and carries the gecko settings and
  data-collection declaration, Chrome/Edge keep it optional and carry no gecko settings.
- Entrypoints live in `src/entrypoints/`: `background.ts`, one `*.content.ts` per provider (matches and
  `run_at`; each loads the parser module in `src/contents/`, which starts itself when evaluated) and
  one folder per HTML page (`popup`, `options`, `preview`, `recovery`, `export-workspace`). A hook in
  `wxt.config.ts` publishes the last three as `tabs/<name>.html`.
- `public/` is copied verbatim: `icon/<size>.png` (16, 32, 48, 64, 128; the bytes Plasmo generated from
  `assets/icon.png`, so store icons did not change) and `_locales/` (the `__MSG_*__` strings). UI locale
  catalogs from `src/core/i18n/generated/` are copied to `catalogs/` by the config.
- `wxt prepare` generates `.wxt/` (types and the base tsconfig) and runs from `postinstall`.
- `npm run dev` / `npm run dev:firefox` start WXT dev mode (it opens a browser with the extension
  loaded; output goes to `build/<browser>-mv3-dev`).
- A WXT upgrade should be followed by `npm run build`, `npm run lint:firefox` and `npm run test:browser`;
  compare the manifests of both browsers with the previous build (only file paths may change).
- Only `patches/jspdf+4.2.1.patch` (patch-package) remains as an installed-dependency patch.


Immediately after creating the source archive, the build validates ZIP integrity,
requires exactly the expected versioned top-level root, compares the archived
`package.json` version with the selected ref's version, and rejects forbidden
`.git`, dependency, generated-output, nested-ZIP, TypeScript build-info, and
`.env` paths. A source archive that fails any of these checks fails the build.

## Provider canary (live provider invariants)

Every other test is mocked or fixture-based, so none of them notices when a
provider changes its site or API. `npm run canary:providers` runs the built
extension's real content-script paths against your own logged-in provider
sessions and checks invariants only. Run it locally, never in CI: it needs your
own browser profile and must never see a CI secret or a shared runner.

**When to run it:** before every store release, and after any provider incident
or user report that an export is wrong, short or blocked. Record in the release
notes which providers were live-tested and which were not.

### One-time setup and a run

```bash
npm run build
npx playwright install chromium
# Use a dedicated directory, outside this repository and not your everyday browser profile.
npm run canary:providers -- --setup --profile ~/canary-profile    # log in to each provider, close the window
npm run canary:providers -- --profile ~/canary-profile --out ~/canary-out
```

`--profile <dir>` is required; the canary refuses to run without it, and also
refuses a profile inside this repository, an everyday browser profile path, a
profile already open in a browser, or an `--out` inside the profile. The profile
is used in place, never copied, and the canary only sends the same read
requests the extension makes (history list and conversation detail). Closing
tabs restored from the profile does not touch the session. Playwright's
Chromium needs a headed window to load the extension; `--headless` is available
but providers may block it.

Useful options: `--providers chatgpt,claude` to limit the run;
`--conversation chatgpt=<url>` to test a conversation you choose instead of the
most recent one in each provider's own list (the URL is validated against the
provider host and is never printed or stored); `--require-all` to fail when a
requested provider is skipped (use this before a release);
`--timeout-ms` and `--list-timeout-ms` for slow accounts.

### Reading the report

The run writes `provider-canary-report.json` and `provider-canary-report.txt`
to `--out` and prints the table. Exit code: `0` all logged-in providers passed,
`1` an invariant failed, `2` usage or environment error, `3` `--require-all` and a
provider was skipped.

Each provider has an overall status and these checks, each `PASS`, `FAIL` or
`SKIPPED`:

| Check                 | Invariants                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `detect_home`         | content script answers `DETECT_PLATFORM` with the expected platform                                                   |
| `session`             | an API history list was returned (logged in). A login redirect or `authRequired` is `SKIPPED not_logged_in`           |
| `list_first_page`     | list from the provider API (not the sidebar), non-empty, every item has an ID, platform and provider URL, unique IDs  |
| `list_pagination`     | pagination terminated (`complete`), page count consistent with the item total and page size (exact-multiple boundary) |
| `detect_conversation` | on the conversation page the platform matches and `isConversationPage` is true                                        |
| `current_parse`       | `PARSE_CONVERSATION` returns an exportable conversation: roles valid, IDs unique, integrity status and reason codes   |
| `detail_fetch`        | `FETCH_CONVERSATION_DETAIL` returns the same conversation, exportable and provider-verified                           |
| `order_agreement`     | current-page parse and API detail agree on message count, role sequence and per-position content (counts only)        |
| `markdown_export`     | the in-memory Markdown export is non-empty and keeps most of the user/assistant text                                  |

A skipped provider shows the reason (`not_logged_in`, `rate_limited`,
`upstream_failed`, `parse_source_is_api`). A skipped check is not evidence.
`order_agreement` is skipped when the parse already came from the provider API,
because the two sides would not be independent. A `FAIL` names the failed
invariant (for example `transcript_unverified` or `page_count_inconsistent_with_total`)
or an error class, never a message.

The report holds only fixed vocabulary, counts, role-sequence shape (counts of
user/assistant turns, role switches, longest run), integrity and verification
status with reason codes, list page sizes and durations. It never contains
conversation text, titles, IDs, URLs, account details, cookies or tokens, and
hashes nothing. As a final guard the script compares the output with the real
values it handled in memory and refuses to write the report if any appear.

### What a result means

- **A PASS is evidence for that provider only**, for that account, those
  conversations and that moment. It does not cover the other providers, other
  account types or long-tail conversation shapes. State live-tested versus
  not-live-tested providers every time.
- The checks are invariants, not a proof of completeness. The order and
  Markdown checks are heuristics (normalized content prefixes, a 60% text
  retention floor); investigate a failure before assuming a regression, and
  re-run once to rule out a timing or rate-limit blip.
- `list_empty` or `session_unconfirmed` on a logged-in account means the list
  path is broken or the session is gone; log in again with `--setup` first.
- When the canary finds a provider shape change, capture a sanitized fixture
  (see [provider fixture privacy](provider-fixture-privacy.md)) rather than
  copying anything from the report or the live page.

The invariant logic lives in `scripts/lib/provider-canary.mjs` and is unit-tested
with synthetic input in `tests/tooling/provider-canary.test.ts`. Those tests do
not log in and prove nothing about a provider.

## High-risk areas

Platform parsers depend on private web APIs and changing page structure. Check
both API and DOM fallback paths after a platform update. Keep authentication
tokens in `chrome.storage.local`, and send them only to the platform that issued
them.

Options and preview import popup design tokens. The popup stylesheet constrains
the document to 380 pixels and disables overflow. Keep `useFullPageScroll()` and
the page-specific CSS overrides in both full-page routes.

Every UI string belongs in all three locale blocks in `src/core/i18n/locales/`. Use the
`t()` function for strings with interpolation arguments.

## Browser checks

`npm run test:browser` only proves the unpacked MV3 shell loads. It cannot
prove that platform APIs still work. Load `build/chrome-mv3` as an
unpacked extension and check one current conversation, bulk export, live
preview, settings, theme switching, and vertical scrolling. Repeat
platform-specific flows after changing a parser.

## Store assets

Runtime icons live in `public/icon/` (`assets/icon.png` is the 1024px master). Final listing images live in `store-assets/`.
Keep promotional PNGs RGB-only and use the exact dimensions in their filenames.
Store screenshots must be 1280 x 800 or 640 x 400.

## 1.3.0 contracts

- `chatgpt-references.ts` normalizes references before marker cleanup; render
  citation spans before any other text transformation so offsets remain valid.
- `export-assets.ts` owns upload filtering and artifact/reference selection for
  Markdown, HTML/PDF and preview. Keep privacy decisions out of each renderer.
- `export-html.ts` produces safe HTML and print styles without depending on PDF
  layout or browser downloads. `export-pdf.ts` owns PDF layout, fonts and text
  layers; its HTML re-exports preserve existing callers.
- `export-options.ts` maps interactive settings to renderer options.
  `exportConversationFile()` in `platform/export-download.ts` owns interactive filename,
  format dispatch and completed-download history. UI code owns progress and
  feedback. Preview may supply its displayed Markdown; bulk keeps its item index
  and PDF rendering mode. PDF libraries remain lazy-loaded.
- `providers/parser-runtime.ts` narrows supported request/response shapes and validates
  provider requests before dispatch. Pagination and branch selection stay in the
  individual provider parsers.
- `ExecutionEvent` is separate from visible messages; `traceCoverage` is not a
  transcript verification flag. Preserve unknown statuses and absent timestamps.
- `platform/settings-store.ts` is the background serialization point for persistent
  settings. Popup overrides remain local until explicitly saved.
- `platform/manual-export-job.ts` (pure job types and payload builder in `core/manual-export-job.ts`) owns Markdown bulk queues. Persist the browser download
  ID before waiting, and reconcile completion before retrying after interruption.
  Failed startup reads/reconciliation are retried by the next job start.
  PDF/Save As runs still need the export workspace page alive.
- `platform/export-history.ts` serializes history writes and clears. Commit each record
  and its dedup ID in one storage write before retention cleanup.
- `pending-downloads.ts` retains scheduled download IDs with their history
  records independently of the active run. Failed cancellation or history writes
  leave them reconcilable; late completion events, cleanup alarms, and the next
  run retry reconciliation. A new scheduled run waits while downloads remain
  uncertain, preventing duplicate output. Timeout/abort waits for cancellation
  acknowledgement, which by itself is not evidence of download completion.
- `scheduled-run-resources.ts` owns persisted scheduled-run tab/download IDs and
  restart cleanup. The background worker retains scheduling and its single-flight
  guard; resource registration still precedes provider/download work.
- `export-archive.ts` reports unresolved references and asset limitations and
  hashes every payload. Do not describe URL-only attachments as offline assets.
- Preview snapshots may carry a session settings override; do not accidentally
  persist that override globally or include it in archival metadata.
- Every validated improvement must be committed and synchronized to main per
  AGENTS.md. Archive tags retain old branch tips; they are not release versions.
