# AI Chat Exporter — Development Guide

## Architecture Overview

```
ai-chat-exporter/
├── src/
│   ├── popup.tsx              ← Main popup UI (Current + Bulk tabs)
│   ├── options.tsx            ← Settings page (full tab)
│   ├── background.ts          ← Service worker (message routing)
│   ├── contents/
│   │   ├── chatgpt-parser.ts  ← ChatGPT DOM parser + API list fetcher
│   │   ├── gemini-parser.ts   ← Gemini DOM parser + API list fetcher
│   │   ├── claude-parser.ts   ← Claude DOM parser + API list fetcher
│   │   ├── deepseek-parser.ts ← DeepSeek DOM parser + API list fetcher
│   │   └── grok-parser.ts     ← Grok DOM parser + API list fetcher
│   ├── lib/
│   │   ├── types.ts           ← All TypeScript interfaces & constants
│   │   ├── dom-utils.ts       ← Shared DOM helpers (text extraction, code blocks)
│   │   ├── export-markdown.ts ← Conversation → Markdown converter
│   │   ├── export-pdf.ts      ← Conversation → PDF (html2canvas + jsPDF)
│   │   └── filename.ts        ← Filename template engine ({date}, {title}, etc.)
│   ├── components/
│   │   ├── FormatSelector.tsx  ← PDF / Markdown toggle buttons
│   │   ├── ExportButton.tsx    ← Main CTA with spinner + success states
│   │   ├── FilenameEditor.tsx  ← Pattern input with variable chips + preview
│   │   └── ConversationList.tsx← Checkbox list for bulk export
│   ├── styles/
│   │   ├── popup.css           ← Popup design system (CSS custom properties)
│   │   ├── options.css         ← Options page styles
│   │   └── print.css           ← Preview page + print media query
│   └── tabs/
│       └── preview.tsx         ← Full-page conversation preview
├── tests/                      ← Vitest test suite (320 tests)
├── build/chrome-mv3-prod/      ← Extension build output (load this in Chrome)
└── GUIDE.md                    ← This file
```

## Design System (Gemini-Designed)

All styles use CSS custom properties defined in `src/styles/popup.css`.

### Color Palette
| Variable         | Light      | Dark       | Usage              |
|------------------|------------|------------|---------------------|
| --bg-primary     | #ffffff    | #0f172a    | Card backgrounds    |
| --bg-secondary   | #f9fafb    | #1e293b    | Subtle backgrounds  |
| --text-primary   | #111827    | #f8fafc    | Main text           |
| --text-secondary | #4b5563    | #cbd5e1    | Muted text          |
| --primary        | #6366f1    | #6366f1    | Buttons, accents    |
| --success        | #22c55e    | #22c55e    | Success messages    |
| --error          | #ef4444    | #ef4444    | Error messages      |

### Geometry
| Variable     | Value  | Usage           |
|--------------|--------|-----------------|
| --radius-sm  | 4px    | Chips, badges   |
| --radius-md  | 8px    | Cards, inputs   |
| --radius-lg  | 12px   | Chat bubbles    |
| --radius-full| 9999px | Pills, toggles  |

### Typography
Font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`

## How Each Feature Works

### 1. Platform Auto-Detection
- `popup.tsx` → `detectPlatformFromUrl(tab.url)` checks hostname
- chatgpt.com → 'chatgpt' (green badge)
- gemini.google.com → 'gemini' (blue badge)
- Content scripts only inject on matching URLs via manifest matches

### 2. Conversation Parsing (DOM)
- `chatgpt-parser.ts` → reads `[data-message-author-role]` elements
- `gemini-parser.ts` → reads `.user-query` / `.model-response` elements
- Both extract: role, content text, code blocks, images
- Results stored in `chrome.storage.local` keyed by conversation ID

### 3. Conversation List Fetching (API)
For bulk export, DOM-only only sees ~20 sidebar items. API approach fetches ALL:

**ChatGPT:**
1. GET `https://chatgpt.com/api/auth/session` → access token
2. GET `https://chatgpt.com/backend-api/conversations?offset=0&limit=100`
3. Paginate until no more items
4. 401 → retry once (token refresh)

**Gemini:**
1. Extract SNlM0e token from page scripts
2. POST `https://gemini.google.com/_/BardChatUi/data/batchexecute`
3. Parse protobuf-like response for conversation list
4. Paginate via nextPageToken

### 4. Export Formats

**Markdown** (`export-markdown.ts`):
- Header with metadata (title, platform, URL, date)
- Each message: `### 👤 User` / `### 🤖 Assistant`
- Code blocks: triple backtick with language
- Images: `![alt](url)`
- Auto-downloads via `chrome.downloads.download({ saveAs: false })`

**PDF** (`export-pdf.ts`):
- Generates styled HTML from conversation
- Uses html2canvas to render to canvas
- Uses jsPDF to create multi-page PDF
- Auto-downloads via `chrome.downloads.download({ saveAs: false })`

### 5. Filename Templates
Pattern string with `{variable}` tokens:
- `{date}` → 2026-06-11 (export/current date)
- `{datetime}` → 2026-06-11T143022 (export/current date+time)
- `{conv_date}` → 2026-06-08 (conversation start date from createdAt)
- `{conv_datetime}` → 2026-06-08T093000 (conversation start date+time)
- `{end_date}` → 2026-06-11 (alias for export date)
- `{title}` → my-conversation-title (sanitized from actual session title)
- `{platform}` → chatgpt or gemini
- `{index}` → 001 (zero-padded, for bulk)
- `{msgcount}` → 24

Engine: `src/lib/filename.ts` → `generateFilename(pattern, conversation, index?)`

### 6. Download Folders
Setting in options: 'default' | 'by-platform' | 'custom'
- default: files go to Downloads root
- by-platform: `ChatGPT/filename.md`, `Gemini/filename.pdf`, `Claude/filename.md`, `DeepSeek/filename.pdf`, or `Grok/filename.md`
- custom: `MyCustomFolder/filename.md`

Implemented in popup.tsx → `buildDownloadFilename()` prepends folder to filename.

### 7. Bulk Export Flow
1. User opens Bulk tab → `fetchConversationList()` called
2. Tries API-based FETCH_ALL_CONVERSATIONS first
3. Falls back to DOM-based FETCH_CONVERSATION_LIST
4. User selects conversations (checkboxes)
5. Clicks "Export N Selected"
6. Loops through selected, exports each with progress bar
7. Each file auto-downloads to configured folder

## Message Protocol

Extension uses `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`:

| Message Type              | Direction       | Payload                    | Response              |
|--------------------------|-----------------|----------------------------|-----------------------|
| PARSE_CONVERSATION       | popup → content | {}                         | { data: Conversation }|
| DETECT_PLATFORM          | popup → content | {}                         | { data: { platform } }|
| FETCH_CONVERSATION_LIST  | popup → content | {}                         | { data: ConvItem[] }  |
| FETCH_ALL_CONVERSATIONS  | popup → content | {}                         | { data: ConvItem[] }  |

## Testing

Framework: Vitest with jsdom environment

```
npm test           # Run all 320 tests
npx vitest run     # Same
npx vitest watch   # Watch mode
```

Test files:
- `tests/chatgpt-parser.test.ts` — DOM parsing (16 tests)
- `tests/gemini-parser.test.ts` — DOM parsing (16 tests)
- `tests/export-markdown.test.ts` — Markdown generation (15 tests)
- `tests/export-pdf.test.ts` — PDF/HTML generation (18 tests)
- `tests/dom-utils.test.ts` — Shared utilities (47 tests)
- `tests/filename.test.ts` — Filename templates (19 tests)
- `tests/bulk-export.test.ts` — Bulk export logic (15 tests)
- `tests/auto-download.test.ts` — Download behavior (7 tests)
- `tests/platform-detection.test.ts` — URL detection + folders (16 tests)
- `tests/conversation-list-api.test.ts` — API pagination (13 tests)

## Build & Load

```bash
# Install dependencies
npm install

# Development build (watch mode)
npx plasmo dev

# Production build
npx plasmo build

# Load in Chrome:
# 1. Open chrome://extensions/
# 2. Enable Developer mode
# 3. Click "Load unpacked"
# 4. Select: build/chrome-mv3-prod/
```

## Key Design Decisions

1. **DOM-first parsing**: Reads rendered HTML, not internal APIs. Legally clean.
2. **API for lists only**: Uses public session API for conversation INDEX only.
   Content is still parsed from DOM. Same endpoints the browser itself uses.
3. **No debugger permission**: Original needed it for session tokens.
   We use fetch from content script context instead.
4. **Minimal permissions**: Only storage, activeTab, downloads.
5. **CSS custom properties**: Gemini's design system supports light/dark themes.
6. **html2canvas + jsPDF for PDF**: No print dialog, actual file download.
7. **Auto-download**: saveAs=false everywhere. User chose export = consent.

## Adding a New Platform

1. Create `src/contents/newplatform-parser.ts`
   - Implement `PlatformParser` interface from types.ts
   - Add `getConversationList()` for bulk support
   - Add message handlers for PARSE_CONVERSATION, FETCH_ALL_CONVERSATIONS

2. Update `src/lib/types.ts`
   - Add platform to the union type

3. Update `src/popup.tsx`
   - Add hostname detection in `detectPlatformFromUrl()`
   - Add badge color

4. Update the content script's exported `config.matches`
   - Add the platform URL pattern to `src/contents/newplatform-parser.ts`

5. Add tests in `tests/newplatform-parser.test.ts`

6. Update `buildDownloadFilename()` for new platform folder name
