# AI Chat Exporter

- Preserve provider-specific pagination, message order, and export completeness; do not claim an export is complete from UI state alone.
- Run the narrowest relevant check from this repository: `npm test`, `npm run lint`, or `npm run build`.
- Browser automation may read a logged-in session only when the user has placed that session in scope. Never export cookies, tokens, or private chat content into logs or fixtures.
- Report changed provider paths, verification result, and any provider not live-tested.
