# Branch consolidation, 2026-09-15

All active development converges on main. Historical branch tips are retained as archive tags; they are not release tags. No obsolete branch is blindly merged.

| Branch | Tip | Disposition |
|---|---|---|
| chore/plasmo-patch-fail-fast | 9d56220052b6 | preserved as archive/2026-09-15/chore/plasmo-patch-fail-fast; merged/superseded |
| chore/store-publish | a24526159d01 | preserved as archive/2026-09-15/chore/store-publish; merged/superseded |
| feat/browser-extension-smoke | bd12960703a2 | preserved as archive/2026-09-15/feat/browser-extension-smoke; merged/superseded |
| feat/provider-api-drift | 5220aeea6a42 | preserved as archive/2026-09-15/feat/provider-api-drift; merged/superseded |
| feat/provider-fixture-infra | 688c428288a6 | preserved as archive/2026-09-15/feat/provider-fixture-infra; merged/superseded |
| feat/verification-evidence | 9236727824fd | preserved as archive/2026-09-15/feat/verification-evidence; merged/superseded |
| origin/archive/codex-v1.1.1-working-tree | 928b104ca903 | preserved as archive/2026-09-15/archive/codex-v1.1.1-working-tree; merged/superseded |
| origin/chore/store-publish | a24526159d01 | preserved as archive/2026-09-15/chore/store-publish; merged/superseded |
| origin/codex/audit-export-reliability | c42484bcd446 | preserved as archive/2026-09-15/codex/audit-export-reliability; merged/superseded |
| origin/codex/release-workflow-1-1-2 | 4e9b51cf49d6 | preserved as archive/2026-09-15/codex/release-workflow-1-1-2; merged/superseded |
| origin/enhance/claude-media-docs-round3 | 56d58b23c7fd | preserved as archive/2026-09-15/enhance/claude-media-docs-round3; merged/superseded |
| origin/fix/claude-export-integrity | c80df308b284 | preserved as archive/2026-09-15/fix/claude-export-integrity; merged/superseded |
| origin/fix/claude-integrity-round2 | 9b04d6334503 | preserved as archive/2026-09-15/fix/claude-integrity-round2; merged/superseded |

Tree equivalence confirmed: fixture-infra → c4ae4cd; Claude round 1 → a2f3189; round 2 → e496739; media round 3 → 11dceae; store-publish → e2c940e. Other development branches have identical patch IDs or are ancestors. PRs #1–18 are merged.

The v1.1.1 working-tree archive predates the canonical v1.2.0 import and subsequent parser/export rewrites. Its sole path absent from main, STORE-LISTING-v1.1.1.md, is retained under docs/history. Its complete original tree remains accessible by archive tag.
