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
