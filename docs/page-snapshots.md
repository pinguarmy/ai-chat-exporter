# Page snapshots and local recovery

Verification evidence and untested provider boundaries are recorded in [Verification](page-snapshot-verification.md).

## Manual Gemini capture

Open a Gemini conversation, then choose **Capture page snapshot** in the extension popup. This captures only conversation content already loaded and readable in the current page DOM. It is available even when provider verification has not completed, but **it does not verify the complete conversation**. Unloaded messages and external attachment contents may be absent. The generation status is recorded as generating, idle, or unknown; it does not prove completeness.

The captured record is fixed: closing or navigating the source tab does not change it. Copy Markdown, save Markdown, or open its preview and choose Download PDF. PDF does not start automatically. The page preview cache lasts at most one hour and holds at most 20 entries, 1 MiB each and 2 MiB overall. If output or privacy options change for an existing capture, recapture before opening another preview or PDF; the cache will not silently reuse different options. A missing or expired cache entry cannot reconstruct the original capture from the provider. Markdown and PDF snapshots do not include ZIP archives, raw provider payloads, or tool traces.

Safe-share uses heuristic credential redaction. It cannot guarantee removal of every secret; inspect the result before sharing. Images with external URLs may request their host when rendered, and offline image availability is not guaranteed.

## Optional recovery drafts

**Local recovery is off by default.** Enable it for a conversation in the snapshot panel. The extension saves an initial checkpoint, then captures observed changes after a 2.5-second debounce, with a 15-second maximum wait. These are page observations, **not** provider-verified history or an undo timeline. A failed save retains the previous successful checkpoint; it cannot roll back through unlimited revisions or restore a provider conversation.

Drafts stay in browser-managed local storage, not cloud sync: 1 MiB maximum per draft, 4 MiB in total, at most 20 drafts, retained for up to seven days. Cleanup may run later if the browser is closed or storage fails. The recovery page lists drafts and lets you open a fixed preview or delete them. **Stop protection** retains saved content. **Delete** or **Delete all drafts** removes the content and stops protection for affected drafts; stale writes must not recreate deleted drafts. After a browser restart, protection is paused and does not silently resume. Service-worker suspension and waking during the same browser session are different from a browser restart.

This opt-in does not disable older automatic DOM fallback caching used elsewhere in the extension. See [Privacy Policy](../PRIVACY.md) for all storage and credential behavior. If a checkpoint is too large or local storage fails, save Markdown directly when possible.
