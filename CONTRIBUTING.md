# Contributing to AI Chat Exporter

Thanks for your interest! Here's how to get started.

Where to look: [README](README.md) for what the project is, [docs/user-guide.md](docs/user-guide.md) for the user-facing behavior you are changing, [GUIDE.md](GUIDE.md) for architecture and the provider data-integrity rules, and this file for workflow and commands.

## Quick Start

```bash
git clone https://github.com/pinguarmy/ai-chat-exporter.git
cd ai-chat-exporter
npm ci
npm test
npm run lint
```

## Development

Use Node 22 (see `.nvmrc`). npm enforces the supported range through `devEngines`.

```bash
npm run dev            # Plasmo watch mode with hot reload
npm test               # Vitest unit and jsdom suite
npm run lint           # Typecheck src and tests, ESLint, Prettier check
npm run format         # Apply Prettier formatting
npm run test:services  # Feedback Worker tests (Node 22.5+)
npm run test:coverage  # Coverage floors: global plus per-file gate for core contract modules
npm run build          # Verified Chrome, Firefox and source packages
npm run lint:firefox   # web-ext lint of the Firefox package (after build)
npm run test:browser   # Unpacked Chromium smoke (after build; no provider login)
```

Source code is layered: `src/core` holds pure logic and must not use `chrome.*`, `src/providers` holds provider parsers, `src/platform` holds browser-extension adapters, and UI lives in `src/components`, `src/hooks` and the Plasmo entry points. ESLint enforces these boundaries. See [src/README.md](src/README.md). Tests mirror that layout; see [tests/README.md](tests/README.md).

## Build and load

`npm run build` creates three archives (verified by the build): `ai-chat-exporter.zip` (Chrome Web Store and Edge Add-ons), `ai-chat-exporter-firefox.zip` (Firefox Add-ons) and `ai-chat-exporter-source.zip` (Firefox AMO source review; not installable). The build fails if the manifest regains the broad `tabs` permission, a full-page route loses its scroll/layout override, or an extension icon is missing or looks like a placeholder.

To load the Chrome/Edge build, open `chrome://extensions/`, enable Developer mode, choose **Load unpacked** and select `build/chrome-mv3-prod/`. For `npm run dev`, load the dev build folder Plasmo reports (normally `build/chrome-mv3-dev/`). `npm run test:browser` runs against the built extension in Playwright Chromium; install it once with `npx playwright install chromium`. See [docs/MAINTENANCE.md](docs/MAINTENANCE.md) for the full verification and manual browser checklist.

Publishing to the stores is a maintainer task; start with [docs/release-workflow.md](docs/release-workflow.md).

## Pull Request Process

1. Fork the repo
2. Create a branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run tests: `npm test`
5. Verify: `npm test && npm run lint && npm run build && npm run lint:firefox`, plus `npm run test:browser` for UI or background changes
6. Commit: `git commit -m 'Add my feature'`
7. Push: `git push origin feature/my-feature`
8. Open a PR

## Code Style

- TypeScript with `strict: true` (plus `noImplicitOverride` and `noFallthroughCasesInSwitch`) in `tsconfig.json`, inherited by `tsconfig.tests.json`; no `any` in source or tests. `noUncheckedIndexedAccess` is not enabled yet
- Prettier formatting (`npm run format`), checked by `npm run lint`
- Functional React components with hooks
- CSS custom properties (no Tailwind)
- JSDoc comments on public functions
- All changes need tests

## Documentation

- [docs/README.md](docs/README.md) indexes every document and marks it as living or historical.
- [docs/MAINTENANCE.md](docs/MAINTENANCE.md) covers architecture, verification, and release checks.
- Provider fixtures must follow [docs/provider-fixture-privacy.md](docs/provider-fixture-privacy.md).

## Good First Issues

Markdown, PDF and ZIP archive export, bulk conversation search, the Firefox listing, and scheduled export already ship. Open areas:

- Standalone HTML export (an HTML renderer already exists in `src/core/export-html.ts` for PDF and preview)
- Expand captured-provider citation and tool-trace coverage
- Syntax highlighting in PDF exports
- Notion/Obsidian integration
- Regression coverage for popup lifecycle and concurrent settings changes

## Questions?

Open a [Discussion](https://github.com/pinguarmy/ai-chat-exporter/discussions) or an [Issue](https://github.com/pinguarmy/ai-chat-exporter/issues).
