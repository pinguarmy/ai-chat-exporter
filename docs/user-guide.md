# AI Chat Exporter user guide

The detailed, task-by-task manual. For a quick overview and install links, see the [README](../README.md) ([简体中文](../README.zh-CN.md)). For how the exporter proves a transcript is complete, see the [architecture guide](../GUIDE.md). To report a problem, see [Support](../README.md#support).

Contents: [Export the current conversation](#export-the-current-conversation) · [Export selected messages](#export-selected-messages) · [Capture the visible page](#capture-the-visible-page) · [Bulk export](#bulk-export) · [Export workflow](#export-workflow) · [Custom filenames](#custom-filenames) · [Download folders](#download-folders) · [Scheduled auto-export](#scheduled-auto-export)

## Export the current conversation

1. Open any conversation on **ChatGPT**, **Gemini**, **Claude**, **DeepSeek**, or **Grok**
2. Click the **AI Chat Exporter** icon in your toolbar
3. Choose **Editable Markdown**, **Reading PDF**, or **Archive ZIP**
4. Check the filename, destination and output-coverage summary, then click **Export**. A completed filename appears after the browser finishes the download.

On another website, **Quick start** links to supported providers and explains how to return and save your first file. Reopen it from the popup whenever needed. It does not require an exporter account, launch a welcome tab or change your preferences.

## Export selected messages

Open **Preview & select messages**, then choose **All messages**, **Select messages**, or **Last answer**. **Copy Markdown** always copies text; the download button names Markdown or ZIP explicitly. Preview downloads show the browser-confirmed filename and can be cancelled while running. Copy, Markdown and PDF use the same source order and selection. Partial files carry an unavoidable scope notice and never enter the complete-archive history. Conversation-wide artifacts, tool records and raw provider data are excluded. A partial ZIP is not offered.

## Capture the visible page

If full provider verification is unavailable on a supported conversation, open the extension popup and choose **Capture page snapshot**. This manual capture records only conversation content already loaded and readable in the page DOM; it does **not** verify the complete history. The fixed capture can be copied, saved as Markdown, or opened in preview for PDF export. Change output/privacy options? Recapture before opening another preview or PDF for the same capture. External images may load over the network; offline rendering is not guaranteed.

**Local recovery** is optional and off by default. Enable it for one conversation to save local checkpoints, then use **Open recovery page** to view, export, or delete them. Stopping protection keeps saved drafts; deleting a draft stops its protection. Protection pauses after a browser restart and does not resume automatically. See [Page snapshots and local recovery](design/page-snapshots.md) for limits and privacy details.

## Bulk export

You can load account history from a signed-in provider homepage; opening a
specific conversation is only necessary for Current Chat export. Current-chat
read errors do not block the bulk list. History reads wait up to 30 seconds,
then try the visible sidebar with a 5-second timeout. Sidebar results are
marked incomplete and must not be treated as the full account archive. Reload
the provider page and refresh the list if neither read succeeds. Provider
errors follow the selected extension language (English, Simplified/Traditional
Chinese, German, Japanese, or Korean).

1. Navigate to ChatGPT, Gemini, Claude, DeepSeek, or Grok
2. Click the extension icon → **Bulk** tab
3. Wait for conversations to load (uses the provider API where available, with a DOM fallback)
4. Search titles and select conversations with checkboxes, or expand **Quick selection** to apply date and quantity rules. The collapsed summary retains the current rules. Manual selections can exceed the quick-selection limit.
5. Choose a format. **Advanced Export Options** includes message timestamps for both Markdown and PDF.
6. Click **Export Selected**. When skipping archived conversations is enabled, previously archived items are excluded from the run.

## Export workflow

The popup keeps date and quantity rules in **Quick selection**. The summary shows
selected, eligible, and skipped counts. Advanced changes apply to the current
session until **Save as defaults** is clicked; **Reset to defaults** restores saved
preferences. Preview inherits the current session's choices.

Markdown bulk exports run in the background when Save As is disabled. Closing the
popup does not cancel them. Reopen the popup to stop the run or resume remaining
items after interruption. A browser/worker restart reconciles recorded downloads
and marks the queue interrupted; resuming is explicit. The most recent queue
replaces the previous queue. PDF and Save As exports require their page to remain
open; use **Open full export workspace** for long runs.

For Markdown, **Archive bundle** optionally downloads a ZIP containing
`conversation.md`, `references.json`, `trace.json`, `manifest.json`, and inline
artifact files. The manifest hashes each payload and reports source diagnostics.
External attachments are not downloaded, and the manifest explicitly records that
limitation. Enable **Include tool trace** separately to include provider-exposed
ChatGPT tool arguments/results. Other providers report unavailable trace coverage;
this is not a full internal execution history.

**Create share copy** redacts common credential patterns and marks the archive with
its redaction count. It cannot identify every secret or private fact; inspect the
copy before sharing. Rendered preview, copy, standalone Markdown and PDF also apply the heuristic credential redaction when this setting is active; attachment/reference targets are omitted. This is not anonymization of names or private prose. Raw provider payloads are excluded from share copies; a private archive can include them only when explicitly enabled and available.

Export metadata uses explicit ISO timestamps, separates provider creation from
first/last visible messages and export time, and lists observed model names.
ChatGPT references are normalized before marker cleanup, including nested web
sources and entity labels. Unresolved references remain visible diagnostics rather
than invented citations. Structural verification does not prove authenticity.

## Custom filenames

Configure filename patterns in Settings:

| Token | Output | Example |
|-------|--------|---------|
| `{date}` | Conversation start date (falls back to export date) | `2026-06-08` |
| `{datetime}` | Conversation start date and time (falls back to export time) | `2026-06-08T093000` |
| `{conv_date}` | Conversation start date | `2026-06-08` |
| `{conv_datetime}` | Conversation start date & time | `2026-06-08T093000` |
| `{end_date}` | Export date (alias) | `2026-06-11` |
| `{last_message_date}` | Latest known exported-message date (device-local; `unknown` if missing) | `2026-06-11` |
| `{last_message_datetime}` | Latest known exported-message time (device-local, with offset; `unknown` if missing) | `2026-06-11T093000+0900` |
| `{id}` | First eight sanitized conversation ID characters | `a1b2c3d4` |
| `{full_id}` | Full sanitized conversation ID | `a1b2c3d4-1234-4567-89ab-123456789abc` |
| `{title}` | Session title | `how-to-learn-python` |
| `{platform}` | Platform name | `chatgpt` |
| `{index}` | Number (bulk) | `001` |
| `{msgcount}` | Message count | `24` |

Default pattern: `{date}-{title}` → `2026-06-08-how-to-learn-python.pdf`

To recognize recent replies without confusing them with a re-download, use
`{last_message_datetime}-{title}-{id}`. These tokens use **device-local time**,
with an explicit offset on the datetime (for example, `+0900` for JST or `-0700` for Pacific
daylight time), so no manual conversion is needed. They use the maximum valid
timestamp among the messages actually exported, never the download time, conversation creation
time, or a provider's generic activity timestamp. A re-export alone does not
change them while the device timezone is unchanged. They do **not** guarantee
the last edit time of older messages, and missing timestamps or an incomplete transcript can hide more recent work.
`unknown` means unavailable, not inactive.

With **Include Metadata** enabled, Markdown and PDF/preview show the same
`last_visible_message_at` as an ISO UTC timestamp (or `unknown`), its source,
and `message_timestamp_coverage` as known/total transcript messages (before any
optional progress-draft merging). ZIP manifests
include these fields as well. Existing `{date}`, `{datetime}` and `{end_date}`
keep their original meanings. This feature does not filter chats by age.

## Languages and scripts

Conversations in any language export without changing a character. This is
verified on a synthetic multilingual corpus (`tests/fixtures/multilingual`):
Simplified/Traditional Chinese, Japanese, Korean, Arabic, Hebrew (with mixed
right-to-left and left-to-right text), Persian, Hindi, Bengali, Tamil, Thai,
Russian, Greek, Vietnamese, accented Latin, emoji (ZWJ families, flags, skin
tones), decomposed (NFD) text, zero-width joiners, full-width punctuation, math
and non-ASCII code. No provider was involved; real provider rendering is not
covered by it.

- **Markdown and ZIP** are UTF-8 without a byte-order mark and reproduce the
  text exactly, including its Unicode normalization form. ZIP entry names carry
  the UTF-8 flag and a Unix host byte, so `unzip`, Windows Explorer, macOS and
  Python's `zipfile` all show names such as `assets/1-日本語.txt` correctly.
- **Filenames** keep the title's own script. Only characters the file system
  rejects, bidi override and zero-width spoofing characters, and unpaired
  surrogates are removed; the zero-width joiners that spell Persian, Indic and
  emoji sequences are kept. Names are shortened to 200 UTF-8 bytes on a
  character boundary (never through an emoji, flag, accent or Thai/Indic
  cluster), and a long title shrinks so `{date}` and `{id}` survive.
- **PDF visuals.** Text that Helvetica can encode (English and accented Latin
  such as `é`, `ö`, `ñ`) is drawn as sharp vector text, fitted to the width the
  browser laid it out in so a label cannot run into its value. Every other
  script, Chinese included (Simplified, Traditional, full-width punctuation and
  Chinese identifiers inside code blocks), plus Japanese kana, Korean, Arabic,
  Hebrew, Hindi, Thai, Cyrillic, Greek, Vietnamese and emoji, is drawn by the
  browser itself and stored as a high-resolution picture, so shaping, combining
  marks, colour emoji and fonts are exactly what the browser shows, in every PDF
  viewer. Chinese is therefore not vector text: it stays readable when zoomed
  in, but its edges soften at very high zoom, and a Chinese conversation
  produces a larger file (about 350 KB per page, against about 70 KB with the
  earlier vector drawing, which depended on the viewer supplying a CJK font:
  Poppler without `poppler-data` drew blanks, and the substitute font's widths
  made bold labels overlap their values). A document with any such character is
  drawn as a picture throughout, Latin included. Right-to-left blocks are
  right-aligned. Turn off **Searchable Text** if you need the page to depend
  only on the browser-drawn image.
- **PDF search and copy** (Searchable Text on) were verified for every script
  above, Chinese included, with PDFium (Chrome and Edge), `pypdf`, `pdf.js`,
  `pdfminer` and Poppler's `pdftotext`, which all read the hidden text through
  the PDF's `ToUnicode` map; no CJK font or `poppler-data` is needed. Limits:
  right-to-left text is stored in visual order like Chrome's own PDFs, so a
  reader's re-ordering can move punctuation or numbers next to Arabic/Hebrew and
  scramble phrases in mixed-direction lines (single words remain searchable);
  Arabic/Hebrew vowel marks may be reordered; a ZWNJ inside a right-to-left word
  can split it for some readers; Poppler's `pdftotext` may add spaces inside
  Thai and Devanagari words, and its default reading order can place a
  full-width run after the lines below it (`pdftotext -raw` keeps the order).
  Bullets of right-to-left lists are drawn on the left (the page renderer draws
  markers itself). Equations are
  typeset from LaTeX as MathML and rasterized by `html2canvas`, which paints the
  glyphs but not fraction bars or radical signs (`\\frac{\\sqrt{\\pi}}{2}` looks
  like a bare "π over 2"); inline `$...$` formulas are drawn as their own
  centred line. The LaTeX source stays in the PDF's hidden text and in
  Markdown, so nothing is lost from the archive; check formulas in the
  Markdown/ZIP export.

## Download folders

Choose where files are saved in Settings:

- **Default** → `Downloads/` root
- **By Platform** → `Downloads/ChatGPT/`, `Downloads/Gemini/`, `Downloads/Claude/`, `Downloads/DeepSeek/`, or `Downloads/Grok/`
- **Custom** → Any folder name you choose (Unicode supported)

## Scheduled auto-export

Scheduled export is an optional setting in the Options page. Enable the
feature, choose one or more providers, and set a rolling interval or local
time. It exports Markdown only, respects the same filename and folder rules as
manual Markdown export, and keeps provider-level status and retry information
in local extension storage. Chrome and the extension must remain alive for
alarms to run; a scheduled run may start at or shortly after its due time.

**Skip Already Archived** is on by default for each provider. Turn it off to
re-export up to **Per-platform max** conversations on every run, without
clearing export history. For a complete provider API list with activity times
for every chat, the most recently active chats go first. Otherwise, the
extension keeps the provider's list order. This uses the provider's list
metadata and does not detect message edits. The global run limit still applies.
Repeat mode waits for the next configured interval after an attempted batch,
including failed or partial batches; errors remain visible.

**Overwrite same-name scheduled files** is a separate, per-provider opt-in;
it is off by default. When enabled, scheduled downloads request replacement
only at the same full download path rather than numbered duplicates. Manual
exports are unchanged. A replacement is recorded as successful only after the
browser reports the download complete.

For one latest file per chat, turn **Skip Already Archived** off, turn this
overwrite option on for the desired provider, and use the stable filename
pattern **`{platform}-{full_id}`**. The platform and full ID avoid relying on
titles or truncated IDs. Do not include mutable titles, message times, or
export dates in that pattern if you want replacements across those changes.
Same-name files are replaced regardless of their contents: choose a dedicated
download subfolder, since unrelated files with that exact path are also
replaced. Old files under different names are not deleted, and no content
comparison or cleanup is performed. To judge recency while keeping stable
names, keep **Include Metadata** on and inspect `last_visible_message_at`.
