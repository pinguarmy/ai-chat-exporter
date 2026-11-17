# Frontend Creative Brief — “Archive Desk”

**Scope:** Complete redesign of the extension popup (`src/popup.tsx`) and the settings
page (`src/options.tsx`), plus the shared primitives they render
(`ConversationList`, `FormatSelector`, `FilenameEditor`, `ExportButton`, `Section`,
`Toggle`) and their stylesheets (`src/styles/popup.css`, `src/styles/options.css`).
No dependencies added. No backend, parser, PDF, manifest, or test changes.

## 1. Product truth the UI must tell

The interface exists to help a person keep a faithful, durable copy of their own
AI conversations. Every visual decision serves that one job. The UI must never
overstate what the system does:

- **Scheduled export is a best-effort archivist, not a cron daemon.** It runs only
  while Chrome and the extension are alive. The schedule rail exposes an editable
  global export interval (default 15 minutes); changing it applies that rolling
  cadence to every enabled platform, while a platform row may later override it. A
  configured local time (`timeOfDay`, HH:mm) means *at or shortly after* that
  time — never “at exactly 09:00:00”. Copy says “at or shortly after”.
- **One global switch.** Scheduled export has a single global enable. A manual
  **Run now** bypasses the next-due gate and runs immediately.
- **Progressive disclosure.** The optional settings card starts collapsed when
  scheduled export is off. Its header still exposes the current On/Off state;
  opening it reveals the contract, provider ledger, limits, and run status.
- **Per-provider cadence.** Each provider has `enabled`, `frequency`
  (hourly / every 6 hours / daily / weekly / custom), `maxPerRun`, and — for
  daily/weekly only — `timeOfDay` (HH:mm). A custom cadence adds
  `intervalMinutes` (1–10080) and runs from the last completed checkpoint.
  Weekly additionally has `dayOfWeek` (0–6, Sunday-first). These fields live in
  `PlatformScheduleConfig`; the UI exposes them only when they are relevant to
  the chosen frequency.
- **The ledger exposes runtime truth per provider.** Enabled rows show the next
  expected run derived from the provider checkpoint, plus the latest safe state:
  ready/signed in, sign-in required, rate limited, or check failed. The status
  is aggregate-only and never stores provider credentials or chat content.
- **Scheduled output is Markdown only.** The background worker rejects scheduled
  PDF. The UI must state this plainly, must not offer a scheduled PDF control,
  and must point the user to manual Current Chat / Bulk Export for PDF.
- **Naming and folder rules are shared.** The filename pattern and download-folder
  strategy apply to scheduled *and* manual Markdown downloads. The live filename
  preview shows the final path shape (folder + name + extension), not an abstract
  template.
- **Bulk export is a first-class workflow.** The conversation library exposed by
  the current provider — with selection, select-all, refresh, progress, and
  format — is a visible peer of the single-chat flow, not a hidden tab.

## 2. Design direction — Archive Desk

A calm, exact control surface for preserving a personal archive. It should feel
like a carefully edited document-management tool: a librarian's desk, not a SaaS
dashboard. Restraint is the brand. Nothing glows, nothing floats, nothing shouts.

**Signature element — the schedule rail.** When the optional panel is open, the
rail answers, before any detailed control, three questions: *Is the archivist on
or off? When does it wake? What exactly will it produce and where does the file
land?* The collapsed header keeps the On/Off state visible so the optional
feature does not dominate the page for users who do not need it.

**What we avoid:** glassmorphism, neon, gradients, bento-card sprawl, generic
centered landing-page stacks, purple AI styling, pill confetti, fake metrics,
and any copy that implies precision the system does not have.

## 3. Visual system

### Color (light)

| Token | Value | Use |
| --- | --- | --- |
| paper | `#F7F5F0` | page/primary background |
| ink | `#16211E` | primary text, headings |
| slate | `#52615B` | secondary text, descriptions |
| rule | `#D9DDD5` | hairlines, borders, dividers |
| archive blue | `#135E73` | primary action, focus, selected state |
| signal amber | `#B86921` | caution/limitation notes (e.g. Markdown-only) |
| success | `#2F6B45` | completed states |

Derived neutrals (hover, tertiary text, raised surfaces) are steps between paper,
slate, and rule — never pure gray, never pure white. Error is a warm brick in the
same family, not alarm red.

### Color (dark)

Dark mode keeps the **same hierarchy**, translated — not a neon inverse.
Backgrounds become deep ink-green (`#171D1B` family), text becomes warm
off-white, archive blue lightens to a desaturated steel blue for contrast, amber
and success lighten in kind. Borders stay quiet hairlines. No saturated glows,
no pure black.

### Typography

- A serif display face (system serif stack) for the masthead and card titles —
  the “edited document” voice.
- The system sans stack for UI labels, controls, and body copy.
- A mono stack for filenames, patterns, times, and the schedule rail's output
  contract — anything that is literal data.
- Hierarchy by weight and size, not by color alone; section labels are small,
  letter-spaced capitals in slate.

### Structure

- A structured editorial grid: the settings page uses a 12-column grid with
  full-width ledger cards; the popup uses a single calm column with clear
  horizontal rules.
- Compact but breathable rows: label + description on the left, control on the
  right; hairline rules separate groups.
- **One primary action per context.** Current Chat → the export button.
  Library → the bulk export button. Settings → autosaves; its only buttons are
  deliberate secondary actions (Run now, Clear history, Reset).
- Platform schedules read as a ledger: one row per provider, columns for
  cadence, time, and cap. Time/day controls appear inline, only when the chosen
  frequency uses them.

### Motion & interaction

- Transitions are short (≤ 200 ms), ease-out, and limited to color/opacity and
  small translations. No bouncy springs, no parallax.
- `prefers-reduced-motion` disables animation and transition globally.
- Every interactive element has a visible focus ring in archive blue; controls
  are reachable and operable by keyboard (chips and clickable rows are real
  `<button>`s or labelled `<input>`s).

### Accessibility

- WCAG AA contrast for all text on its background, in both themes.
- Toggles remain `role="switch"` checkboxes with associated `<label>`s.
- Selection rows in the library are real labelled checkboxes; select-all and
  clear are explicit controls with visible labels.
- Status messages keep `role="alert"` / `aria-live` semantics.

## 4. Information architecture

### Popup

1. **Masthead** — wordmark (serif), open-source note, theme and settings actions.
2. **Two visible modes** — `Current Chat` and `Bulk Export`, rendered as an
   editorial segmented switch. Bulk is not demoted or hidden.
3. **Current Chat** — detected document card (platform, title, message count,
   estimated size, Live Preview link), format choice, the single primary export
   action, then a collapsible “Advanced Export Options” region (naming, content
   toggles, PDF-only settings shown only for PDF).
4. **Bulk Export (Library)** — provider and refresh in one header row; the
   library list with a built-in selection toolbar (count, select all, clear);
   progress readout while running; format and the primary export action at the
   foot of the list. The library is the star of this mode.

### Settings page

1. **Hero** — kicker + serif title, version, theme toggle.
2. **General & Appearance** — default format, theme, language, download-folder
   strategy (with custom subfolder when chosen).
3. **Export Content** — content elements, PDF-only group, structure.
4. **Filename Pattern** — pattern editor with reset, and a live preview rendered
   as the true destination path (folder strategy + pattern + extension), with a
   note that the same naming applies to scheduled and manual Markdown exports.
5. **Scheduled Auto-Export** — the signature schedule rail (state, cadence,
   output contract) → global enable → per-provider ledger (frequency, conditional
   time/day, per-run cap, next run, sign-in/request state) → run limits and
   housekeeping → status (last run, exported/failed, errors) with Run now and
   Clear actions.
6. **About** — version, license, repository link.

## 5. Copy rules

- All user-facing strings go through the existing `t()`/`T()` localization with
  existing keys reused wherever they match. New strings use concise English as
  the key, which renders as the English fallback in every locale; the i18n tables
  are intentionally not expanded in this pass.
- Scheduled-time copy always says “at or shortly after”, and the worker cadence
  plus the Chrome-must-be-running requirement are stated next to the controls
  they qualify.
- The Markdown-only limitation is stated as fact in the rail (signal amber),
  with the pointer that PDF remains available from manual Current Chat and Bulk
  Export. No disabled PDF select that implies it could be scheduled.

## 6. Implementation passes

- **Pass 1 — composition & IA:** rebuild the JSX of popup, options, and the six
  shared components to the structure above; wire `timeOfDay`/`dayOfWeek` into the
  per-provider ledger; turn `ConversationList`'s unused selection props into its
  visible toolbar.
- **Pass 2 — polish:** replace both stylesheets' token layer with the Archive
  Desk palette (light + dark), then spacing, hover, focus-visible rings, and
  reduced-motion rules. Remove gradient fills in favor of flat paper tones.
- **Verify:** `npm run lint` (TypeScript) must pass. Behavior, storage keys,
  message types, and export integrations are unchanged.

## 7. Speed and bulk-export extension — Archive Dispatch

### Product truth

- A scheduled run may work across providers in parallel. Each provider has its
  own **conversation concurrency** control: `1` is the default and recommended
  starting point because providers use different private web APIs. Raising the
  value can shorten a run when requests are slow, but it also raises the chance
  of a provider-side rate limit; it is a user choice, not a promise of a safe
  quota.
- The configured request delay still spaces the start of detail requests within
  a provider. Concurrency controls how many already-started reads may overlap;
  it does not claim to bypass provider-side limits.
- If a direct detail request is rate limited, the task status must name the
  affected provider without storing a chat title, ID, URL, token, or raw error.
  If a page fallback completes the export, the UI must say that the rate limit
  was recovered rather than misclassifying the export as a clean API success.
- A bulk export is a bounded dispatch: users choose a date range and a maximum
  number of conversations before sending it. The selection toolbar remains
  available for precise exceptions.
- Downloads are browser-managed. The extension can choose a Downloads
  subfolder, but cannot silently write to an arbitrary absolute local path.
- Every long-running dispatch has a visible **Stop** action. Stop means no new
  conversation fetches or download requests are started; a file Chrome has
  already begun is allowed to finish.

### Surface direction

- **Metaphor:** an archive dispatch slip, placed beside the material settings
  that determine where each record lands.
- **Signature:** a compact destination strip: `Destination / Name / Output` is
  readable at a glance and expands in place for pattern editing. It replaces
  the isolated filename card beneath the settings grid.
- **Bulk workbench:** filter strip (from / to / cap) → selection count → start
  or stop action → honest progress and failure summary. A start date after an
  end date is an inline error, never a silent empty selection. No fake speed
  metrics.
- **Concurrency controls:** the cross-provider control is a select, not a bare
  number: `1 — one platform at a time`, `2 — Balanced (recommended)`, or
  `3 — fastest`. Its description makes clear that it is independent from
  per-provider conversation concurrency. Each enabled provider row includes the
  same-height `Conversation concurrency` control, marked `1 — Recommended` by
  default, plus a compact note explaining the speed/rate-limit trade-off. The
  last-run panel uses a warning treatment for named rate-limited providers and
  points the user back to this control and the request delay. The delay is
  described precisely as the minimum interval between starts of detail reads
  within one provider, not as a page-load delay.

### Strictly avoid

- A raw filesystem path input that promises browser permissions the extension
  does not have.
- A single unexplained “maximum” field. Every cap labels what it controls and
  why it exists.
- A destructive Stop button without clarifying that a file already handed to
  Chrome may finish.

### Out of scope pending sign-off

- User-selected font families in exported PDF/Markdown output. This needs a
  feasibility and licensing assessment before implementation.
