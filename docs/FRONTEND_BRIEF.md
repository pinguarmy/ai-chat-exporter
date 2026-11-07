# PDF export surface brief

## Product and job

- **Product:** AI Chat Exporter; save complete conversations from ChatGPT, Gemini, Claude, DeepSeek, and Grok as useful files.
- **Surface:** export document and live preview, not a marketing page.
- **Metaphor:** a quiet reading copy of a conversation, closer to an editorial transcript than a screenshot of a chat app.
- **Signature:** a narrow centered reading column with neutral role markers and no platform-colored message cards.

## Direction

- **Palette:** paper `#ffffff`, ink `#202124`, muted ink `#6b7280`, rule `#e5e7eb`, table fill `#f7f7f7`.
- **Type:** system sans with Chinese fallbacks; 10.5–11pt body text and a restrained 24–28px title.
- **Layout:** centered A4 column, 168–176mm of readable content; title and metadata centered, paragraphs left aligned for scanning.
- **Motion:** none in the PDF; preview keeps existing app interactions and adds a clear layout choice.
- **Accessibility:** semantic headings/tables, visible focus styles from the existing UI, reduced-motion-safe preview.

## Options and acceptance

- `minimal` is the default PDF layout; `classic` remains available for users who prefer the legacy conversation cards.
- The searchable text layer defaults on and is independently switchable.
- Minimal output must have no blue/green/red role blocks or role emoji, centered title/meta, neutral links, contained tables, and centered figures.
- A real export sample must be checked by rendering PNG pages, extracting text, and inspecting image/page boundaries; bytes alone are not enough.

## Boundary

Pagination, authentication, and conversation retrieval semantics remain
unchanged. Parsers may attach provider-supplied model names and message
timestamps when those fields are already present; they do not invent missing
metadata. This pass changes presentation, settings propagation, and export
verification.

## Gemini bulk-history state

- **Truthful source state:** Gemini's account RPC is the complete-history path;
  its sidebar is virtualized and may only contain rows rendered after scrolling.
  The bulk surface must never represent a sidebar fallback as a complete list.
- **Feedback:** while Gemini history is being requested, say that account
  history is loading. On success, explicitly say that scrolling the Gemini
  sidebar is unnecessary. On fallback or a partial API result, visibly explain
  that the list may be incomplete and offer Refresh.
- **Dates:** display a provider list timestamp as **last active** when that is
  all Gemini exposes. Keep exact conversation-start dates reserved for the
  detail response's earliest message timestamp, which is what filename
  generation uses. Do not silently substitute one for the other.


## 2026-09-12 popup refinement


Product: AI Chat Exporter, selecting conversations and downloading an archive.
Surface: existing 380px extension popup, React/TypeScript and shared CSS.
Direction: compact archive utility; keep current paper, ink, muted border and blue action tokens and existing typography. No new visual theme or decorative motion.
Signature: conversation list first, optional selection criteria behind a disclosure with a visible summary.
Regions: header and tabs; provider/load status; quick selection disclosure; searchable library; format; advanced export options; export action/results.
Interaction: date/limit controls are selection rules, applied explicitly. Folding does not clear values. Do not imply they are live list filters or that the cap applies to manual selections.
Pass A: disclosure, input validation, empty-list layout. Pass B: focus, expanded content sizing, loading and locale checks.
Accessibility: native details/summary for quick selection; hidden advanced panel cannot receive focus; no height clipping; visible focus and reduced-motion support.
Scope: popup/components/CSS, targeted selection/reference fixes. Larger export schema and background job changes require separate stages and fixtures.
Success: collapsed defaults give conversation selection more room; every retained condition is visible in the summary; no provider completeness claim based on UI alone.

## 1.5.0 export workflow

Product/surface: the existing popup, full workspace and preview, React/TypeScript. This is an export utility, not a new dashboard.
Metaphor/signature: a reading copy with a visible scope receipt. Show what will be saved and where; keep one primary download action.
Reference/type/palette: retain the current locale-aware serif UI, paper/ink colors, existing borders and action colors. Code and formula fonts stay unchanged.
Layout: keep Current/Bulk and collapsed advanced controls. Carry selection and temporary options into the workspace. Preview adds a compact all/selected/last-answer control with native checkboxes.
Storyboard: select content, confirm scope/format/destination, download, then show saved/cancelled/failed as distinct states. A failed recapture keeps the prior snapshot with an explicit warning.
Motion/copy: existing restrained transitions only, reduced-motion safe. Use literal status text, not success for cancellation or source validation for export completeness.
Accessibility: semantic labels, selected states, visible focus, live feedback. No clipping of translated controls in narrow popups.
Pass A: implement scope selection and workflow continuity. Pass B: verify narrow widths, translation fit, keyboard/focus and real downloaded output.
Success: selected messages preserve original order, partial copies never count as complete archives, and opening a workspace does not require selecting everything again.
Out of scope: a new visual theme, arbitrary provider-script execution, pixel-perfect interactive app replay or unverified claims of full Canvas/Artifacts support.

## 1.5.0 first-use and experience review

Product/surface: existing extension popup, preview and full workspace; React/TypeScript. Metaphor: a small archive desk, not an account dashboard.
Signature: a visible next step and a truthful save receipt. Retain current paper/ink palette, locale-aware serif type and specialized code/math fonts.
Layout: first-use guidance belongs in the empty/current context; formats and the save action stay prominent; help remains reopenable; advanced settings stay collapsed.
Storyboard: open a provider, open a conversation or choose history, select a useful file format, save, find the completed file. If verification fails, explain the snapshot alternative before asking for more settings.
Motion/copy: no new decorative motion. Short instructions that name real buttons and outcomes; no fictional progress, account setup, tutorial carousel or forced welcome tab.
Accessibility: labelled links/buttons, keyboard and focus, status announcements, reduced motion, light/dark and six-locale 380px containment. Guidance must not bury the primary action.
Pass A: task orientation and contextual instructions. Pass B: wording, keyboard/focus, translated layout and actual downloads.
Success: the frozen [review rubric](ux-review-rubric.md) reaches independent 9/10 assessments from all three reviewers without changing the criteria. Scores describe this scoped candidate UX, not live-provider acceptance or user testing.
Out of scope: services, telemetry, extra account/permissions, parser guesses, full interactive app replay and store publication.

## 2026-11-07 cross-entry consistency

Product/surface: popup, workspace, preview, settings and recovery in the existing React extension. Keep the paper/ink palette, locale-aware serif and code/math fonts. Signature remains a truthful scope/file receipt, not a new dashboard.
Structure pass: resolve placeholder conversation titles once before any entry point uses them; clear old outcomes when a new run starts; name the actual preview output format; bind evidence to the build actually loaded. Preserve source ordering, privacy options and provider contracts.
Polish pass: accessible names match visible loading/success/actions, explicit Markdown copy versus ZIP download, narrow translated controls and settled theme checks. No new decorative animation, forced wizard or unrequested service.
Success: common and non-default tasks produce the promised scope/format/name, and a blind reviewer can inspect the same candidate-bound evidence. Expert scores remain judgments, not user-study or online-compatibility claims. Stop at verified contract improvements rather than speculative component extraction.
