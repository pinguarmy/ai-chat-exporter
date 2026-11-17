# Provider fixture privacy

Provider captures can contain private conversation text, search queries, identifiers, timestamps, URLs, credentials and nested transport payloads. Do not commit raw captures or print their contents. Keep raw input outside version control and do not create extra copies.

The sanitizer treats unknown strings as private, preserves only explicitly listed public metadata values, and substitutes synthetic text and identifiers. Unknown model slugs are replaced rather than preserved. Gemini transport rejects unknown frame tags, RPC identifiers and non-frame lines. It decodes Gemini batchexecute frames and their embedded RPC JSON before sanitizing positional arrays, and decodes Claude `json_block` values. It retains structural root identifiers and uses consistent synthetic IDs for graph links. It shifts timestamps to a synthetic epoch and replaces URL and email values. The residual-secret scan detects a few credential shapes only; a clean result is not proof of privacy. Review new provider shapes and metadata allowlists before adding fixtures. Never add user-controlled text to an allowlist.

The five current fixture files were sanitized again in place. This changes the current working tree only. It does not remove data from Git history, previously published assets, caches or other copies. Any history rewrite or removal of remote assets requires separate maintainer authorization.

Run the fixture sanitizer and affected provider fixture consumers after changes. Passing mocked fixture tests does not establish that a provider's live integration works.

## Minimizing large fixtures

The sanitizer preserves array lengths, so a capture of a long account history stays large even when every value is synthetic. `scripts/minimize-provider-fixture.mjs` deterministically shrinks an already-sanitized fixture. It only removes data (and recomputes structural links, pagination counters and the schema fingerprint); it never reads raw captures and cannot add content.

```bash
node scripts/minimize-provider-fixture.mjs tests/fixtures/providers/chatgpt/2026-08-24-normal.json --check
```

Without an output path the fixture is rewritten in place. `--check` runs the sanitizer's residual-secret scan on the input and the result and fails if the result has any finding. A fixture that already carries the `minimization` marker is returned unchanged, so reruns are no-ops. Only the `chatgpt` provider has minimization rules today.

What the ChatGPT rules keep:

- **Pagination**: the first full page (`limit` items) and a short last page (at most 3 items). The parser keeps paging while `items.length === limit` and stops on a short page, so a full page followed by a short page is the smallest shape that exercises both paths. `offset` and `total` are renumbered so the kept pages are contiguous (`total = offset + limit + 1` while more pages remain, otherwise `offset + items`).
- **Conversation trees**: the active branch (`current_node` up to the root), relinked so it stays one root-to-leaf chain. The root, the leaf, every branch point with its active child and its off-chain children (to depth 2), every visible user/assistant node with an image part, the first two nodes of each distinct node shape (role, content type, recipient kind, status, channel, part kinds, reference/tool-call/error flags), and both nodes of the first occurrence of each adjacent shape pair are kept. Other nodes of repetitive linear runs are removed. Relinking can create adjacencies that did not exist in the capture; every original transition is still present.
- **Metadata arrays** keep up to 2 items per distinct item shape (at most 4 per array); `content.parts` is never trimmed. Strings are truncated to 240 characters.

Trimming changes counts: the minimized fixture's `schemaFingerprint` differs from the one computed over the full capture (mapping keys are part of the fingerprint), and the `minimization.original` envelope field records the original list page sizes and node counts. Tests must not assert the old sizes.

The previous multi-megabyte ChatGPT fixture remains in Git history and in any clones, caches or published copies; this change does not rewrite history. Removing it from history would need separate maintainer authorization.
