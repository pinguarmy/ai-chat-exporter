# Provider fixture privacy

Provider captures can contain private conversation text, search queries, identifiers, timestamps, URLs, credentials and nested transport payloads. Do not commit raw captures or print their contents. Keep raw input outside version control and do not create extra copies.

The sanitizer treats unknown strings as private, preserves only explicitly listed public metadata values, and substitutes synthetic text and identifiers. Unknown model slugs are replaced rather than preserved. Gemini transport rejects unknown frame tags, RPC identifiers and non-frame lines. It decodes Gemini batchexecute frames and their embedded RPC JSON before sanitizing positional arrays, and decodes Claude `json_block` values. It retains structural root identifiers and uses consistent synthetic IDs for graph links. It shifts timestamps to a synthetic epoch and replaces URL and email values. The residual-secret scan detects a few credential shapes only; a clean result is not proof of privacy. Review new provider shapes and metadata allowlists before adding fixtures. Never add user-controlled text to an allowlist.

The five current fixture files were sanitized again in place. This changes the current working tree only. It does not remove data from Git history, previously published assets, caches or other copies. Any history rewrite or removal of remote assets requires separate maintainer authorization.

Run the fixture sanitizer and affected provider fixture consumers after changes. Passing mocked fixture tests does not establish that a provider's live integration works.
