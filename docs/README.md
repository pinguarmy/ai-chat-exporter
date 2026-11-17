# Documentation index

Living documents describe current behavior or procedure and must be kept up to date. Historical documents are records of a past decision, release, or review; do not update them except to fix links.

Repository-root documents: [README](../README.md) ([简体中文](../README.zh-CN.md)), [CONTRIBUTING](../CONTRIBUTING.md), [AGENTS](../AGENTS.md), [GUIDE](../GUIDE.md) (architecture and data-integrity guide), [PRIVACY](../PRIVACY.md).

User-facing manual: [user-guide.md](user-guide.md), the detailed feature guide that the README links to. Living.

## Operations (living)

| Document | Purpose |
| --- | --- |
| [release-workflow.md](release-workflow.md) | Canonical three-store (Chrome, Firefox, Edge) and GitHub release guide, in Chinese. Living. |
| [chrome-publishing-auth.md](chrome-publishing-auth.md) | Chrome OAuth recovery procedure, supporting the release guide. Living. |
| [MAINTENANCE.md](MAINTENANCE.md) | Architecture, verification, and release checks. Living. |
| [provider-fixture-privacy.md](provider-fixture-privacy.md) | Rules for capturing and sanitizing provider fixtures without leaking private data. Living. |
| [page-snapshot-verification.md](page-snapshot-verification.md) | What page snapshot and local recovery verification covers and which providers remain untested. Living. |

## Checklists (`checklists/`)

| Document | Purpose |
| --- | --- |
| [CHROME_STORE_CHECKLIST.md](checklists/CHROME_STORE_CHECKLIST.md) | Chrome Web Store submission checklist and privacy-practice wording. Living. |
| [DOGFOOD-TEST-MATRIX.md](checklists/DOGFOOD-TEST-MATRIX.md) | Manual acceptance matrix across providers and formats. Living. |

## Design and feature behavior (`design/`)

| Document | Purpose |
| --- | --- |
| [page-snapshots.md](design/page-snapshots.md) | User-facing behavior of page snapshots and local recovery. Living. |
| [chatgpt-static-ui.md](design/chatgpt-static-ui.md) | Supported ChatGPT layout markup subset in Preview and PDF. Living. |
| [FRONTEND_BRIEF.md](design/FRONTEND_BRIEF.md) | PDF export surface design brief. Living reference. |
| [SCHEDULED_EXPORT_FRONTEND_BRIEF.md](design/SCHEDULED_EXPORT_FRONTEND_BRIEF.md) | Popup and options redesign brief, including scheduled export UI. Living reference. |
| [snapshot-ui-brief.md](design/snapshot-ui-brief.md) | Design brief for the snapshot panel, preview, and recovery page, in Chinese. Living reference. |
| [design-artifact-export.md](design/design-artifact-export.md) | Proposal for exporting generated artifacts; embed subset implemented, separate-file modes are future work. Partly historical. |

## Quality review (`quality-review/`)

All historical; scores and protocols are frozen for the batches they describe.

| Document | Purpose |
| --- | --- |
| [quality-review-protocol.md](quality-review/quality-review-protocol.md) | Candidate quality review protocol, revision 3. Referenced by `scripts/create-review-packet.mjs`. |
| [quality-review-governance.md](quality-review/quality-review-governance.md) | Acceptance rules for the 2026-11-07 review batch. |
| [quality-review-results-2026-11-07.md](quality-review/quality-review-results-2026-11-07.md) | Results of the 2026-11-07 method and product review. |
| [quality-review-calibration-2026-11-07.json](quality-review/quality-review-calibration-2026-11-07.json) | Calibration reports for that batch. |
| [quality-review-blind-reports-2026-11-07.json](quality-review/quality-review-blind-reports-2026-11-07.json) | Raw blind reports and validation results for that batch. |
| [ux-review-rubric.md](quality-review/ux-review-rubric.md) | Frozen 1.5.0 onboarding UX rubric. |
| [ux-review-results.md](quality-review/ux-review-results.md) | Results of the 1.5.0 onboarding review. |

## Release notes (`releases/`)

Per-version notes, historical. `release.yml` and the publish scripts read `releases/<version>.md`, so the current version must have a file here.

| Document | Purpose |
| --- | --- |
| [1.3.0.md](releases/1.3.0.md), [1.4.0.md](releases/1.4.0.md), [1.4.1.md](releases/1.4.1.md), [1.4.2.md](releases/1.4.2.md) | User-visible release notes. Historical. |
| [1.5.0.md](releases/1.5.0.md) | Release notes for the current release candidate. Living until published. |
| [1.5.0-status.md](releases/1.5.0-status.md) | Per-channel publication status and recovery record for 1.5.0. Historical. |

## History (`history/`)

All historical.

| Document | Purpose |
| --- | --- |
| [1.3.0-implementation.md](history/1.3.0-implementation.md) | 1.3.0 delivered scope and acceptance notes. |
| [1.5.0-verification.md](history/1.5.0-verification.md) | 1.5.0 candidate engineering verification record. |
| [branch-consolidation.md](history/branch-consolidation.md) | 2026-09-15 branch consolidation and archive tags. |
| [export-integrity-remediation.md](history/export-integrity-remediation.md) | Provider-export hardening implementation record. |
| [SCHEDULED_EXPORT_PLAN.md](history/SCHEDULED_EXPORT_PLAN.md) | Original scheduled auto-export plan; implemented in v1.2.5 (`src/core/scheduled-export.ts`). |
| [STORE-LISTING-v1.1.0.md](history/STORE-LISTING-v1.1.0.md), [STORE-LISTING-v1.1.1.md](history/STORE-LISTING-v1.1.1.md), [STORE-LISTING-v1.2.0.md](history/STORE-LISTING-v1.2.0.md) | Chrome Web Store listing copy for past versions. |
