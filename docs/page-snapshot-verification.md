# Page snapshot and recovery verification

## Delivered scope

Gemini has a dedicated observed-DOM capture command, immutable capture identity, copy/Markdown/PDF actions, and an exact-ID preview. Local recovery is opt-in, current-session scoped, bounded, and independently managed. Neither path registers a complete archive or advances scheduled export checkpoints. Other providers retain their existing full export paths; manual page capture currently reports unsupported there.

The implementation uses the existing extension permissions. Recovery bodies are whitelist rebuilt before storage, content fingerprints are SHA-256 rather than duplicated transcript text, and an indexed slot reservation protects cleanup across interrupted writes. Settings and credentials are not cleared by draft deletion. The three conversation caches have separate body budgets: legacy preview 2 MiB, page preview 2 MiB, recovery 4 MiB; other extension storage can still cause quota failures.

## Automated evidence

- Full Vitest suite: **85 files, 1,022 tests passed**.
- TypeScript: `npm run lint` passed.
- Production dependency audit: `npm audit --omit=dev` reported zero vulnerabilities.
- Chrome/Edge and Firefox build artifacts passed their manifest/bundle checks.
- Isolated Chromium extension smoke passed: existing popup/options/preview and bulk/archive paths; two independent page captures and exact runtime retrieval; mandatory unverified scope notice; actual Markdown and PDF downloads; synthetic recovery opt-in, persisted checkpoint, exact selection/preview, actual recovered Markdown download, stop, and confirmed deletion.
- Synthetic regression coverage includes hidden descendants and inactive branches, unsent drafts, one-sided/streaming content, navigation and regeneration identity boundaries, corrupted envelopes, settings-filtered empty output, heuristic share redaction, fixed-preview privacy-option mismatch rejection, storage interruption/failure, expiry, total byte limits, worker reload versus browser startup, and deletion/clear versus late writes and pending initial captures.

The browser smoke uses a fresh isolated profile and synthetic data. For recovery it replaces the content-script tab transport with in-memory responses; background messages, local persistence, extension page rendering, download acknowledgements, and downloaded files are real. It does **not** exercise the Gemini content script against the current provider website.

## Not verified or not performed

- No signed-in provider sessions were opened or read. Gemini history-off and current production DOM behavior still need explicitly scoped login testing. Other providers were not live-tested either.
- Firefox and Edge artifacts were built and checked; their native browser execution was not tested in this task.
- The snapshots do not prove full history completeness, recover unloaded turns, re-create provider conversations, or embed all remote assets. External images may request their host and may fail offline.
- Share redaction is heuristic. Remaining private text requires user review.
- No store submission, release/version bump, account setting change, or GitHub Issue #19 reply was performed.

Usage and retention details: [Page snapshots and local recovery](page-snapshots.md). Storage disclosure: [Privacy Policy](../PRIVACY.md).
