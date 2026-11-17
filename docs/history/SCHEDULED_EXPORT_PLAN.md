# Scheduled Auto-Export Implementation Plan

> **Status (v1.2.5): implemented.** This document is retained as the original
> design record. For the current user-facing behavior and release constraints,
> see [`docs/design/SCHEDULED_EXPORT_FRONTEND_BRIEF.md`](../design/SCHEDULED_EXPORT_FRONTEND_BRIEF.md)
> and [`docs/MAINTENANCE.md`](../MAINTENANCE.md).

## Executive Summary

Add a scheduled auto-export feature to AI Chat Exporter that periodically fetches new conversations from configured platforms and exports them automatically — without requiring the user to manually open the popup.

---

## 1. Architecture Overview

### Current State

- **MV3 service worker** (`src/background.ts`) — owns scheduled checks, cleanup, and cancellation state
- **Content scripts** per platform — each has `FETCH_ALL_CONVERSATIONS` and `FETCH_CONVERSATION_DETAIL` message handlers
- **Manual export logic** lives in the popup; scheduled Markdown export runs in the service worker
- **`chrome.downloads.download()`** can be called from the service worker
- **Permissions** already include `storage`, `activeTab`, `downloads`, `alarms`
- **Permission boundary**: the manifest intentionally avoids the broad `tabs` permission

### How Scheduled Export Works

```
chrome.alarms fires
  → background.ts reads scheduledExport config
  → background.ts opens a tab to the platform (e.g., chatgpt.com)
  → waits for content script to be ready
  → sends FETCH_ALL_CONVERSATIONS → gets list of all conversations
  → filters out already-exported IDs (from chrome.storage.local)
  → sends FETCH_CONVERSATION_DETAIL for each new conversation
  → converts to markdown (reuses export-markdown.ts)
  → calls chrome.downloads.download()
  → marks conversation as exported
  → rate-limits between requests
  → closes the tab
  → repeats for next platform
```

---

## 2. Files to Modify

### 2.1 `src/lib/types.ts` — Add scheduled export types

Add new interfaces and extend `ExtensionSettings`:

```typescript
/** Supported platforms for scheduled export */
export type ExportablePlatform = 'chatgpt' | 'claude' | 'gemini' | 'deepseek' | 'grok'

/** Schedule frequency options */
export type ScheduleFrequency = 'hourly' | 'every6h' | 'daily' | 'weekly'

/** Scheduled export configuration for a single platform */
export interface PlatformScheduleConfig {
  /** Whether this platform's schedule is enabled */
  enabled: boolean
  /** How often to check for new conversations */
  frequency: ScheduleFrequency
  /** Max conversations to export per run (prevents runaway exports) */
  maxPerRun: number
  /** Export format override (falls back to defaultFormat) */
  format?: ExportFormat
}

/** Complete scheduled export settings */
export interface ScheduledExportSettings {
  /** Whether scheduled export is globally enabled */
  enabled: boolean
  /** Per-platform schedule configurations */
  platforms: Record<ExportablePlatform, PlatformScheduleConfig>
  /** Export format for scheduled exports (default: markdown) */
  defaultFormat: ExportFormat
  /** Whether to close the tab after export completes */
  closeTabAfterExport: boolean
  /** Delay in ms between conversation exports (rate limiting) */
  requestDelayMs: number
  /** Max total conversations across all platforms per run */
  maxTotalPerRun: number
}

/** Record of a single exported conversation (for dedup tracking) */
export interface ExportedConversationRecord {
  /** Conversation ID */
  id: string
  /** Platform it was exported from */
  platform: ExportablePlatform
  /** Title at time of export */
  title: string
  /** Unix timestamp of when it was exported */
  exportedAt: number
  /** Filename used for the export */
  filename: string
}

/** Status of the last scheduled export run */
export interface ScheduledExportStatus {
  /** When the last run started */
  lastRunAt?: number
  /** When the last run finished */
  lastRunFinishedAt?: number
  /** Total conversations exported in last run */
  lastRunExported: number
  /** Total conversations that failed in last run */
  lastRunFailed: number
  /** Any error message from the last run */
  lastRunError?: string
  /** Currently running? */
  isRunning: boolean
  /** Which platform is currently being processed */
  currentPlatform?: ExportablePlatform
}
```

Extend `ExtensionSettings`:

```typescript
export interface ExtensionSettings {
  // ... existing fields ...
  /** Scheduled export configuration */
  scheduledExport?: ScheduledExportSettings
}
```

Add new message types:

```typescript
export type MessageType =
  // ... existing types ...
  | 'SCHEDULED_EXPORT_RUN'
  | 'SCHEDULED_EXPORT_STATUS'
  | 'SCHEDULED_EXPORT_CONFIG'
  | 'SCHEDULED_EXPORT_CLEAR_HISTORY'
```

### 2.2 `src/lib/export-markdown.ts` — No changes needed

This file already exports pure functions `conversationToMarkdown()` and `generateMarkdownFilename()` that can be imported directly into the service worker. No modifications required.

### 2.3 `src/lib/export-pdf.ts` — Verify service worker compatibility

PDF export uses `html2canvas` + `jsdf` which require DOM. In the service worker, we cannot render HTML. **Decision**: Scheduled export only supports Markdown format. PDF export remains manual-only (requires popup). Document this limitation.

### 2.4 `src/lib/download-path.ts` — No changes needed

Already a pure utility function, importable from service worker.

### 2.5 `src/lib/filename.ts` — No changes needed

Already a pure utility function, importable from service worker.

### 2.6 `src/background.ts` — Major changes (core of the feature)

This is the primary file to modify. Add:

#### a) Scheduled Export Configuration Management

```typescript
/** Get scheduled export settings with defaults */
async function getScheduledExportSettings(): Promise<ScheduledExportSettings> {
  const result = await chrome.storage.local.get('settings')
  const settings = result.settings || DEFAULT_SETTINGS
  return settings.scheduledExport || getDefaultScheduledExportSettings()
}

function getDefaultScheduledExportSettings(): ScheduledExportSettings {
  return {
    enabled: false,
    platforms: {
      chatgpt:  { enabled: true, frequency: 'daily', maxPerRun: 20 },
      claude:   { enabled: false, frequency: 'daily', maxPerRun: 20 },
      gemini:   { enabled: false, frequency: 'daily', maxPerRun: 20 },
      deepseek: { enabled: false, frequency: 'daily', maxPerRun: 20 },
      grok:     { enabled: false, frequency: 'daily', maxPerRun: 20 },
    },
    defaultFormat: 'markdown',
    closeTabAfterExport: true,
    requestDelayMs: 3000,
    maxTotalPerRun: 50,
  }
}
```

#### b) Alarm Scheduling

Use `chrome.alarms` to check periodically. Since MV3 alarms have a minimum period of 1 minute, set a single alarm that checks all platforms:

```typescript
// Create the scheduled export checker alarm (every 15 minutes)
chrome.alarms.create('scheduled-export-check', { periodInMinutes: 15 })

// On install, set up the alarm
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS } })
    chrome.alarms.create('scheduled-export-check', { periodInMinutes: 15 })
  }
})
```

The alarm handler checks which platforms are due:

```typescript
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'scheduled-export-check') {
    await checkAndRunScheduledExports()
  }
  // ... existing cleanup-exports handler ...
})

async function checkAndRunScheduledExports() {
  const config = await getScheduledExportSettings()
  if (!config.enabled) return

  const now = Date.now()
  for (const [platform, platformConfig] of Object.entries(config.platforms)) {
    if (!platformConfig.enabled) continue

    const lastRunKey = `scheduledExport-lastRun-${platform}`
    const result = await chrome.storage.local.get(lastRunKey)
    const lastRun = result[lastRunKey] || 0

    if (isDueForRun(platformConfig.frequency, lastRun, now)) {
      await runScheduledExportForPlatform(platform as ExportablePlatform, config)
      await chrome.storage.local.set({ [lastRunKey]: now })
    }
  }
}

function isDueForRun(frequency: ScheduleFrequency, lastRun: number, now: number): boolean {
  const intervals: Record<ScheduleFrequency, number> = {
    hourly: 60 * 60 * 1000,
    every6h: 6 * 60 * 60 * 1000,
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000,
  }
  return (now - lastRun) >= intervals[frequency]
}
```

#### c) Tab Management

```typescript
/** Platform URL mappings for opening tabs */
const PLATFORM_URLS: Record<ExportablePlatform, string> = {
  chatgpt: 'https://chatgpt.com/',
  claude: 'https://claude.ai/',
  gemini: 'https://gemini.google.com/',
  deepseek: 'https://chat.deepseek.com/',
  grok: 'https://grok.com/',
}

async function runScheduledExportForPlatform(
  platform: ExportablePlatform,
  config: ScheduledExportSettings
): Promise<void> {
  // Update status
  const status: ScheduledExportStatus = {
    lastRunAt: Date.now(),
    isRunning: true,
    currentPlatform: platform,
    lastRunExported: 0,
    lastRunFailed: 0,
  }
  await chrome.storage.local.set({ scheduledExportStatus: status })

  let tab: chrome.tabs.Tab | null = null
  try {
    // 1. Open a tab to the platform
    tab = await chrome.tabs.create({
      url: PLATFORM_URLS[platform],
      active: false,  // background tab
    })

    // 2. Wait for the tab to finish loading
    await waitForTabComplete(tab.id!, 30000) // 30s timeout

    // 3. Wait for content script to be ready
    await waitForContentScript(tab.id!, platform, 10000)

    // 4. Fetch conversation list
    const listResponse = await chrome.tabs.sendMessage(tab.id!, {
      type: 'FETCH_ALL_CONVERSATIONS',
    })

    if (!listResponse?.data) {
      throw new Error(`Failed to fetch conversations from ${platform}`)
    }

    const allConversations: ConversationListItem[] = listResponse.data

    // 5. Filter out already-exported conversations
    const exportedIds = await getExportedIds(platform)
    const newConversations = allConversations.filter(c => !exportedIds.has(c.id))

    // 6. Limit to max per run
    const platformConfig = config.platforms[platform]
    const toExport = newConversations.slice(0, platformConfig.maxPerRun)

    // 7. Export each conversation
    let exported = 0
    let failed = 0

    for (const convItem of toExport) {
      try {
        // Check total limit
        if (exported + failed >= config.maxTotalPerRun) break

        // Fetch full conversation detail
        const detailResponse = await chrome.tabs.sendMessage(tab.id!, {
          type: 'FETCH_CONVERSATION_DETAIL',
          data: { id: convItem.id },
        })

        const conversation: Conversation | null = detailResponse?.data || null
        if (!conversation || conversation.messages.length === 0) {
          failed++
          continue
        }

        // Rate limiting delay between requests
        await delay(config.requestDelayMs)

        // Export as markdown
        const exportOptions: ExportOptions = {
          format: 'markdown',
          includeMetadata: true,
          includeCodeBlocks: true,
          includeImages: true,
        }

        const markdown = conversationToMarkdown(conversation, exportOptions)
        const baseFilename = generateFilename(
          '{date}-{platform}-{title}',
          conversation
        )
        const filename = buildDownloadFilename(
          baseFilename,
          platform,
          '.md',
          'by-platform',  // organized by platform folder
          ''
        )

        // Download
        const blob = new Blob([markdown], { type: 'text/markdown' })
        const url = URL.createObjectURL(blob)

        await chrome.downloads.download({ url, filename, saveAs: false })
        setTimeout(() => URL.revokeObjectURL(url), 5000)

        // Track exported conversation
        await markAsExported({
          id: convItem.id,
          platform,
          title: convItem.title,
          exportedAt: Date.now(),
          filename,
        })

        exported++
      } catch (err) {
        console.error(`[Scheduled Export] Failed to export ${convItem.id}:`, err)
        failed++
      }
    }

    // 8. Update status
    status.lastRunFinishedAt = Date.now()
    status.isRunning = false
    status.lastRunExported = exported
    status.lastRunFailed = failed
    await chrome.storage.local.set({ scheduledExportStatus: status })

  } catch (err) {
    console.error(`[Scheduled Export] Platform ${platform} failed:`, err)
    status.lastRunFinishedAt = Date.now()
    status.isRunning = false
    status.lastRunError = (err as Error).message
    await chrome.storage.local.set({ scheduledExportStatus: status })
  } finally {
    // 9. Close the tab
    if (tab?.id && config.closeTabAfterExport) {
      try {
        await chrome.tabs.remove(tab.id)
      } catch {}
    }
  }
}
```

#### d) Tab Readiness Helpers

```typescript
/** Wait for a tab to finish loading */
function waitForTabComplete(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      reject(new Error('Tab load timeout'))
    }, timeoutMs)

    function listener(updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer)
        chrome.tabs.onUpdated.removeListener(listener)
        // Extra delay for SPA hydration
        setTimeout(resolve, 3000)
      }
    }

    chrome.tabs.onUpdated.addListener(listener)

    // Check if already loaded
    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === 'complete') {
        clearTimeout(timer)
        chrome.tabs.onUpdated.removeListener(listener)
        setTimeout(resolve, 3000)
      }
    })
  })
}

/** Wait for content script to be injectable and responsive */
async function waitForContentScript(
  tabId: number,
  platform: ExportablePlatform,
  timeoutMs: number
): Promise<void> {
  const startTime = Date.now()
  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'DETECT_PLATFORM' })
      if (response?.data?.platform === platform) return
    } catch {}
    await delay(1000)
  }
  throw new Error(`Content script not ready on ${platform} after ${timeoutMs}ms`)
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
```

#### e) Exported Conversation Tracking

```typescript
/** Get set of already-exported conversation IDs for a platform */
async function getExportedIds(platform: ExportablePlatform): Promise<Set<string>> {
  const key = `exportedIds-${platform}`
  const result = await chrome.storage.local.get(key)
  const ids: string[] = result[key] || []
  return new Set(ids)
}

/** Mark a conversation as exported */
async function markAsExported(record: ExportedConversationRecord): Promise<void> {
  const key = `exportedIds-${record.platform}`
  const statusKey = `exportedRecord-${record.platform}-${record.id}`

  // Add ID to the exported IDs list
  const result = await chrome.storage.local.get(key)
  const ids: string[] = result[key] || []
  if (!ids.includes(record.id)) {
    ids.push(record.id)
    // Keep only last 500 IDs per platform to prevent unbounded growth
    if (ids.length > 500) ids.splice(0, ids.length - 500)
    await chrome.storage.local.set({ [key]: ids })
  }

  // Store the full record for status/history display
  await chrome.storage.local.set({ [statusKey]: record })
}

/** Clear all exported history for a platform */
async function clearExportedHistory(platform?: ExportablePlatform): Promise<void> {
  const platforms = platform ? [platform] : ['chatgpt', 'claude', 'gemini', 'deepseek', 'grok'] as ExportablePlatform[]
  for (const p of platforms) {
    await chrome.storage.local.remove(`exportedIds-${p}`)
  }
}
```

### 2.7 `src/options.tsx` — Add Scheduled Export Settings UI

Add a new "Scheduled Export" section to the options page with:

- **Global toggle** to enable/disable scheduled export
- **Per-platform cards** with:
  - Enable/disable toggle
  - Frequency dropdown (Hourly / Every 6 Hours / Daily / Weekly)
  - Max conversations per run (input, 1-100)
- **Global settings**:
  - Request delay slider (1-10 seconds)
  - Max total per run (input, 1-200)
  - Close tab after export toggle
- **Status display**:
  - Last run time and results
  - Currently running indicator
  - Button to trigger manual run
  - Button to clear export history

```tsx
// New component section in options.tsx:

const [scheduleStatus, setScheduleStatus] = useState<ScheduledExportStatus | null>(null)

// Load status on mount and periodically
useEffect(() => {
  const loadStatus = async () => {
    const result = await chrome.storage.local.get('scheduledExportStatus')
    setScheduleStatus(result.scheduledExportStatus || null)
  }
  loadStatus()
  const interval = setInterval(loadStatus, 5000) // poll every 5s when open
  return () => clearInterval(interval)
}, [])
```

### 2.8 `src/popup.tsx` — Add status indicator (optional)

Small badge/notification in the popup showing:
- When the last scheduled export ran
- How many conversations were exported
- If an export is currently running

---

## 3. New Files to Create

### 3.1 `src/lib/scheduled-export.ts` — Shared logic

Extract the scheduling logic into a separate module for testability:

```typescript
// Functions:
// - isDueForRun(frequency, lastRun, now): boolean
// - getDefaultScheduledExportSettings(): ScheduledExportSettings
// - frequencyToMs(freq): number
```

### 3.2 `tests/scheduled-export.test.ts` — Unit tests

Test:
- `isDueForRun()` with various frequencies and timestamps
- Default settings generation
- Frequency-to-millisecond conversion
- Exported ID tracking (get/set/clear)

---

## 4. How to Track Exported Conversation IDs

### Storage Schema

```
chrome.storage.local:
  exportedIds-chatgpt: ["id1", "id2", ...]     // Array of exported IDs
  exportedIds-claude: ["id3", ...]
  exportedIds-gemini: [...]
  exportedIds-deepseek: [...]
  exportedIds-grok: [...]
  
  exportedRecord-chatgpt-id1: {                  // Full export record
    id: "id1",
    platform: "chatgpt",
    title: "My Conversation",
    exportedAt: 1687500000000,
    filename: "2024-06-22-chatgpt-my-conversation.md"
  }
  
  scheduledExport-lastRun-chatgpt: 1687500000000 // Last run timestamp
  scheduledExportStatus: { ... }                  // Current status object
```

### Dedup Strategy

- **Pre-export check**: Before fetching detail for a conversation, check if its ID is in the `exportedIds-{platform}` array
- **Post-export recording**: After successful download, add the ID to the array
- **Bounded storage**: Cap at 500 IDs per platform. When exceeded, remove oldest entries (FIFO). This prevents unbounded growth while keeping enough history to avoid re-exporting recent conversations
- **Clear history**: User can manually clear all tracking via the options page

### Why Not chrome.storage.sync?

`chrome.storage.sync` has a strict quota (100KB total, 8KB per item). The exported IDs array + records would easily exceed this. Use `chrome.storage.local` (5MB quota) instead.

---

## 5. Tab Management Strategy

### Lifecycle

```
1. chrome.tabs.create({ url: platformUrl, active: false })
   → Opens a background (non-focused) tab
   → Content script auto-injects via manifest content_scripts match

2. waitForTabComplete(tabId, 30s timeout)
   → Listens to chrome.tabs.onUpdated for status === 'complete'
   → Adds 3s delay after load for SPA hydration

3. waitForContentScript(tabId, platform, 10s timeout)
   → Polls with chrome.tabs.sendMessage({ type: 'DETECT_PLATFORM' })
   → Confirms the correct platform's content script is active
   → Retries every 1s until success or timeout

4. Fetch conversations (list + details)
   → Multiple chrome.tabs.sendMessage() calls
   → Each call goes to the platform's content script

5. chrome.tabs.remove(tabId)
   → Closes the background tab
   → Only if closeTabAfterExport is true
```

### Edge Cases

| Scenario | Handling |
|----------|----------|
| Tab fails to load | `waitForTabComplete` times out → error recorded, tab closed |
| Content script not injected | `waitForContentScript` times out → error, tab closed |
| Platform shows Cloudflare challenge | Content script won't detect correctly → timeout → error |
| User closes the tab manually | `chrome.tabs.sendMessage` fails → caught, export aborted for this platform |
| Multiple scheduled runs overlap | Status flag `isRunning` prevents concurrent runs per platform |
| Browser is sleeping/idle | MV3 alarms are throttled when browser is idle; runs when browser wakes |

### Concurrent Run Prevention

```typescript
// Before starting a run for a platform, check if already running
const status = await chrome.storage.local.get('scheduledExportStatus')
if (status.scheduledExportStatus?.isRunning &&
    status.scheduledExportStatus?.currentPlatform === platform) {
  return // Skip, already running for this platform
}
```

---

## 6. Auth Expiry Handling

### Per-Platform Auth Strategies

Each platform has different auth mechanisms:

| Platform | Auth Method | Expiry Detection | Recovery |
|----------|------------|-----------------|----------|
| **ChatGPT** | Access token via `/api/auth/session` | HTTP 401 response | `resetAccessToken()` + retry once. If still 401 → skip platform, log error |
| **Claude** | Session cookies | HTTP 401/403 response | Cannot auto-refresh; log error, skip platform, notify user |
| **Gemini** | Auth token (`at`) from batchexecute | HTTP 401/403 response | Re-hook to capture new token; if fails → skip |
| **DeepSeek** | Session cookies | HTTP 401 response | Cannot auto-refresh; log error, skip |
| **Grok** | Session cookies | HTTP 401 response | Cannot auto-refresh; log error, skip |

### Implementation in Content Scripts

The existing content scripts already handle auth expiry:

- **ChatGPT** (`chatgpt-parser.ts` lines 158-167): On 401, calls `resetAccessToken()`, retries once
- **Claude**: Uses cookies, auth failures propagate as errors
- **Gemini**: Uses intercepted tokens, auth failures propagate

### Background Script Handling

```typescript
// In the export loop, catch auth-specific errors
try {
  const detailResponse = await chrome.tabs.sendMessage(tabId, {
    type: 'FETCH_CONVERSATION_DETAIL',
    data: { id: convItem.id },
  })
  
  if (!detailResponse?.data) {
    // Could be auth failure
    // Check if it's a repeated failure
    const authFailKey = `authFail-${platform}`
    const result = await chrome.storage.local.get(authFailKey)
    const consecutiveFails = (result[authFailKey] || 0) + 1
    
    if (consecutiveFails >= 3) {
      // Likely auth expired — stop processing this platform
      console.warn(`[Scheduled Export] Auth likely expired for ${platform}, skipping`)
      await chrome.storage.local.set({ [authFailKey]: 0 })
      break // Exit the loop for this platform
    }
    
    await chrome.storage.local.set({ [authFailKey]: consecutiveFails })
    failed++
    continue
  }
  
  // Reset consecutive fail counter on success
  await chrome.storage.local.set({ [`authFail-${platform}`]: 0 })
  
  // ... export logic ...
} catch (err) {
  // ... error handling ...
}
```

### User Notification

When auth expires and cannot be recovered:

```typescript
// Store a notification flag
await chrome.storage.local.set({
  scheduledExportNotification: {
    type: 'auth_expired',
    platform,
    timestamp: Date.now(),
    message: `Authentication for ${platform} has expired. Please open ${platform} in your browser and log in again, then scheduled export will resume.`
  }
})

// The options page or popup can display this notification
```

---

## 7. Rate Limiting Strategy

### Why Rate Limiting Matters

- **API rate limits**: ChatGPT, Claude, etc. may rate-limit or block rapid API calls
- **Resource usage**: Opening tabs and fetching data consumes memory and CPU
- **Being a good citizen**: Don't hammer third-party services

### Multi-Layer Rate Limiting

#### Layer 1: Inter-Request Delay (per conversation)

```typescript
// Between each FETCH_CONVERSATION_DETAIL call
await delay(config.requestDelayMs) // Default: 3000ms
```

**Default**: 3 seconds between requests  
**Range**: 1-10 seconds (configurable in settings)

#### Layer 2: Max Conversations Per Run (per platform)

```typescript
const toExport = newConversations.slice(0, platformConfig.maxPerRun)
```

**Default**: 20 conversations per platform per run  
**Range**: 1-100 (configurable)

#### Layer 3: Max Total Per Run (across all platforms)

```typescript
if (exported + failed >= config.maxTotalPerRun) break
```

**Default**: 50 total conversations per scheduled run  
**Range**: 1-200 (configurable)

#### Layer 4: Alarm Frequency (minimum time between runs)

```
hourly    → 60 minutes
every6h   → 360 minutes
daily     → 1440 minutes
weekly    → 10080 minutes
```

**Implementation**: Check `lastRun` timestamp before starting a new run.

#### Layer 5: Concurrent Run Prevention

Only one scheduled export run can execute at a time across all platforms. The `isRunning` flag prevents overlapping runs.

### Rate Limit Summary

| Setting | Default | Min | Max | Purpose |
|---------|---------|-----|-----|---------|
| `requestDelayMs` | 3000 | 1000 | 10000 | Delay between conversation detail fetches |
| `maxPerRun` | 20 | 1 | 100 | Max conversations per platform per run |
| `maxTotalPerRun` | 50 | 1 | 200 | Max total conversations across all platforms |
| `frequency` | daily | hourly | weekly | Minimum time between runs per platform |

---

## 8. Manifest Changes

### Required Permission Addition

```json
{
  "permissions": [
    "storage",
    "activeTab",
    "downloads",
    "alarms",
    "tabs"
  ]
}
```

The `tabs` permission is needed for:
- `chrome.tabs.create()` — open background tab
- `chrome.tabs.remove()` — close background tab
- `chrome.tabs.get()` — check tab status
- `chrome.tabs.onUpdated` — wait for tab to load

**Note**: `host_permissions` already covers all platforms, so no changes needed there.

---

## 9. Implementation Order

### Phase 1: Core Infrastructure
1. Add types to `src/lib/types.ts`
2. Create `src/lib/scheduled-export.ts` with pure utility functions
3. Write `tests/scheduled-export.test.ts`

### Phase 2: Background Worker
4. Add exported ID tracking functions to `src/background.ts`
5. Add tab management functions to `src/background.ts`
6. Add the scheduled export runner to `src/background.ts`
7. Wire up the alarm handler
8. Add new message handlers for status queries

### Phase 3: Settings UI
9. Add scheduled export settings section to `src/options.tsx`
10. Add status display and manual trigger button
11. Add notification display for auth expiry

### Phase 4: Polish
12. Add status indicator to `src/popup.tsx` (optional)
13. Add error recovery and retry logic
14. Test with all 5 platforms
15. Handle edge cases (Cloudflare, network errors, browser sleep)

---

## 10. Known Limitations & Considerations

1. **MV3 Service Worker Lifecycle**: Service workers can be terminated after 30 seconds of inactivity. The `chrome.alarms` API keeps the worker alive briefly when an alarm fires, but long-running export loops may be interrupted.
   - **Mitigation**: Process conversations in small batches. If terminated mid-run, the next alarm trigger will resume (already-exported IDs are tracked, so no duplicates).

2. **PDF Export Not Supported**: PDF export requires DOM rendering (`html2canvas`), which is not available in the service worker. Scheduled export only supports Markdown format.

3. **Background Tab Visibility**: Some platforms may detect and restrict background tab API calls (e.g., reduced rate limits for non-visible tabs).
   - **Mitigation**: The tab is created with `active: false` but is a real tab. Some users may need to allow the extension to run in inactive tabs.

4. **Platform API Changes**: Platforms may change their API endpoints or authentication mechanisms, breaking the content scripts.
   - **Mitigation**: Graceful error handling per platform. Other platforms continue working.

5. **Storage Quota**: Each platform stores up to 500 exported IDs + records. With 5 platforms, that's ~2500 entries. Well within the 5MB `chrome.storage.local` quota.

6. **First Run**: On the very first scheduled run, all existing conversations will be "new" and exported. The `maxPerRun` limit prevents this from being overwhelming. Users should set it low initially.
