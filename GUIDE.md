# AI Chat Exporter — Development Guide

## Architecture Overview

```
ai-chat-exporter/
├── src/
│   ├── popup.tsx               ← Main popup UI (Current + Bulk tabs)
│   ├── options.tsx             ← Settings page (full tab)
│   ├── background.ts           ← Service worker + scheduled export
│   ├── contents/
│   │   ├── chatgpt-parser.ts   ← ChatGPT parser/API integration
│   │   ├── gemini-parser.ts    ← Gemini parser/API integration
│   │   ├── claude-parser.ts    ← Claude DOM + authoritative API detail/tree validation
│   │   ├── deepseek-parser.ts  ← DeepSeek parser/API integration
│   │   └── grok-parser.ts      ← Grok parser/API integration
│   ├── lib/
│   │   ├── types.ts            ← Shared contracts, source metadata, defaults
│   │   ├── parser-runtime.ts   ← Shared provider message runtime
│   │   ├── conversation-integrity.ts ← Transcript shape + exportability gates
│   │   ├── parser-fallback.ts  ← DOM/API comparison + rendered-media alignment
│   │   ├── scheduled-export.ts ← Scheduled-export policy and helpers
│   │   ├── dom-utils.ts        ← Shared DOM helpers
│   │   ├── export-markdown.ts  ← Conversation → Markdown converter
│   │   ├── export-pdf.ts       ← Conversation → PDF
│   │   └── filename.ts         ← Filename template engine
│   ├── components/
│   │   ├── FormatSelector.tsx
│   │   ├── ExportButton.tsx
│   │   ├── FilenameEditor.tsx
│   │   └── ConversationList.tsx
│   ├── styles/
│   │   ├── popup.css
│   │   ├── options.css
│   │   └── print.css
│   └── tabs/
│       └── preview.tsx
├── tests/                       ← Vitest regression/integration suite
├── build/chrome-mv3-prod/       ← Extension build output
├── DOGFOOD-TEST-MATRIX.md       ← Manual acceptance matrix
└── GUIDE.md
```

## Design System

All styles use CSS custom properties defined in `src/styles/popup.css`.

### Color Palette
| Variable | Light | Dark | Usage |
|---|---|---|---|
| `--bg-primary` | `#ffffff` | `#0f172a` | Card backgrounds |
| `--bg-secondary` | `#f9fafb` | `#1e293b` | Subtle backgrounds |
| `--text-primary` | `#111827` | `#f8fafc` | Main text |
| `--text-secondary` | `#4b5563` | `#cbd5e1` | Muted text |
| `--primary` | `#6366f1` | `#6366f1` | Buttons, accents |
| `--success` | `#22c55e` | `#22c55e` | Success messages |
| `--error` | `#ef4444` | `#ef4444` | Error messages |

### Geometry
| Variable | Value | Usage |
|---|---|---|
| `--radius-sm` | `4px` | Chips, badges |
| `--radius-md` | `8px` | Cards, inputs |
| `--radius-lg` | `12px` | Chat bubbles |
| `--radius-full` | `9999px` | Pills, toggles |

### Typography
Font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`

## Core Data-Integrity Model

The exporter intentionally separates **what the transcript looks like** from **whether its source proves completeness**.

`Conversation` may carry:

- `source`: `api`, `dom`, or `mixed`
- `sourceCompleteness`: `verified` or `unverified`

`conversation-integrity.ts` provides two related checks:

- transcript-shape analysis: message counts, recognized roles, empty content, one-sided conversations
- exportability: whether this source is safe to save as an archive

A provider-verified API transcript may legitimately be one-sided (for example the user stopped generation). An explicitly unverified DOM snapshot is never promoted to a complete archive merely because it contains both user and assistant turns.

### Claude-specific authority rule

Claude virtualizes long histories in the live DOM. Therefore:

1. DOM parsing remains useful for rendered formatting/media and page state.
2. Claude DOM conversations are marked `sourceCompleteness: 'unverified'`.
3. Current/detail export requires provider API detail.
4. Claude's active API branch must be structurally valid: the selected leaf's parent chain must reach a real root with no missing parent or cycle.
5. A failed/unverifiable Claude API detail request produces a visible error. It does **not** silently downgrade to DOM for archival export.

Do not replace this structural rule with message-count ratios such as “80 records became 8”. A legitimate active fork may be short while abandoned branches are much larger; conversely, a small response can still have a broken parent chain.

## How Each Feature Works

### 1. Platform Auto-Detection

`popup.tsx` checks the active tab hostname and maps it to a supported provider. Provider content scripts are injected only on their configured matches.

### 2. Current Conversation Parsing

Each provider parser implements the shared `ParserRuntimeParser` contract used by `parser-runtime.ts`.

Typical flow:

1. Parse the currently rendered page.
2. Resolve current conversation ID.
3. Fetch provider detail when supported/required.
4. Apply provider-specific source authority rules.
5. Return the exportable conversation or an explicit failure.

For Claude, API detail is authoritative and the DOM is enrichment-only for archive purposes.

### 3. Claude Active-Branch Resolution

Claude API detail may return a tree containing regenerated/abandoned siblings. `resolveClaudeActiveBranch()` selects one branch using, in order:

1. explicit current/active leaf pointer when supplied by the provider;
2. provider active flags;
3. the longest structurally complete leaf chain when no active pointer exists.

A selected chain is accepted only if it reaches a root. Missing parents, cycles, or an explicit leaf that is absent from the payload are treated as integrity failures.

### 4. Conversation List Fetching (Bulk)

Bulk history uses provider APIs where available. History completeness is separate from the number of items currently returned.

For providers that expose list metadata, responses may include:

```ts
{
  data: ConversationListItem[],
  meta: {
    source: 'api' | 'sidebar',
    complete: boolean,
    pagesFetched?: number
  }
}
```

For Claude specifically, if page 1 succeeds but a later page fails, the items already retrieved may still be shown, but the UI must label the history as **partial**. Sidebar fallback is also explicitly incomplete.

### 5. Rendered Media Enrichment

Provider API text/order remains authoritative when it wins source selection, but the live DOM can contain browser-resolved image URLs unavailable in the API payload.

`mergeRenderedImageAttachments()` aligns rendered messages to authoritative messages using:

1. exact provider message ID;
2. unique normalized message text;
3. same-role ordinal position counted from the **end** of the rendered window plus text similarity.

The third rule is important for virtualized chats. For example, API messages `72..79` may correspond to DOM indexes `0..7`; raw array-index equality is not a valid alignment rule.

Media enrichment must remain conservative: unrelated same-role turns must never receive an image merely because their positions are similar.

### 6. Export Formats

**Markdown** (`export-markdown.ts`):
- optional metadata header
- role-labelled messages in conversation order
- fenced code blocks
- Markdown images/attachment references
- artifact section when enabled

**PDF** (`export-pdf.ts`):
- styled HTML representation
- multi-page rendering
- optional searchable/copyable text layer
- direct download through extension download handling

### 7. Filename Templates

Pattern tokens include:

- `{date}` — conversation start date, export-date fallback
- `{datetime}` — conversation start date/time, export-time fallback
- `{conv_date}` / `{conv_datetime}` — explicit conversation-date aliases
- `{end_date}` — export date
- `{title}` — sanitized conversation title
- `{platform}` — provider key
- `{index}` — zero-padded bulk index
- `{msgcount}` — exported message count

Engine: `src/lib/filename.ts` → `generateFilename(pattern, conversation, index?)`

### 8. Download Folders

Setting: `default | by-platform | custom`.

Browser-extension downloads remain inside the browser's download flow. Interactive exports may use Save As; scheduled exports do not open a chooser.

### 9. Bulk Export Flow

1. User opens Bulk tab.
2. Fetch provider history via `FETCH_ALL_CONVERSATIONS` where supported.
3. Display source/completeness state when available.
4. User selects conversations.
5. Fetch each authoritative detail sequentially/with bounded provider traffic.
6. Validate exportability.
7. Render/download each valid conversation; one failed item does not abort the whole queue.
8. Record completed exports for deduplication.

For Claude, foreground bulk does not open a background tab merely to repeat the same authoritative API path after a deterministic detail failure.

### 10. Scheduled Export

Scheduled export uses the same exportability contract as manual/bulk export. It must not create a weaker archive merely because it is running in the background.

Provider requests are paced/bounded, run state is persisted, completed exports are deduplicated, and safe aggregate failure categories are retained without storing conversation text in diagnostics.

### 11. Retry Behavior

`parser-runtime.ts` briefly caches deterministic authoritative-detail failures so background hydration loops do not hit the same provider endpoint every ~750 ms.

A user-triggered Retry/Refresh explicitly bypasses that cooldown and performs a fresh verification attempt. Background polling and user intent must not share the same retry semantics.

## Message Protocol

Extension communication uses `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`.

| Message Type | Direction | Typical response |
|---|---|---|
| `PARSE_CONVERSATION` | popup → content | `{ data: Conversation, meta? }` or `{ error, meta? }` |
| `DETECT_PLATFORM` | popup → content | `{ data: { platform, ... } }` |
| `FETCH_CONVERSATION_LIST` | popup → content | `{ data: ConversationListItem[] }` |
| `FETCH_ALL_CONVERSATIONS` | popup → content | `{ data, meta: { source?, complete?, ... } }` |
| `FETCH_CONVERSATION_DETAIL` | popup/background → content | `{ data: Conversation, meta? }` or `{ error, meta? }` |

Provider-specific metadata is part of the integrity surface; callers should not discard it when the UI needs to distinguish verified, partial, or sidebar-only data.

## Testing

Framework: Vitest with jsdom environment.

```bash
npm test
npm run lint
npm run build
npx vitest watch
```

Do not document fixed total test counts here; the suite changes frequently. Important regression areas include:

- provider DOM/API parsing
- Claude active-branch structural validation
- source verification/exportability
- partial history pagination
- virtualized-tail media alignment
- Markdown/PDF rendering
- scheduled export policy
- download completion/cancellation
- filename/date handling

Manual acceptance criteria live in `DOGFOOD-TEST-MATRIX.md`.

## Build & Load

```bash
npm ci
npx plasmo dev
npm run build
```

Load the production Chrome build from `build/chrome-mv3-prod/` via `chrome://extensions/` → Developer mode → Load unpacked.

## Key Design Decisions

1. **Provider-specific authority, not one universal fallback rule.** A DOM fallback is acceptable only for providers/paths where it is known to be safe. Claude detail export explicitly requires verified API data.
2. **Source completeness is first-class.** A balanced-looking transcript is not proof that a virtualized DOM contains the whole chat.
3. **Structural branch validation beats count heuristics.** Claude active-branch correctness is proven by parent linkage, not message ratios.
4. **API text/order + DOM media enrichment.** Rendered media can enrich a confidently matched API turn without changing authoritative ordering or inventing attachments for another turn.
5. **Visible failure beats silent data loss.** If completeness cannot be verified for a provider that requires it, stop the archive and explain why.
6. **Manual, bulk, preview, and scheduled paths share the same exportability contract.**
7. **Bound provider traffic.** Cooldowns, pacing, and sequential/bounded detail reads prevent fallback loops from becoming rate-limit storms.
8. **Minimal permissions and explicit browser download behavior.**

## Adding a New Platform

1. Create `src/contents/newplatform-parser.ts` and implement the methods required by `ParserRuntimeParser`.
2. Decide and document the provider's source-authority policy:
   - Is DOM sufficient for archive completeness?
   - Is API detail required?
   - Can a page-level fallback safely recover detail?
   - How is branch/history completeness proven?
3. Populate `Conversation.source` / `sourceCompleteness` when the provider can state them confidently.
4. Register the shared parser runtime with provider-specific policy flags/handlers.
5. Add hostname detection and platform unions/labels.
6. Add regression tests for normal, incomplete, authentication, long-chat, and media cases.
7. Add manual acceptance cases to `DOGFOOD-TEST-MATRIX.md`.

A new provider should never inherit a fallback policy solely because another provider uses it.
