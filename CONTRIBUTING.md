# Contributing to AI Chat Exporter

Thanks for your interest! Here's how to get started.

## Quick Start

```bash
git clone https://github.com/pinguarmy/ai-chat-exporter.git
cd ai-chat-exporter
npm ci
npm test
npm run lint
```

## Development

```bash
npx plasmo dev        # Watch mode with hot reload
npm test              # Run the full suite
npm run lint          # TypeScript check
npm run build         # Verified browser and source packages
npm run test:browser  # Unpacked Chromium smoke (after build; no provider login)
```

## Pull Request Process

1. Fork the repo
2. Create a branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run tests: `npm test`
5. Verify: `npm test && npm run lint && npm run build`
6. Commit: `git commit -m 'Add my feature'`
7. Push: `git push origin feature/my-feature`
8. Open a PR

## Code Style

- TypeScript with strict mode
- Functional React components with hooks
- CSS custom properties (no Tailwind)
- JSDoc comments on public functions
- All changes need tests

## Documentation

- [docs/README.md](docs/README.md) indexes every document and marks it as living or historical.
- [docs/MAINTENANCE.md](docs/MAINTENANCE.md) covers architecture, verification, and release checks.
- Provider fixtures must follow [docs/provider-fixture-privacy.md](docs/provider-fixture-privacy.md).

## Good First Issues

HTML export, Markdown/PDF export, bulk conversation search, the Firefox listing, and scheduled export already ship. Open areas:

- Expand captured-provider citation and tool-trace coverage
- Syntax highlighting in PDF exports
- Notion/Obsidian integration
- Regression coverage for popup lifecycle and concurrent settings changes

## Questions?

Open a [Discussion](https://github.com/pinguarmy/ai-chat-exporter/discussions) or an [Issue](https://github.com/pinguarmy/ai-chat-exporter/issues).
