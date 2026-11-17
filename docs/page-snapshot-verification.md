# Page snapshot and recovery verification

## Delivered scope

Supported providers (Gemini, ChatGPT, Claude, DeepSeek, Grok) have observed-DOM page capture, immutable capture identity, copy/Markdown/PDF actions, and an exact-ID preview. Unverified regular exports fall back to a fresh capture; PDF is handed to a stable preview page. Local recovery remains Gemini-only, opt-in, current-session scoped, and independently managed. Neither path registers a complete archive or advances scheduled export checkpoints.

Expanded recovery storage uses `unlimitedStorage`: optional on Chrome/Edge, required in the Firefox manifest due to Firefox's permission schema. The application keeps its default byte limits until explicit opt-in and checks the actual grant before each save. Recovery bodies are whitelist rebuilt before storage, content fingerprints are SHA-256 rather than duplicated transcript text, and an indexed slot reservation protects cleanup across interrupted writes. Settings and credentials are not cleared by draft deletion. The three conversation caches have separate body budgets: legacy preview 2 MiB, page preview 2 MiB, recovery 4 MiB by default (expanded mode removes application byte caps); browser or disk failures can still prevent saving. Unexpired drafts are retained rather than quota-evicted. Recovery retention is configurable (7/30/90 days or until deletion), with the 20-draft count limit preserved.

## Automated evidence

### 2026-10-20 issue #19 follow-up

- Full coverage run: 96 files / 1,107 tests passed, including popup navigation/cancellation/PDF handoff, expanded storage, quota retention and settings-read failure regressions. TypeScript and production audit passed (zero vulnerabilities).
- Chrome/Edge and Firefox artifacts passed platform-specific permission checks. Chromium smoke produced real snapshot Markdown/PDF files and recovered Markdown downloads, exercised keep-until-deleted persistence and direct Markdown saving, and passed without provider login.
- Expanded quota authorization is fault-injected in unit/UI tests; actual optional permission prompts and Firefox/Edge native runtime behavior are not yet acceptance-tested.

### Initial page-snapshot delivery (historical)

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

Usage and retention details: [Page snapshots and local recovery](design/page-snapshots.md). Storage disclosure: [Privacy Policy](../PRIVACY.md).
