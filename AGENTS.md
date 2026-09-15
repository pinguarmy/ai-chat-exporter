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
- `npm run test:browser` requires a prior `npm run build` and does not log into providers.

## Main branch delivery rule

- The user requires every beneficial, validated project change to be committed and synchronized to `main` and `origin/main` as part of the task. Do not leave completed improvements uncommitted or stranded on a feature branch.
- Work in small reviewable commits. Run relevant tests before committing; run the full release checks before final delivery. If branch protection requires a PR, open it and complete the merge after checks pass.
- Fetch before integrating. Preserve unrelated work, resolve conflicts by behavior and tests, and never force-push `main`.
- Retire obsolete branches only after confirming ancestry, patch/tree equivalence, or preserving a recoverable archive reference. Do not merge obsolete code merely to make Git ancestry look clean.
- End with a clean working tree and local/remote `main` at the same commit. If checks, permissions, or external services block this, report the exact blocker and preserved work; do not claim synchronization succeeded.
- Publishing store releases remains a separate operation from committing and synchronizing source code.
