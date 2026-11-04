# 1.5.0 user-experience review rubric

Frozen for the onboarding review that starts at commit `9b54b26`. Score the candidate extension UX, not a marketing page or the current compatibility of logged-in providers. Reviewers must not raise scores to satisfy the requested target. A low score is useful evidence.

## Scope and scoring

Each reviewer scores every dimension from 0 to 10 with one decimal place and cites inspected evidence. Overall = sum of score × weight / 100. Report the calculation, not only an impression.

| Dimension | Weight | What earns 9 |
| --- | ---: | --- |
| First use and orientation | 20 | A new user on an unsupported page sees supported providers, an actionable next step and a concise explanation of how to return and export. On a provider homepage the user understands current-chat versus history export. Help is discoverable again without obstructing returning users. |
| Primary export and result | 20 | On a readable conversation, format, scope, destination and primary action are unambiguous. Markdown/PDF/ZIP describe their real purpose. Completed output matches the receipt and can be found. Selected-message export is discoverable. |
| Scope, privacy and control | 20 | Verified structure is not called authenticity or full resource coverage. Snapshot/partial output cannot masquerade as a full archive. Share-copy limitations and active settings are understandable. No misleading filename or setting-dependent data exposure in tested paths. No unsolicited upload, tracking or permanent permission opt-in. |
| Feedback and recovery | 15 | Loading, no conversation, blocked/unverified source, failed download, cancellation and completion are distinct. Each actionable failure offers a safe next step. Long jobs explain page lifetime and workspace behavior. Retrying does not discard choices or silently duplicate completed work. |
| Accessibility, readability and locale | 15 | Keyboard access, labels, focus and status announcements work. At 380px popup/375px preview and in six supported locales, required actions are reachable without horizontal overflow. Defaults stay compact; advanced controls can scroll. Text remains legible and consistent in light/dark themes. |
| Evidence and implementation fit | 10 | Actual built extension scenarios and downloaded files support the claims. Targeted regressions cover changed behavior. The solution reuses existing architecture and has no unnecessary service, telemetry, sprawling wizard or speculative platform parser. Known untested boundaries are explicit. |

Anchors: 0 = absent or harmful; 5 = technically possible but requires instructions/guessing; 7 = functional with meaningful friction; 8 = clear with a material rough edge; 9 = tested, coherent and no material friction in this scope; 10 = exceptional, backed by broader user testing, not required for this task.

## Mandatory scenarios

Use fresh synthetic browser profiles and no provider network requests. Record which behaviors are simulated. Real browser downloads, clipboard, storage, focus and layout must not be replaced by passing mocks.

1. First open on an unsupported page. Find a provider and understand how to return, what is stored and what the first export will do.
2. Supported provider homepage with no current conversation. Find bulk history without a scary unrelated error.
3. Verified synthetic current conversation. Choose a reading/editable/archive format, discover message selection, inspect destination and produce a file.
4. Unverified current read. Explain the block, offer refresh/snapshot, preserve the snapshot limitation and avoid success when only opening preview.
5. Selected/share copy. Check scope, active privacy state, filenames and actual bytes; excluded content and known credential sentinels stay out.
6. Bulk/workspace. Preserve selection/options, show eligible count, retry failures, distinguish cancellation and completion, keep primary controls reachable at popup size.
7. Returning use and help. Guidance is available again, but does not force repeated setup or change saved export settings. Test keyboard interaction and one non-English locale directly, plus all-locale layout checks.

## Score gates and evidence discipline

- Target: Terra, Gemini 3.8 Flash and Kimi K2.8 each independently score at least 9.0/10, every dimension at least 8.0, and no unresolved critical/high issue in scope.
- A critical/high issue means private data disclosure against a selected setting, unverified content labelled a full archive, data loss, or inability to finish the primary task through the normal entry point.
- Review the same rubric and scenario list each round. Do not add features merely to raise a score. Distinguish must-fix defects, material UX friction and optional preferences.
- Cite screenshot/file/source/test evidence with the candidate commit or build. Do not infer that code, screenshot or unit tests prove a live provider works.
- Missing authorized live-provider sessions and Firefox/Edge runtime acceptance remain release gates, separate from this scoped UX score. They cannot be called passed or hidden in the final report.
- Reviewers return scores, calculation, at most five concrete score-limiting findings, evidence inspected and evidence missing. If 9 is not justified, say so and name what would change the assessment.
- Model scoring is a structured expert review, not a substitute for observing real first-time users. Report that limit even when the target is achieved.
