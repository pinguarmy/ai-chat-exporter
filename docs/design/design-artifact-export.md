# Design: Artifact Export Options for AI Chat Exporter

**Date:** 2026-07-08  
**Status:** Round 1 proposal — embed subset implemented; separate-file modes remain future work
**Scope:** How generated artifacts (code, HTML, documents) extracted from conversations are exported alongside the main conversation file.

---

## 1. Current State

### What exists
| Component | Status |
|---|---|
| `ConversationArtifact` type (`code`, `document`, `image`, `html`) | ✅ Defined in `types.ts:50-61` |
| `Conversation.artifacts?: ConversationArtifact[]` | ✅ Field exists |
| `ExtensionSettings.exportArtifacts: boolean` (default `true`) | ✅ Persisted setting |
| Options page toggle "Export Artifacts" | ✅ Controls embedded Artifact output |
| Claude parser extracts artifacts from `tool_use` blocks | ✅ Working |
| Other parsers (ChatGPT, Gemini, DeepSeek, Grok) | ⚠️ Do not extract artifacts yet |
| `conversationToMarkdown()` | ✅ Embeds Artifact metadata/content when enabled |
| `conversationToHtml()` | ✅ Embeds escaped Artifact metadata/content when enabled |
| Preview rendered/Markdown modes | ✅ Show embedded Artifact output when enabled |
| Separate Artifact files in popup/scheduled/bulk export | ⏳ Not implemented |

### Remaining gap
The current boolean setting implements the safe single-file/embed behavior. The
proposed `embed`/`separate`/`both`/`skip` mode migration and individual Artifact
downloads remain future work. Until then, the setting must not be described as
downloading separate files.

---

## 2. Proposed UX

### 2.1 Setting: Replace boolean with a 4-way choice

Replace `ExtensionSettings.exportArtifacts: boolean` with:

```typescript
type ArtifactExportMode = 'embed' | 'separate' | 'both' | 'skip'
```

| Mode | Behavior |
|---|---|
| `embed` | Artifacts are inlined into the main MD/PDF export as fenced sections |
| `separate` | Artifacts are downloaded as individual files alongside (or in subfolder of) the main file |
| `both` | Artifacts are embedded in the main file AND downloaded separately |
| `skip` | Artifacts are ignored (equivalent to old `exportArtifacts: false`) |

**Default:** `'embed'` — most useful for single-file archival; no file clutter.

### 2.2 Settings page change

Current:
```
Export Artifacts  [toggle]
Save code artifacts and documents as separate files
```

Proposed:
```
Artifacts         [dropdown: Embed in export / Separate files / Both / Skip]
Include generated artifacts from Claude in your exports
```

The `exportArtifacts` boolean is **replaced** by `artifactExportMode`. For backward compatibility with stored settings, the migration logic should be:

```
if settings.exportArtifacts === false  →  artifactExportMode = 'skip'
if settings.exportArtifacts === true   →  artifactExportMode = 'embed'
```

### 2.3 Popup: No per-export override needed (Round 1)

The setting is global. The popup does NOT need a per-export artifact toggle in Round 1 to keep the popup simple. Users who want different behavior per export can change the setting before exporting.

**Future consideration (Round 2):** A small "📎 2 artifacts" badge in the popup when artifacts are detected, with a dropdown to override per export.

---

## 3. Filename Conventions

### 3.1 Embed mode — no extra files

The main MD file includes an `## Artifacts` section (see §4.1). No additional files are created.

### 3.2 Separate/Both mode — artifact file naming

Each artifact gets its own file. Filename pattern:

```
{baseFilename}_artifact-{index}.{ext}
```

Where:
- `{baseFilename}` = the main export filename (without extension)
- `{index}` = zero-padded 1-indexed position within the conversation's artifacts array
- `{ext}` = derived from artifact type and language

| `artifact.type` | `artifact.language` | Extension |
|---|---|---|
| `code` | `python` | `.py` |
| `code` | `javascript` | `.js` |
| `code` | `typescript` | `.ts` |
| `code` | `html` | `.html` |
| `code` | (any known) | `.{language}` |
| `code` | (unknown/empty) | `.txt` |
| `html` | — | `.html` |
| `document` | — | derived from `artifact.mimeType` or `.md` |
| `image` | — | skip (not a file artifact in this context) |

**Example:** For a conversation titled `my-chat` with 3 artifacts (Python, JS, HTML):

```
my-chat.md                           (main conversation)
my-chat_artifact-01.py
my-chat_artifact-02.js
my-chat_artifact-03.html
```

### 3.3 Subfolder placement

When `downloadFolder` is `by-platform`:
```
Claude/my-chat.md
Claude/my-chat_artifact-01.py
Claude/my-chat_artifact-02.js
```

When `downloadFolder` is `custom`:
```
AI Chat Exports/my-chat.md
AI Chat Exports/my-chat_artifact-01.py
```

Artifacts always live alongside the main file — never in a separate subfolder — to keep the relationship obvious.

---

## 4. Markdown Embedding Format (embed / both)

When artifacts are embedded in the main MD export, they appear at the **end of the file**, after the footer, in a clearly delimited section:

```markdown
---

*Exported from Claude on 2026-07-08*

---

## Artifacts

### Artifact 1: Health Report (html)

```html
<html><body><h1>Report</h1></body></html>
```

### Artifact 2: Data Processing (code, python)

```python
import pandas as pd
df = pd.read_csv("data.csv")
print(df.head())
```
```

**Rules:**
1. Section header: `## Artifacts`
2. Each artifact: `### Artifact {N}: {title} ({type}[, {language}])`
3. Content wrapped in appropriate fenced code block
4. For `document` type with text content: use fenced block with no language tag
5. For `image` type: skip embedding (binary content can't go in MD) — log a note instead
6. Empty artifacts (no content): skip silently

---

## 5. Implementation Changes (read-only spec)

### 5.1 `src/lib/types.ts`

```typescript
// REPLACE:
//   exportArtifacts: boolean
// WITH:
  /** How to handle artifacts in exports */
  artifactExportMode: ArtifactExportMode

// ADD new type:
export type ArtifactExportMode = 'embed' | 'separate' | 'both' | 'skip'

// UPDATE DEFAULT_SETTINGS:
  artifactExportMode: 'embed',   // was: exportArtifacts: true
```

**Migration note:** Remove `exportArtifacts` from `ExtensionSettings`. On load, if `artifactExportMode` is missing and `exportArtifacts` is present, migrate transparently (see §2.2).

### 5.2 `src/lib/export-markdown.ts`

Add a new function `formatArtifactsAsMarkdown(artifacts: ConversationArtifact[]): string[]` and call it at the end of `conversationToMarkdown()` when mode is `embed` or `both`.

```typescript
// In conversationToMarkdown(), after the footer:
if (options.artifactExportMode === 'embed' || options.artifactExportMode === 'both') {
  if (conversation.artifacts?.length) {
    lines.push(...formatArtifactsAsMarkdown(conversation.artifacts))
  }
}
```

### 5.3 `src/lib/export-pdf.ts`

Same approach: append artifact section to HTML output. For `code`/`html`/`document` types, render in `<pre>` blocks. Skip `image` type artifacts.

### 5.4 `src/lib/filename.ts`

Add a helper:
```typescript
export function getArtifactExtension(artifact: ConversationArtifact): string
```

### 5.5 `src/popup.tsx` — `handleExport()`

After the main file download, check `settings.artifactExportMode`:

```typescript
const mode = settings?.artifactExportMode ?? 'embed'
if (mode === 'separate' || mode === 'both') {
  if (conversation.artifacts?.length) {
    for (let i = 0; i < conversation.artifacts.length; i++) {
      const artifact = conversation.artifacts[i]
      if (artifact.type === 'image') continue  // skip binary
      const ext = getArtifactExtension(artifact)
      const artFilename = buildDownloadFilename(
        `${baseFilename}_artifact-${String(i + 1).padStart(2, '0')}`,
        conversation.platform,
        ext,
        downloadFolder,
        customFolderName
      )
      const blob = new Blob([artifact.content], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      await chrome.downloads.download({ url, filename: artFilename, saveAs: false })
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }
}
```

### 5.6 `src/background.ts` — scheduled/bulk export

Same logic as §5.5, applied in `runScheduledExportForPlatform()` after each conversation's MD download and in `handleBulkExport()` after each conversation's export.

### 5.7 `src/tabs/preview.tsx`

Show artifact count in the preview header when artifacts exist:
```
"3 artifacts" badge — clicking it scrolls to the Artifacts section
```

---

## 6. Edge Cases

| Case | Handling |
|---|---|
| **No artifacts** (`artifacts` is undefined or empty array) | Skip artifact section entirely. No extra files. No mention in UI. |
| **Artifacts with empty content** | Skip that artifact. Don't create empty files. Don't add empty sections. |
| **Duplicate artifact titles** | Suffix with index: `Artifact 1: Report`, `Artifact 2: Report (2)`. Filenames already have `_artifact-NN` suffix so no collision. |
| **Very large artifacts** (>100KB) | No special handling in Round 1. Chrome downloads handle large blobs fine. Future: warn user or offer to skip. |
| **HTML artifacts in MD embed** | Wrap in ` ```html ``` ` fenced block. Renders as code, not as HTML. User can extract and open in browser. |
| **Document artifacts with binary content** | If `mimeType` is a binary type (e.g., `application/pdf`), skip embedding and skip separate file — log warning in console. Only text-based documents are exported. |
| **Filename length limits** | `baseFilename` is already truncated to 200 chars. Artifact suffix `_artifact-01` adds 13 chars. Max total: 213 chars — well within filesystem limits. |
| **Special characters in artifact titles** | `getArtifactExtension()` doesn't use the title for filenames. Titles only appear in MD embed headers, where special chars are fine. |
| **Export format is PDF** | Artifacts are embedded as `<pre>` blocks in the PDF HTML. Separate files are still `.md`/`.py`/etc. regardless of main format. |
| **Bulk export with 50 conversations × 3 artifacts each** | 150 artifact downloads. Chrome can handle this but may show download bar clutter. Future: option to zip. Round 1: proceed as-is. |
| **Artifact type is `image`** | Skip in both embed and separate modes. Binary image content can't be meaningfully embedded as text. The conversation text likely already references it via attachments. |

---

## 7. Settings Persistence & Migration

```typescript
// In background.ts or popup loadSettings:
function migrateSettings(raw: Record<string, unknown>): ExtensionSettings {
  const settings = { ...DEFAULT_SETTINGS, ...raw } as ExtensionSettings
  
  // Migrate old boolean to new enum
  if (settings.artifactExportMode === undefined && 'exportArtifacts' in raw) {
    settings.artifactExportMode = raw.exportArtifacts ? 'embed' : 'skip'
    delete (settings as any).exportArtifacts
    // Persist the migrated settings
    chrome.storage.local.set({ settings })
  }
  
  return settings
}
```

---

## 8. Summary of Files to Modify (implementation)

| File | Change |
|---|---|
| `src/lib/types.ts` | Add `ArtifactExportMode` type; replace `exportArtifacts` with `artifactExportMode` in interface + defaults |
| `src/lib/export-markdown.ts` | Add `formatArtifactsAsMarkdown()`; call in `conversationToMarkdown()` |
| `src/lib/export-pdf.ts` | Add artifact section to HTML generation |
| `src/lib/filename.ts` | Add `getArtifactExtension()` helper |
| `src/popup.tsx` | Add artifact file download loop after main export in `handleExport` and `handleBulkExport` |
| `src/background.ts` | Add artifact download in scheduled export; add settings migration |
| `src/options.tsx` | Replace toggle with dropdown; add migration on load |
| `src/tabs/preview.tsx` | Show artifact count badge; link to artifacts section |
| `tests/export-markdown.test.ts` | Add tests for artifact embedding |
| `tests/edge-cases-cycle3.test.ts` | Update existing artifact tests for new behavior |

---

## 9. Open Questions for Round 2

1. **Per-export override in popup:** Should the popup show a "📎 N artifacts" indicator with a dropdown to change mode for this specific export?
2. **Zip for bulk exports:** When exporting 50+ conversations with artifacts, should we offer a single ZIP download?
3. **Image artifact handling:** Should we download image artifacts as PNG/JPG files instead of skipping?
4. **Cross-reference in embed mode:** Should the embed section include a relative link to the separate file (when in `both` mode)?
5. **ChatGPT/Gemini/Grok artifact extraction:** These parsers don't extract artifacts yet. Should we add artifact detection for these platforms?
