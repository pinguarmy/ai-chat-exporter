# Candidate quality review protocol, revision 3

This protocol replaces the earlier onboarding-only method for new reviews. It does not retroactively change earlier scores. Calibrate this draft before freezing it and scoring a candidate. If calibration identifies ambiguity, allow one documented clarification, increment the revision and repeat the whole calibration under that revision. After freezing, any rule change requires another revision, a new baseline and full recalibration, not a corrected passing score.

## What is being assessed

Keep three conclusions separate:

1. **Observed engineering behavior.** Automated checks of an isolated built extension and its actual output. Provider responses and injected failures are explicitly synthetic.
2. **Expert assessment.** Independent model judgments about the tested product and the quality of this evaluation method. These are not measurements of user satisfaction or a statistical confidence interval.
3. **External acceptance.** Current logged-in provider compatibility, Firefox/Edge runtime behavior and observation of real first-time users. When not tested, report **unknown**. An expert score cannot pass these gates.

The product includes first use, current export, bulk/workspace, preview/message selection, settings and recovery. Architecture is assessed where it affects these paths: one meaning for format, scope, settings, filenames and completion across entry points. File length or the number of components alone does not earn or lose points. Do not refactor provider parsers without a concrete failing contract.

## Product dimensions

Score each dimension independently, with evidence IDs and remaining issues. **A required item has two parts: its observation record and the referenced output artifact. Reading the record alone is not artifact inspection.** Cite both paths; for a missing artifact explicitly report the attempted path. For each privacy/output contract, compare the actual bytes with the required included and excluded content, not just a hash or a prose claim. Overall weights stay compatible with the earlier review, but the expanded anchors and evidence requirements make old scores non-comparable.

| ID | Dimension | Weight | Required observations |
| --- | --- | ---: | --- |
| P1 | Orientation and task structure | 20 | Unsupported/provider-home/current states; recoverable help; a clear route to preview, bulk, settings and recovery; no forced setup. |
| P2 | Export contract and result | 20 | Chosen format/scope/destination matches the produced file, including non-default settings, meaningful title fallback and repeat downloads. Receipt distinguishes proposed from browser-confirmed output. |
| P3 | Privacy and scope control | 20 | Partial/snapshot limits survive settings changes and all output paths; known credential and excluded-message sentinels stay out; raw data and history obey selected scope. Limits of heuristic redaction are explicit. |
| P4 | State, recovery and continuity | 15 | Successful, failed, cancelled and interrupted outcomes are distinct; old feedback does not describe a new run; choices survive workspace/retry; completed files are not silently downloaded again. |
| P5 | Accessibility and presentation | 15 | End-to-end keyboard reachability and visible focus; accessible names match actions; status/alert semantics; six-locale narrow layouts and settled light/dark states. DOM semantics do not prove screen-reader experience. |
| P6 | Structural consistency and verification | 10 | Shared contracts prevent observable drift across popup/preview/background; explicit lifetime/ownership boundaries; meaningful regression tests; candidate-bound evidence and independent challenge cases. No speculative layers or service required. |

### Score anchors

- 0–4: absent, harmful or a primary task cannot be completed.
- 5–6: possible with instructions or a workaround; important output/state mismatch.
- 7: usable but material friction or an important untested path.
- 8: coherent common path, with a concrete rough edge or a relevant evidence gap.
- 9: directly supported common and changed paths; no unresolved material defect in that dimension.
- 9.5: the 9-level evidence plus independent, previously withheld challenge cases for that dimension, non-default settings and boundary states; no material issue found. Explain why the additional evidence warrants this judgment. Passing a checklist alone does not require this score.
- 10: unusually strong evidence and execution beyond this test set. Do not infer perfection from a finite test run.

Before assigning a score, inspect every applicable mandatory evidence item listed for that dimension in the candidate index. If any is missing, inaccessible, from a different build or not directly inspected, mark the dimension **insufficient evidence** and do not compute an overall score or accept the candidate. Mark a requirement not applicable only with a concrete reason. A 9-level assessment requires all applicable required observations, not only changed/common paths. The added challenge/boundary evidence is necessary but not sufficient for 9.5: a reviewer can reasonably assign a lower score despite passing assertions. Do not award 9+ from screenshots, source inspection or a lead's summary alone when the requirement involves output/state transitions. Report individual dimension scores to one decimal at most. Weighted scores use the supplied dimensions without rounding to a passing threshold; precision is arithmetic, not measurement accuracy.

## Evaluate the evaluation method separately

| ID | Method dimension | Evidence required |
| --- | --- | --- |
| M1 | Claim validity and boundaries | Synthetic inputs, real browser/output, expert interpretation and untested external gates are separated. Claims do not exceed what was inspected. |
| M2 | Discrimination | Calibration includes a valid control, planted output/privacy/state defects and an intentionally insufficient record; graders catch the defects without rejecting the control. Report each result, not a population accuracy claim. |
| M3 | Independence and stability | Fresh scoring contexts receive identical protocol/evidence, no desired score, prior score, candidate rank or other model opinions. Repeat one relabelled calibration item without revealing it. Record disagreements and exact repeated-item changes. |
| M4 | Provenance and reproducibility | Commit/build identity, command, environment, artifact hashes, explicit input substitutions and scenario assertions travel together. Stale builds, missing files and altered files invalidate evidence. |
| M5 | Coverage and resistance to overfitting | Every product dimension maps to actual assertions, not a test count. Independent challenge specifications are sealed before implementation, run after freeze, and become regressions if they expose a defect. |

Method scores use the same anchors where applicable, equal weights, and evidence IDs. No mathematical reliability or predictive validity is claimed from three models and a handful of samples. A method can expose its own limitations and still be useful; it cannot call those limitations solved.

## Review sequence and stop rules

1. Draft the scenario inventory and the mapping of assertions to P1–P6. Keep old history and the maintainer's acceptance threshold separate from the packet supplied to graders. Record the baseline candidate only after calibration and protocol freeze.
2. Before formal freeze, run one calibration batch per model with the same labelled evidence but without the answer key. Include a relabelled duplicate. Collect all reports before discussing errors. If a grader misses a planted privacy/false-completeness failure or cannot inspect the required evidence, its product score is provisional and cannot serve as acceptance evidence. Clarify rubric ambiguity at most once, preserve the original results, increment the revision and rerun complete calibration; if it still fails, stop as unaccepted. Freeze the protocol hash after calibration. Do not coach a desired numerical answer.
3. A separate read-only challenge author seals a bounded set of task variants and expected outcomes before product edits. The implementation lead sees the coverage areas but not exact data until the candidate is frozen. These are independent synthetic checks, not human usability studies. Once revealed or used for a fix, a case is a regression, no longer a holdout.
4. Produce one immutable evidence directory per candidate. Record actual assertions, outputs and failures. A failed run keeps its failure record and cannot leave a previous success report as its latest result. Evidence must identify built bytes, not merely current Git HEAD.
5. Send the same evidence index and protocol to three fresh-context graders. Do not include the target score, previous findings/scores, implementation story or other graders' reports. Graders return inspected evidence IDs, per-dimension scores or insufficient evidence, findings with concrete reproduction, and remaining unknowns. Tool failure is not a reason to replace direct evidence with a persuasive lead summary.
6. Collect all reports before synthesis. Arithmetic and evidence checks are mechanical; judgments remain independent. Do not average away a weak dimension or a privacy/data-loss failure. A cross-grader difference above 1 point, or contradictory findings about the same state, requires checking the underlying evidence rather than negotiating scores.
7. At most three product candidates in this batch, with a fixed challenge budget. Stop when acceptance is met, or after two consecutive candidates add no new verified improvement. Report an unmet target honestly; no retrying graders until one gives a preferred answer. Future evidence or an authorized new task can start a new batch.

## Hard failures and review record

Private data against a selected setting, unverified content represented as a full archive, data loss, false saved-success, or inability to complete a normal primary task blocks acceptance regardless of weighted scores. Evidence-integrity failure blocks interpretation, not necessarily the product itself.

Keep a concise record of protocol revision/hash, candidate/build identity, calibration outcomes including misses, challenge ownership and seal/reveal times, immutable evidence index, all reviewer reports and arithmetic, changes justified by findings, and external unknowns. Do not include private conversations, credentials or personal browser state.
