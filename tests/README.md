# Tests

Vitest + jsdom. `npm test` runs everything under `tests/**/*.test.ts(x)`.
The directories mirror the source layers described in `src/README.md`, so a test
lives next to the layer whose behavior it asserts (decide by what it imports and
exercises, not by the bug or sprint that produced it).

| Directory | Exercises | Put a new test here when it covers... |
| --- | --- | --- |
| `core/` | `src/core` pure logic | integrity gates, filenames, scheduling policy, selection, logger. Sub-folders: `export/` (Markdown/HTML/PDF/ZIP exporters, coverage, share copy), `i18n/` (catalogs, typed keys), `snapshot/` (page snapshots, sessions), `preview/` (preview message and sanitizing) |
| `providers/` | `src/providers`, `src/contents` parsers | shared provider plumbing (runtime, fallback, contract, fixtures). Per-provider folders: `chatgpt/`, `claude/`, `gemini/`, `grok/`, `deepseek/` |
| `platform/` | `src/platform` chrome adapters | storage, downloads, recovery drafts, preview cache, workspace session |
| `background/` | `src/background` service worker | message router, scheduled export, download reconciliation |
| `ui/` | components, hooks, pages | `components/`, `popup/` (popup workflow and hooks), `options/`, `tabs/` (preview, recovery) |
| `tooling/` | everything outside `src/` | build/release/publishing contracts, scripts, fixture minimizer/sanitizer, review evidence, package manifest |

Shared support code:

- `fixtures/` captured and synthetic provider payloads and golden exports (never put private chat content here).
- `helpers/` typed test utilities: `chrome-mock.ts` (storage area, runtime listener and response types, download mock types), `fetch-mock.ts` (`fetch`-shaped `vi.fn`), `parser-internals.ts` (named view of private parser members), `claude-api-simulation.ts`, `read-css.ts`.

Conventions:

- Name files after the behavior covered (`export-image-pointer-and-code-fidelity`), never after a cycle, round or bug fix.
- Do not use "live" in the filename of a jsdom or mocked test; nothing here talks to a real provider. `npm run test:browser` needs a prior `npm run build` and does not log into providers.
- Imports of `src/` are relative (`../../src/...`); directory depth decides the number of `../`.
- Tests are type-checked (`npm run typecheck:tests`, part of `npm run lint`) and linted as errors for `no-explicit-any`, unused variables, empty blocks and unsafe `finally`. Use real types, `unknown` plus narrowing, or the helpers above. Prefix a deliberately unused parameter with `_`.
- `tsconfig.tests.json` adds Node types for tests only; `src/` is type-checked against browser types (`tsconfig.json`).
