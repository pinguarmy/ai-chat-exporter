# AI Chat Exporter

- Preserve provider-specific pagination, message order, and export completeness; do not claim an export is complete from UI state alone.
- Run the narrowest relevant check from this repository: `npm test`, `npm run lint`, or `npm run build`.
- Browser automation may read a logged-in session only when the user has placed that session in scope. Never export cookies, tokens, or private chat content into logs or fixtures.
- Report changed provider paths, verification result, and any provider not live-tested.
- No unverified provider transcript may be presented as a complete archive.
- Provider-authoritative message ordering cannot be replaced by DOM order.
- DOM may enrich authoritative messages only after confident matching.
- Unknown connector references are private by default.
- Failures must explain the failed invariant without logging private content.
- Passing unit tests alone is not evidence that provider integrations currently work. Report live-tested vs not-live-tested providers.
- Provider parser refactors must preserve captured-real-fixture behavior before live testing.
- Do not use "live" in test filenames for jsdom/mocked tests.
