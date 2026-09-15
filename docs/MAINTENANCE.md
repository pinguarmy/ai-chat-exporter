# Maintenance Guide

For releases, start with the [three-store release guide](release-workflow.md).
That document owns the publishing sequence and credential/recovery instructions.

AI Chat Exporter is a Plasmo, React, and TypeScript browser extension. Content
scripts parse supported chat platforms into the shared `Conversation` type.
The Markdown and PDF exporters then render that normalized data.

## Quality gates

Run these commands before every release:

```bash
npm ci
npm test
npm run lint
npm run build
npm run test:browser
```

`npm run test:browser` needs the unpacked Chromium build from
`npm run build`. It loads `ai-chat-exporter/` in Playwright Chromium and
checks that the service worker, popup, options, and preview pages render.
It does not log into providers.

`npm run build` creates three archives: the Chrome/Edge package,
`ai-chat-exporter-firefox.zip`, and `ai-chat-exporter-source.zip`. If
`PLASMO_NO_UPDATE_CHECK` is set (the release default), the build fails
before `plasmo build` when the Plasmo update-check patch is missing.
The source archive is for Firefox AMO source review and is not installable. It uses
`git archive` from the selected tracked Git ref and a top-level
`ai-chat-exporter-<package version>-source/` directory. The tracked
`.gitattributes` applies `export-ignore` to generated/dependency/cache/private
output, including `node_modules`, `build`, `.plasmo`, the generated
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
- Firefox declares no data collection and includes its background script fallback.

Immediately after creating the source archive, the build validates ZIP integrity,
requires exactly the expected versioned top-level root, compares the archived
`package.json` version with the selected ref's version, and rejects forbidden
`.git`, dependency, generated-output, nested-ZIP, TypeScript build-info, and
`.env` paths. A source archive that fails any of these checks fails the build.

## High-risk areas

Platform parsers depend on private web APIs and changing page structure. Check
both API and DOM fallback paths after a platform update. Keep authentication
tokens in `chrome.storage.local`, and send them only to the platform that issued
them.

Options and preview import popup design tokens. The popup stylesheet constrains
the document to 380 pixels and disables overflow. Keep `useFullPageScroll()` and
the page-specific CSS overrides in both full-page routes.

Every UI string belongs in all three locale blocks in `src/lib/i18n.ts`. Use the
`t()` function for strings with interpolation arguments.

## Browser checks

`npm run test:browser` only proves the unpacked MV3 shell loads. It cannot
prove that platform APIs still work. Load `build/chrome-mv3-prod` as an
unpacked extension and check one current conversation, bulk export, live
preview, settings, theme switching, and vertical scrolling. Repeat
platform-specific flows after changing a parser.

## Store assets

Runtime icons live in `assets/`. Final listing images live in `store-assets/`.
Keep promotional PNGs RGB-only and use the exact dimensions in their filenames.
Store screenshots must be 1280 x 800 or 640 x 400.

## 1.3.0 contracts

- `chatgpt-references.ts` normalizes references before marker cleanup; render
  citation spans before any other text transformation so offsets remain valid.
- `ExecutionEvent` is separate from visible messages; `traceCoverage` is not a
  transcript verification flag. Preserve unknown statuses and absent timestamps.
- `settings-store.ts` is the background serialization point for persistent
  settings. Popup overrides remain local until explicitly saved.
- `manual-export-job.ts` owns Markdown bulk queues. Persist the browser download
  ID before waiting, and reconcile completion before retrying after interruption.
  PDF/Save As runs still need the export workspace page alive.
- `export-archive.ts` reports unresolved references and asset limitations and
  hashes every payload. Do not describe URL-only attachments as offline assets.
- Preview snapshots may carry a session settings override; do not accidentally
  persist that override globally or include it in archival metadata.
- Every validated improvement must be committed and synchronized to main per
  AGENTS.md. Archive tags retain old branch tips; they are not release versions.
