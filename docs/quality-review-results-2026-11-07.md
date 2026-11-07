# Evaluation-method and product review, 2026-11-07

## Status and boundaries

This batch starts from `ec7af11`. The earlier 9-point onboarding result remains historical. It is not reassigned to a stricter protocol or a different product. The expanded scope includes cross-entry contracts and the quality of the evaluation method itself. No current logged-in provider session, Firefox/Edge runtime or real first-time participant is in scope; those conclusions remain unknown.

## What was wrong with the earlier method

The method auditor directly read the earlier rubric, results and UX script. It identified target disclosure and repeated public tasks, different evidence inspected by different graders, reliance on lead summaries/previous-candidate artifacts, missing assertion-to-scenario mapping, and keyboard checks that jumped focus and treated element width as sufficient visibility. These can inflate confidence even when a fix is real.

The new [protocol](quality-review-protocol.md) separates measured behavior, expert judgment and external acceptance. Required evidence includes actual artifacts, not just records/hashes. Fresh graders receive the same version-bound evidence without old scores or the desired threshold. The maintainer's [governance rules](quality-review-governance.md) retain the requested target separately and forbid averaging away missing evidence or weak dimensions.

## Method calibration and freeze

The first six closed synthetic fixtures included a valid control, an exposed private sentinel, a wrong filename receipt, an invalid partial-export history entry, a missing artifact and a relabelled repeat. These are intentionally constructed evaluation controls, not observed product bugs.

| Model | Initial verdicts matching contract | Inspected actual artifacts | Repeat stable | Result |
| --- | ---: | --- | --- | --- |
| Terra | 6/6 | Yes, missing file attempted | Yes | Calibration passed |
| Gemini 3.8 Flash | 4/6 | No, records only | Yes | Missed both private-sentinel artifacts; provisional |
| Kimi K2.8 | 6/6 | Yes, missing file attempted | Yes | Calibration passed |

One clarification was made before freeze: each required evidence item includes both its record and referenced output bytes, and reviewers must cite both. The protocol revision increased from draft 2 to 3. Complete calibration restarted in fresh contexts for all three models without telling them which cases had failed. All three then matched 6/6 contract verdicts and the relabelled repeated verdict/severity. Gemini used critical where the others used high for the planted exposure; this severity difference remains visible. Six constructed cases do not establish statistical reliability, usability validity or general model trustworthiness.

Frozen protocol revision 3 SHA-256: `97e6e4d15af7e9e20f225a6185fdbfe74164bd24cb196ef3f41679786f94f59d`.

The initial reports, revised reports and mechanical checks are retained separately outside the repository during the batch. No report was overwritten to remove a miss. The independent challenge specification has SHA-256 `5c3de4c9cbd611ebd65b3b186f4232b1a4a8c11e89bc3ff2fafb5a1f17edeacb`, sealed at 19:25 UTC after initial edits, not falsely described as pre-edit evidence. Two attempted challenge-runner authors failed before producing files; a separate author supplied the sealed specification and a different executor is implementing it.

## Concrete product findings and changes

- Placeholder titles were resolved only at quick-export click time. The heading/preview/preflight still used the original title. Title resolution now happens once at detection using the already-read tab title or first user message, without changing a real provider title or mutating the source input.
- A new background bulk job could retain the previous run's error/completion/cancel display. Both execution branches now clear the old outcome before starting, while preserving failed-item retry selection.
- The current-chat preflight passed index 1 while the downloader used the default index 0. A regression reproduced `001` shown versus `000` downloaded. The preflight now uses the same default.
- Preview copy/download labels did not say that copy produced Markdown while a full download could produce ZIP. Labels now name the actual output; partial/snapshot paths remain Markdown/PDF.
- The export button's accessible name did not follow its visible loading/success state. It now does.
- Evidence identified the current Git HEAD rather than loaded built bytes, and a failed run could leave an older success record. Build provenance and per-run artifact hashes now make stale/altered builds and reused evidence directories fail explicitly. A failure record cannot be turned into success by the finish operation.

A filename receipt issue on repeated native downloads is under correction: the browser can choose a uniquified or Save-As filename different from the requested one. That case must use browser-confirmed output rather than a predicted name. Validation and independent product/method scores are not yet complete.
