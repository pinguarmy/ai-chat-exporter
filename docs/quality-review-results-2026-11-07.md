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

Repeated native downloads now resolve the browser-confirmed filename before reporting completion and recording history. Markdown, PDF, ZIP, snapshots and manual jobs share the same resolution helper. It returns no absolute local path. Actual Chromium output retained both the original file and a second `(1)` file; the second receipt matched the real second filename.

## Candidate A evidence and method failures

Product commits `363377c` and `6f2650e` implement the contract changes; `b423a48` binds review evidence to built bytes. A smoke selector became ambiguous when both Copy Markdown and Download Markdown matched `/Markdown/`; the original failure remains recorded, and test-only `ad882f0` uses the exact localized download action. The product bytes/behavior were not changed to fix the test.

The full candidate unit/coverage run passed 117 files and 1,307 tests. TypeScript and the production audit passed. The rebuilt Chromium export suite, native scheduled download suite and new immutable UX record passed. UX keyboard checks now start at a fresh document and traverse through the primary action/help rather than programmatically jumping to them. These checks inspect DOM focus/status semantics, not the spoken output of a screen reader.

The first independent challenge set was not valid acceptance evidence. Its author used non-provider IDs in provider URLs and exact filenames with spaces, contrary to the existing filename sanitizer. An independent executor initially could not run it. After reveal, the lead retained the blocked runs, reproduced native parser navigation through loopback-only TLS, and the author confirmed the invalid fixture/assertions. No parser was changed to accept artificial IDs. The specification was not edited or silently replaced; it cannot count as a passed holdout. A corrected public regression with valid IDs and established filename rules exercised real content-script HTTP parsing, non-default folders, share/reference settings and workspace/history transitions. Those are regressions, not unseen evidence.

The structure auditor also produced one false positive: it reported missing preview translations after searching only the main dictionary, overlooking the imported dictionary merge. The auditor re-read the merge and withdrew the finding; no duplicate translation table was added. This is retained as an evaluation error rather than hidden.

## First same-packet blind assessment

All three fresh graders received the same immutable 52-artifact index and frozen protocol, without prior product scores or the desired target. Hash checks passed. Mechanical validation then checked the graders' claimed inspected IDs against required IDs; a plausible-looking numeric report is not enough.

| Reviewer | Product weighted result | Method weighted result | Evidence discipline |
| --- | ---: | ---: | --- |
| Terra | 7.525 | 6.6 | All indexed mandatory items cited; identified method/timing and runtime-coverage gaps |
| Gemini 3.8 Flash | Insufficient | Insufficient | Omitted mandatory inspected IDs, including the calibration report it cited; numeric totals invalidated |
| Kimi K2.8 | Insufficient | 8.3 | Omitted narrow-preview screenshot from inspected IDs; product total invalidated rather than silently repairing the report |

The reported per-dimension scores remain preserved, but invalid totals are not used as acceptance. Gemini acknowledged the evidence-discipline failure and withdrew the inference that a heuristic disclosure alone proves a product privacy defect. There is no demonstrated private-data leak in this candidate.

The two post-freeze independent B cases matched their fixed full-output/native-filename/history assertions. They are accurately reported as independent post-freeze probes, not the protocol's pre-implementation holdout. The B02 fixture has no references, so setting references off does not test actual reference removal. These limits block a strong method-coverage claim.

## Bounded follow-up

Evidence packaging is being strengthened to carry actual built bytes, calibration fixtures and a version-bound full-export run record. A prospective selected/share-preview case was sealed before the next product edit, and will be run only after the next build. This does not retroactively upgrade candidate A or erase its method failures.

The preview now shows the confirmed filename and a shared cancel control for ordinary and snapshot downloads. Candidate B's full browser check exposed an introduced feedback regression: the saved receipt masked a later clipboard result. A failing unit regression reproduced it, and clearing the saved receipt when Copy starts fixes it. The failed full-run record remains failed rather than being overwritten.

The prospective case was sealed before this preview change, but its runner first used a nonexistent route and then waited for an obsolete literal success string. The first run and one authorized harness repair are retained as inconclusive. Seven preview/store checks passed and a real output file exists, but the remaining output/history assertions were not reached. This is not counted as a passed holdout or a product failure. The final candidate reuses the regression checks but does not retroactively upgrade this challenge.

The batch stops after the third candidate and final same-packet assessment. The requested all-dimensions threshold is not yet met; no finite synthetic suite or repeated scoring can fill the remaining human/runtime evidence gaps.
