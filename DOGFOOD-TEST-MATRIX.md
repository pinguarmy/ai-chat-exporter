# Current Dogfood QA Matrix — AI Chat Exporter

> Platforms: ChatGPT · Gemini · Claude · DeepSeek · Grok
> Formats: Markdown · PDF
> Integrity policy updated: 2026-08-15

---

## 1 — Basic Single-Export Smoke Test (all 5 platforms)

**Scenario:** Open a simple 3-turn conversation on each platform → click Export → choose Markdown → click Export.

**Steps per platform:**
1. Navigate to a known conversation with ~3 user/assistant turns
2. Click extension icon → verify platform detected correctly
3. Select "Markdown" → click "Export"
4. Verify file downloads

**Pass criteria:**
- [ ] Platform auto-detected (popup shows correct platform name)
- [ ] `.md` file downloads to `Downloads/` (default folder)
- [ ] File contains `# <title>` header, metadata block, user/assistant messages in order
- [ ] Footer contains `*Exported from <PlatformName> on <date>*`
- [ ] Repeat for PDF: valid PDF opens, has title + messages + footer

---

## 2 — Code Block Preservation (all platforms)

**Scenario:** Export a conversation containing fenced code blocks with language tags.

**Test data:** A conversation where the assistant replies with a triple-backtick code block (e.g. ````python ... ```), an unlabeled code block, and inline code.

**Pass criteria (Markdown):**
- [ ] Fenced blocks appear as ```` ```<language> ```` in output
- [ ] Language tag preserved (e.g. `python`, `javascript`, or empty)
- [ ] Indentation/whitespace inside code block preserved
- [ ] Inline backtick code not confused with block delimiters

**Pass criteria (PDF):**
- [ ] Code block renders with monospace font
- [ ] Syntax-highlighted block has distinct visual style vs. body text

---

## 3 — LaTeX / Math Equations (ChatGPT, Gemini, Claude)

**Scenario:** Export a conversation where the assistant replies with LaTeX formulas (inline `$...$` and display `$$...$$`).

**Pass criteria (Markdown):**
- [ ] LaTeX expressions preserved verbatim in the markdown (not HTML-encoded)
- [ ] Both inline `$x^2$` and display `$$\int f(x) dx$$` are intact

**Pass criteria (PDF):**
- [ ] LaTeX renders as formatted math (not raw `$` symbols)

---

## 4 — Images & Attachments

**Scenario:** Export a conversation containing uploaded images (user attachments) and assistant-generated images.

**Test data:** A conversation where the user uploaded a screenshot and the assistant replied with an inline image.

**Pass criteria (Markdown):**
- [ ] Images render as `![alt text](url)` in markdown
- [ ] Image alt text or caption preserved (if available)
- [ ] Non-image attachments (files, links) listed under `**Attachments:**`
- [ ] API text remains authoritative when DOM only contributes the browser-resolved image URL
- [ ] In a virtualized long chat, media from a DOM tail turn is merged into the matching API turn, not the same raw array index

**Pass criteria (PDF):**
- [ ] Images embedded in the PDF at a reasonable size
- [ ] Broken/missing images don't crash the export

---

## 5 — Claude Artifacts (tool_use, tool_result, document blocks)

**Scenario:** Export a Claude conversation where the assistant created an artifact (e.g., an HTML page or code document).

**Test data:** A conversation with `tool_use` (name: `artifacts`) containing `input.content` and a follow-up `tool_result`.

**Pass criteria:**
- [ ] Artifact content captured (type: code/html based on tool name)
- [ ] Artifact title extracted from `input.title`
- [ ] Tool use JSON appears as text in the message: `Tool use: artifacts`
- [ ] Tool result content merged into message text
- [ ] Multiple artifacts in one conversation each captured separately
- [ ] `document` type blocks extract title + content + mimeType

---

## 6 — Gemini Research / Document Artifacts

**Scenario:** Export a Gemini conversation containing a research document or generated document artifact.

**Test data:** A Gemini conversation where the model produced a multi-section document with headers, tables, or embedded links.

**Pass criteria:**
- [ ] Document section headers preserved as markdown `#` / `##`
- [ ] Table content rendered (as markdown table or text)
- [ ] Links within the document preserved
- [ ] If API detail fetch succeeds: richer formatting than DOM-only parse
- [ ] If API fails: Gemini's supported DOM fallback still produces readable output

---

## 7 — Long Conversation (50+ turns)

**Scenario:** Export a long conversation (50+ messages, mixed user/assistant).

**Pass criteria (Markdown):**
- [ ] All 50+ messages present in order
- [ ] No truncation — file size scales with content
- [ ] Metadata shows correct message count
- [ ] Footer `---` separator still present at end
- [ ] Claude: exported transcript comes from a provider-verified API source, not a virtualized DOM snapshot
- [ ] Claude: selected active branch structurally reaches a real root; missing-parent or cyclic chains are rejected

**Pass criteria (PDF):**
- [ ] All content rendered across multiple pages
- [ ] Page breaks don't split mid-code-block
- [ ] File renders smoothly in PDF viewer (no corruption)

---

## 8 — Unicode / CJK Title & Filename

**Scenario:** Export a conversation titled in Chinese characters (e.g. "父亲体检报告分析与病情评估").

**Pass criteria:**
- [ ] Title preserved correctly in markdown header: `# 父亲体检报告分析与病情评估`
- [ ] Filename contains CJK characters: `2026-07-08-父亲体检报告分析与病情评估.md`
- [ ] File saves without error on macOS
- [ ] No filename encoding issues or replacement with underscores

---

## 9 — Filename Template Tokens

**Scenario:** Set a custom filename pattern `{platform}-{conv_date}-{title}-{msgcount}` and export.

**Pass criteria:**
- [ ] `{platform}` → `chatgpt` / `gemini` / `claude` / `deepseek` / `grok`
- [ ] `{conv_date}` → `YYYY-MM-DD` from conversation creation date
- [ ] `{title}` → sanitized (spaces→hyphens, unsafe chars removed, truncated to 200)
- [ ] `{msgcount}` → actual message count
- [ ] `{date}` → conversation start date (falls back to export time when unavailable)
- [ ] `{datetime}` → conversation start date/time (`YYYY-MM-DDTHHmmss`, with the same fallback)
- [ ] Missing tokens (e.g. no `createdAt`) fall back to current date

---

## 10 — Download Folder Modes

**Scenario:** Toggle between Default, By-Platform, and Custom folder modes in settings, then export.

**Pass criteria:**
| Mode | Expected path |
|------|--------------|
| `default` | `Downloads/2026-07-08-my-title.md` |
| `by-platform` | `Downloads/ChatGPT/2026-07-08-my-title.md` |
| `by-platform` (Claude) | `Downloads/Claude/2026-07-08-my-title.md` |
| `custom` ("我的导出") | `Downloads/我的导出/2026-07-08-my-title.md` |
| `custom` (unsafe `../Bad:Name*?`) | `Downloads/_Bad_Folder_Name_/2026-07-08-my-title.md` |
| `custom` (empty string) | `Downloads/AI Chat Exports/2026-07-08-my-title.md` |

---

## 11 — Bulk Export (ChatGPT, Claude, DeepSeek, Grok)

**Scenario:** Navigate to a supported platform → click Bulk tab → wait for list → select 5 conversations → Export Selected.

**Pass criteria:**
- [ ] Conversation list loads from provider history API where supported
- [ ] List shows title and provider dates/counts when available
- [ ] Checkboxes allow selecting/deselecting
- [ ] "Export Selected" processes each conversation without one failure blocking the remaining queue
- [ ] Progress indicator updates: fetching → exporting → done
- [ ] Each file downloads to correct path (respecting folder mode)
- [ ] Index token `{index}` produces `001`, `002`, etc.
- [ ] Failed conversations increment `failed` count
- [ ] Claude: a partially paginated API history is labeled partial; the returned count is never presented as the complete account history
- [ ] Claude: if API history is unavailable and sidebar items are shown, UI labels the source as incomplete/sidebar-only

---

## 12 — Gemini Bulk Export (batchexecute API)

**Scenario:** Navigate to gemini.google.com → Bulk tab → fetch conversation list.

**Pass criteria:**
- [ ] Auth token obtained from hook script (stored in `gemini_credentials_map`)
- [ ] Batchexecute API call uses correct RPC ID `MaZiqc`
- [ ] Conversation list parsed from response (items with ID + title)
- [ ] Fallback to DOM sidebar list if API returns empty
- [ ] Multi-account support: correct `f.sid` selected for current account slot (`/u/0/...`)

---

## 13 — Provider Detail Authority & DOM/API Fallback

**Scenario:** Open a conversation where the live DOM is partial or virtualized while the provider detail API has richer/full content.

**Pass criteria:**
- [ ] Providers that support a safe DOM fallback may choose the more complete usable source
- [ ] API Markdown/text remains authoritative when it is the verified source
- [ ] Rendered DOM may enrich a matched API turn with browser-resolved image URLs without replacing API ordering/text
- [ ] Claude: DOM is explicitly marked `sourceCompleteness: 'unverified'`
- [ ] Claude: current/detail export requires provider-verified API data; API failure does **not** silently fall back to DOM
- [ ] Claude: verification failure produces an explicit popup error and retry action, not an infinite spinner

---

## 14 — Empty & Edge-Case Conversations

**Scenario A:** Conversation has 0 messages.
**Scenario B:** Conversation has messages but all content is empty.
**Scenario C:** Conversation contains only a user message because generation was stopped/interrupted.

**Pass criteria:**
- [ ] Zero-message conversation is not exported as a successful archive
- [ ] All-empty conversation is not exported as a successful archive
- [ ] No undefined/NaN metadata or renderer crash in either failure case
- [ ] A provider-verified one-sided conversation is exportable when the authoritative source confirms that shape
- [ ] An unverified one-sided DOM snapshot is not treated as complete

---

## 15 — Special Characters & XSS Safety

**Scenario:** Export a conversation containing HTML entities, markdown-breaking characters, and potential XSS payloads in user messages.

**Test data:** Messages with `<script>alert(1)</script>`, `&amp;`, `| pipes |`, `> 45%`, `E=mc²`, emoji 🎉, Arabic text مرحبا.

**Pass criteria (Markdown):**
- [ ] `<script>` tag appears as literal text (not interpreted)
- [ ] `&amp;`, `&lt;` etc. preserved or decoded to readable characters
- [ ] Pipe characters don't break markdown table syntax
- [ ] Emoji and non-Latin text preserved

**Pass criteria (PDF):**
- [ ] HTML entities escaped properly via `escapeHtml()`
- [ ] Special chars render correctly (not as mojibake)

---

## 16 — Metadata Toggle

**Scenario:** Export the same conversation with `includeMetadata: true` and `includeMetadata: false`.

**Pass criteria (Markdown, metadata ON):**
- [ ] `# <title>` present
- [ ] `## Metadata` section with Platform, URL, Messages, Created

**Pass criteria (Markdown, metadata OFF):**
- [ ] No `# <title>` header
- [ ] No `## Metadata` section
- [ ] Messages still present with role labels

**Pass criteria (PDF, metadata ON):**
- [ ] `<h1>` with title
- [ ] `<div class="metadata">` with platform + message count

**Pass criteria (PDF, metadata OFF):**
- [ ] No `<h1>` or metadata div

---

## 17 — Code Blocks Deduplication in Markdown

**Scenario:** Export a conversation where the assistant's message already contains a fenced code block inline, AND also has extracted `codeBlocks[]` — verify no duplicate rendering.

**Pass criteria:**
- [ ] Markdown output contains the code block exactly once
- [ ] Long code blocks already in `content` are not re-emitted
- [ ] Additional extracted code blocks that are not already inline remain available

---

## 18 — Platform Label Consistency

**Scenario:** Export from each platform and verify the platform name appears consistently in metadata, headings, and footers.

| Platform key | Expected label |
|-------------|----------------|
| `chatgpt` | `ChatGPT` |
| `gemini` | `Google Gemini` |
| `claude` | `Claude` |
| `deepseek` | `DeepSeek` |
| `grok` | `Grok` |

**Pass criteria:**
- [ ] All 5 labels match exactly
- [ ] PDF HTML safely escapes labels

---

## 19 — Scheduled Export (background periodic)

**Scenario:** Enable scheduled export with bounded per-run limits and a configured cadence.

**Pass criteria:**
- [ ] Settings save to `chrome.storage` correctly
- [ ] Alarm fires at configured frequency
- [ ] Per-platform and global limits bound each run
- [ ] Request pacing limits provider traffic
- [ ] Exported record stored in dedup history (no re-export next run)
- [ ] Status tracks exported/failed counts and safe aggregate failure categories
- [ ] Scheduled detail export obeys the same source-verification/exportability contract as manual export

---

## 20 — Auth Expiration & Retry Behavior

**Scenario:** Simulate expired authentication or provider detail failure during current/bulk export.

**ChatGPT:** Existing token-refresh behavior should continue to recover where supported.
**Gemini:** Existing credential fallback chain should continue to recover where supported.
**Claude:** Session/API auth failure must not downgrade a current/detail archive to virtualized DOM.

**Pass criteria:**
- [ ] ChatGPT: supported token refresh path can continue the request
- [ ] Gemini: supported credential fallback chain works without an infinite spinner
- [ ] Claude: API/auth failure returns a visible verification/auth error; no DOM archive is silently produced
- [ ] Claude: background hydration loops do not hammer the same deterministic failure every ~750 ms
- [ ] Claude: a user-triggered Retry bypasses the background failure cooldown and performs a real fresh verification attempt

---

## 21 — Claude Active-Branch Structural Integrity

**Scenario A:** 80-record linear branch with explicit active leaf.
**Scenario B:** 80-record tree where the legitimate current fork contains only 8 records.
**Scenario C:** 15-record response whose selected branch has a missing parent.
**Scenario D:** selected branch contains a parent cycle.

**Pass criteria:**
- [ ] Linear 80-record branch exports all 80 records
- [ ] Legitimate short fork is accepted when its parent chain reaches root
- [ ] Missing-parent chain is rejected regardless of total record count
- [ ] Cycle is rejected
- [ ] No message-count ratio / magic threshold decides branch completeness

---

## 22 — Claude Source Verification Contract

**Scenario:** Compare a balanced live DOM snapshot against API detail for the same long conversation.

**Pass criteria:**
- [ ] Claude DOM snapshot carries `source: 'dom'` and `sourceCompleteness: 'unverified'`
- [ ] Structurally verified Claude API detail carries `source: 'api'` and `sourceCompleteness: 'verified'`
- [ ] `current`, `bulk`, `preview`, and scheduled/background export paths use the same exportability contract
- [ ] A verified one-sided API conversation may export
- [ ] An unverified DOM snapshot never becomes a successful archive merely because it contains both roles

---

## 23 — Virtualized Tail Media Alignment

**Scenario:** API contains 80 messages while the live DOM renders only messages 72–79. One late assistant turn contains a browser-resolved image and short text such as `See this image.`.

**Pass criteria:**
- [ ] Exact provider message ID wins when available
- [ ] Unique normalized message text can match even when short
- [ ] Remaining matches use same-role position counted from the end of the rendered window plus text similarity
- [ ] API message 77 can receive media from DOM tail index 5 without requiring raw index equality
- [ ] Repeated short text is resolved by same-role tail order, not attached to an earlier sibling turn
- [ ] Unrelated same-role text never receives the image

---

## Summary

| # | Scenario | Platforms | Formats | Priority |
|---|----------|-----------|---------|----------|
| 1 | Basic single-export smoke | All 5 | MD + PDF | P0 |
| 2 | Code block preservation | All 5 | MD + PDF | P0 |
| 3 | LaTeX equations | ChatGPT, Gemini, Claude | MD + PDF | P1 |
| 4 | Images & attachments | All 5 | MD + PDF | P1 |
| 5 | Claude artifacts | Claude | MD + PDF | P0 |
| 6 | Gemini research documents | Gemini | MD + PDF | P0 |
| 7 | Long conversation (50+ turns) | All 5 | MD + PDF | P0 |
| 8 | Unicode/CJK filenames | All 5 | MD | P1 |
| 9 | Filename template tokens | All 5 | MD | P1 |
| 10 | Download folder modes | All 5 | MD + PDF | P0 |
| 11 | Bulk export/history completeness | ChatGPT, Claude, DeepSeek, Grok | MD + PDF | P0 |
| 12 | Gemini bulk (batchexecute) | Gemini | MD + PDF | P0 |
| 13 | Provider detail authority/fallback | All 5 | MD + PDF | P0 |
| 14 | Empty/edge-case conversations | All 5 | MD + PDF | P1 |
| 15 | Special characters & XSS | All 5 | MD + PDF | P1 |
| 16 | Metadata toggle | All 5 | MD + PDF | P2 |
| 17 | Code block dedup | All 5 | MD | P2 |
| 18 | Platform label consistency | All 5 | MD + PDF | P2 |
| 19 | Scheduled export | All 5 | MD | P1 |
| 20 | Auth expiration & retry | ChatGPT, Gemini, Claude | — | P0 |
| 21 | Claude branch structural integrity | Claude | MD + PDF | P0 |
| 22 | Claude source verification contract | Claude | MD + PDF | P0 |
| 23 | Virtualized tail media alignment | Claude + API/DOM providers | MD + PDF | P1 |

**23 top-level dogfood scenarios. Provider-specific criteria take precedence over older generic fallback assumptions.**
