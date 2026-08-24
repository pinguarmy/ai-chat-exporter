# Provider fixtures

Sanitized captures of real provider API responses, used by the provider
regression tests. Each file is produced from a logged-in browser session and
then stripped of all private data before being committed.

## Fixture schema

Every fixture is a JSON object with a metadata envelope:

```json
{
  "provider": "chatgpt",
  "capturedAt": "2026-08-24",
  "source": "real-sanitized",
  "scenario": "normal",
  "schemaFingerprint": "<sha256 hex>",
  "payload": { ... }
}
```

- `provider` — one of `chatgpt`, `claude`, `gemini`, `deepseek`, `grok`.
- `capturedAt` — capture date (`YYYY-MM-DD`), part of the file name:
  `<provider>/<YYYY-MM-DD>-<scenario>.json`.
- `source` — always `real-sanitized`. Hand-written mocks must not use it.
- `scenario` — free-form scenario label (`normal`, `branched`, …).
- `schemaFingerprint` — sha256 over the sorted `path:type` list of every node
  in `payload` (paths use key names and `[]` for array items). Two fixtures
  with the same shape share a fingerprint; any key rename or type change
  alters it. Use it to detect provider schema drift.
- `payload` — the sanitized capture (list pages and conversation details).

## Capturing a new fixture

Prerequisites: the user's browser with Kimi WebBridge connected
(`http://127.0.0.1:10086`) and an active login for the provider.

```bash
npm run fixtures:capture -- --provider chatgpt
npm run fixtures:capture -- --provider claude --conversation-url https://claude.ai/chat/<id> --scenario branched
```

The capture script navigates the connected browser to the provider, replays
the same list+detail requests the extension parsers use, writes the raw
capture to the gitignored `captures-raw/` directory, sanitizes it, and writes
the fixture here. If the daemon is unreachable or the provider shows a login
wall, it exits with an error and writes nothing.

To re-sanitize an existing raw capture (e.g. after sanitizer changes):

```bash
npm run fixtures:sanitize -- captures-raw/<file>.json tests/fixtures/providers/<provider>/<date>-<scenario>.json \
  -- --provider <provider> --scenario <scenario> --check
```

## Sanitization guarantees

`scripts/sanitize-provider-fixture.mjs` walks the payload recursively and:

- **Preserves**: key names, nesting depth, array lengths, branch-graph
  structure (parent/child references stay internally consistent), pagination
  envelope fields, role/type metadata, booleans and nulls.
- **Redacts**: any key matching tokens/cookies/sessions/secrets/authorization/
  API keys/CSRF.
- **Pseudonymizes**: identifier-looking values (UUIDs, long IDs under
  `*_id`/`*_node`/`*_parent`/… keys) become `id_<sha256-8>`; the same original
  value always maps to the same pseudonym within a fixture.
- **Replaces**: message text (`Synthetic message N`), conversation/document
  titles and uploaded filenames (`Synthetic title N`), URLs
  (`https://example.invalid/<sha256-8>`), emails
  (`user_<sha256-8>@example.invalid`).
- **Drops**: attachment/file/connector/upload keys entirely.
- **Shifts**: timestamps to a fixed epoch base, preserving relative ordering
  but destroying real dates.

After sanitizing, the capture script scans the fixture for residual secret
patterns (JWTs, `sk-` keys, bearer tokens, cookie headers, emails) and refuses
to write the fixture if any are found.

## Raw captures never leave `captures-raw/`

Raw captures contain private data: tokens, message text, account identifiers.
They are written only to `captures-raw/` (gitignored) and must never be
committed, copied elsewhere, or shared. Only the sanitized output of the
sanitizer may be committed under this directory.

## Browser smoke is not a provider login

`npm run test:browser` loads the unpacked Chromium extension after
`npm run build`. It opens popup, options, and preview only. It does not
visit chatgpt.com, claude.ai, or any other provider, and it does not
capture private chat content.
