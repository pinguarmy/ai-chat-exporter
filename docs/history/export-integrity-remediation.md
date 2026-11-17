# Export integrity remediation

This document is an implementation record for provider-export hardening. It
contains no conversation content, credentials, cookies, or account identifiers.

| Area | Status | Code/tests | Live status |
| --- | --- | --- | --- |
| Transcript shape vs source completeness | Implemented | `src/lib/conversation-integrity.ts`, `tests/conversation-integrity.test.ts` | Fixture/CI verified |
| Claude source verification | Implemented: DOM explicitly unverified; verified API required for detail archive | `src/contents/claude-parser.ts`, `src/lib/parser-runtime.ts`, Claude integrity regressions | Real long-chat re-test recommended |
| Claude active tree branch | Implemented with root-reaching parent-chain validation; no message-count heuristic | `resolveClaudeActiveBranch`, `tests/claude-export-integrity-regression.test.ts` | Real branched-chat re-test recommended |
| Claude history pagination completeness | Implemented: API partial vs complete vs sidebar fallback surfaced separately | Claude parser + popup bulk history state | Live account history test recommended |
| ChatGPT source/branch verification | Implemented: explicit `current_node` must reach root; DOM and broken/missing-pointer mappings remain unverified | `resolveChatGptActiveBranch`, ChatGPT detail regressions, parser runtime | Real long/branched-chat re-test recommended |
| ChatGPT history pagination completeness | Implemented: later-page failure discards partial API rows and labels sidebar fallback incomplete | ChatGPT parser list metadata and regressions | Live account history test recommended |
| Virtualized DOM media enrichment | Implemented: message ID → unique text → same-role tail alignment | `src/lib/parser-fallback.ts`, `tests/parser-fallback*.test.ts` | Real image-bearing long-chat test recommended |
| Claude verification failure UI/retry | Implemented: visible failure, user retry bypasses background cooldown | parser runtime + popup | Browser interaction test recommended |
| Retry-storm prevention | Implemented: deterministic authoritative-detail failures briefly cached for background polling | `src/lib/parser-runtime.ts` | Provider outage/rate-limit test recommended |
| ChatGPT legacy host injection | Implemented | content-script match and manifest verification | Chrome/Firefox live test pending |
| DeepSeek/Grok DOM fallback | Implemented where provider policy allows it; sidebar history is explicitly incomplete | `tests/provider-dom-fixture-regression.test.ts` | Not live-tested |
| DeepSeek/Grok history pagination | Implemented conservatively; DeepSeek prefers `/api/v0/chat_session/fetch_page` and falls back to `/api/v0/chat/history`; only terminal API pagination is complete and partial results are discarded before sidebar fallback | parser pagination helpers + list metadata regressions | Endpoint live test pending |
| Gemini incomplete DOM hydration | Implemented | detail fallback and credential recency selection | Not live-tested |
| Scheduled retry/single-flight and list completeness | Implemented: partial/sidebar lists cannot advance `lastRun` | shared run classification, list-metadata gate, background lock | Browser alarm test pending |
| Download completion/history | Implemented | `src/lib/download-completion.ts`, `tests/download-completion.test.ts` | Browser download interruption test pending |
| Preview/PDF/Markdown attachment parity | Implemented | preview settings, strict ID, renderer parity | Real media test recommended |
| Release package consistency | Implemented | clean-tree build guard and archive checks | Requires clean committed build |

## Current integrity contract

The following rules are intentional and should not be weakened by future cleanup:

1. A transcript's role/message shape is not the same as proof that its source is complete.
2. A provider-verified one-sided transcript may be a legitimate complete archive.
3. An explicitly unverified DOM snapshot must not become a successful archive merely because both roles are visible.
4. Claude detail/current export requires a provider-verified API transcript because long histories are virtualized in the page DOM.
5. Claude branch correctness is structural: the selected branch must reach a real root without a missing parent or cycle.
6. ChatGPT mapping detail requires an explicit `current_node` whose parent chain reaches root; a balanced short chain is not proof of completeness.
7. A partial provider history or sidebar fallback must not advance the scheduled-export checkpoint.
6. Claude API/auth/branch failure produces a visible failure rather than silently falling back to DOM.
7. Rendered DOM media may enrich a confidently matched authoritative API message, but may not alter authoritative message ordering or attach media to an unrelated turn.
8. Partial provider history must be labeled partial rather than presented as the complete account history.
9. Manual, bulk, preview, and scheduled/background paths should use the same exportability contract.

## Automated verification gate

Run before release:

```bash
npm test
npm run lint
npm audit --omit=dev
npm run build
```

Do not hard-code suite counts or advisory counts in this record: both change over
time. CI is the source of truth for the current commit.

## Browser/live verification

Fixture tests cannot prove a provider's current production DOM/API shape. Live
verification remains separate and must use only an explicitly authorized test
account. Record only safe diagnostics such as:

- provider and browser
- source (`api` / `dom` / `mixed`) and completeness state
- message counts/roles, not message text
- active-branch validation result
- history `complete` / `partial` / `sidebar` state
- preview/Markdown/PDF pass/fail
- attachment/media count and placement pass/fail
- failure/retry behavior

Never record chat text, cookies, access tokens, session data, or credentials in
QA logs.

## Dependency-audit disposition

Production dependency audit is a release gate. Development/build-chain findings
must be handled as supply-chain maintenance and tested as compatibility changes;
do not apply forced semver-major dependency migrations blindly merely to reduce
an advisory count.
