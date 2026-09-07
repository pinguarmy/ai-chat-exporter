# Maintenance Guide

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
```

`npm run build` creates Chrome/Edge and Firefox archives. Its verifier checks:

- package and manifest versions match;
- the broad `tabs` permission is absent;
- 16, 32, 48, 64, and 128 pixel icons are real PNGs, not placeholders;
- options and preview load their full-page CSS after shared popup styles;
- Firefox keeps the package-defined ID and minimum version;
- Firefox declares no data collection and includes its background script fallback.

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

Automated tests cannot prove that platform APIs still work or that the extension
looks correct in Chrome. Load `build/chrome-mv3-prod` as an unpacked extension and
check one current conversation, bulk export, live preview, settings, theme
switching, and vertical scrolling. Repeat platform-specific flows after changing
a parser.

## Store assets

Runtime icons live in `assets/`. Final listing images live in `store-assets/`.
Keep promotional PNGs RGB-only and use the exact dimensions in their filenames.
Store screenshots must be 1280 x 800 or 640 x 400.
