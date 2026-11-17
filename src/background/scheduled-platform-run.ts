/**
 * Runs the scheduled export for a single provider: opens an inactive tab,
 * lists conversations, resolves details, and downloads Markdown files.
 */
import type {
  Conversation,
  ConversationListItem,
  ExportablePlatform,
  ScheduledExportFailureReason,
  ScheduledExportSettings,
} from '../lib/types'
import { conversationToMarkdown } from '../lib/export-markdown'
import { generateFilename } from '../lib/filename'
import { buildDownloadFilename } from '../lib/download-path'
import { textToDataUrl } from '../lib/download-url'
import { downloadAndWait } from '../lib/download-completion'
import { getExportedIds } from '../lib/export-history'
import { retainPendingDownload, completePendingDownload } from '../lib/pending-downloads'
import {
  PLATFORM_URLS,
  ScheduledConcurrencyGate,
  ScheduledRequestPacer,
  ScheduledRunBudget,
  isAuthenticationRequiredError,
  isExportCancelledError,
  isLikelyProviderLoginUrl,
  isScheduledConversationListComplete,
  runWithConcurrency,
  shouldAdvanceScheduledLastRun,
  throwIfExportCancelled,
} from '../lib/scheduled-export'
import { isProviderRateLimitError } from '../lib/provider-rate-limit'
import { registerScheduledRunDownload, registerScheduledRunTab, releaseScheduledRunResource } from '../lib/scheduled-run-resources'
import { handleFetchConversationDetailInBackgroundTab, waitForContentScript, waitForTabComplete } from './background-fetch'
import {
  buildScheduledExportOptions,
  classifyScheduledDownloadFailure,
  fetchScheduledConversationList,
  recordScheduledFailure,
  recordScheduledRateLimit,
  resolveScheduledConversation,
  type ScheduledConversationFetchResult,
} from './scheduled-policy'
import { getResolvedExtensionSettings } from './scheduled-settings'
import type { ScheduledStatusReporter } from './scheduled-status'

/**
 * Run scheduled export for a single platform
 */
export interface ScheduledExportRunResult {
  attempted: number
  processed: number
  succeeded: boolean
  cancelled?: boolean
  /** A provider told us to slow down; queued items remain eligible for retry. */
  rateLimited?: boolean
}

export async function runScheduledExportForPlatform(
  platform: ExportablePlatform,
  config: ScheduledExportSettings,
  budget: ScheduledRunBudget,
  reporter: ScheduledStatusReporter,
  signal?: AbortSignal,
  runId?: string
): Promise<ScheduledExportRunResult> {
  let tabId: number | null = null
  let exported = 0
  let failed = 0
  let attempted = 0
  const status = reporter.status
  let authenticationFailureRecorded = false
  const outputTasks: Promise<void>[] = []

  const recordFailure = (reason: ScheduledExportFailureReason) => {
    failed += 1
    status.lastRunFailed += 1
    recordScheduledFailure(status, reason)
    void reporter.persist()
  }

  try {
    throwIfExportCancelled(signal)
    // Keep scheduled output subject to the user's global export preferences.
    // If storage is unavailable, this resolves to the documented defaults.
    const settings = await getResolvedExtensionSettings()

    // 1. Open a tab to the platform
    const tab = await chrome.tabs.create({
      url: PLATFORM_URLS[platform],
      active: false, // background tab
    })
    tabId = tab.id ?? null

    if (!tabId) throw new Error('Failed to create tab')
    await registerScheduledRunTab(runId, tabId)
    throwIfExportCancelled(signal)

    // 2. Wait for the tab to finish loading
    await waitForTabComplete(tabId, 30000, signal) // 30s timeout

    // 3. Wait for content script to be ready
    await waitForContentScript(tabId, platform, 10000, signal)

    // A provider may redirect an inactive tab to its sign-in page while the
    // extension is waiting for the content script. Record that state without
    // retaining the URL or any page text.
    const loadedTab = await chrome.tabs.get(tabId).catch(() => undefined)
    if (isLikelyProviderLoginUrl(platform, loadedTab?.url)) {
      reporter.markPlatformStatus(platform, 'auth_required')
      recordFailure('authentication_required')
      authenticationFailureRecorded = true
      return { attempted, processed: 1, succeeded: false }
    }

    // 4. Fetch conversation list
    throwIfExportCancelled(signal)
    const listResponse = await fetchScheduledConversationList(tabId, signal)
    throwIfExportCancelled(signal)

    if (isProviderRateLimitError(listResponse?.error)) {
      reporter.markPlatformStatus(platform, 'rate_limited')
      recordScheduledRateLimit(status, platform)
      recordFailure('rate_limited')
      return { attempted, processed: 1, succeeded: false, rateLimited: true }
    }

    if (listResponse?.meta?.authRequired || isAuthenticationRequiredError(listResponse?.error)) {
      reporter.markPlatformStatus(platform, 'auth_required')
      recordFailure('authentication_required')
      authenticationFailureRecorded = true
      return { attempted, processed: 1, succeeded: false }
    }

    if (!listResponse?.data) {
      throw new Error(`Failed to fetch conversations from ${platform}`)
    }

    reporter.markPlatformStatus(platform, 'ready')

    const allConversations: ConversationListItem[] = listResponse.data
    const listComplete = isScheduledConversationListComplete(listResponse.meta)

    // 5. Optionally skip archived conversations, preserving provider list order.
    const platformConfig = config.platforms[platform]
    if (!platformConfig.skipAlreadyExported && !listComplete) {
      reporter.markPlatformStatus(platform, 'error')
      status.lastRunError = 'The conversation list was incomplete; only available conversations were attempted.'
      void reporter.persist()
    }
    const exportedIds = platformConfig.skipAlreadyExported ? await getExportedIds(platform) : new Set<string>()
    const eligibleConversations = allConversations.filter(c => !exportedIds.has(c.id))

    // 6. Limit to max per run
    const toExport = eligibleConversations.slice(0, platformConfig.maxPerRun)

    // 7. Resolve conversation details with a user-selected per-provider
    // overlap cap. Starts remain paced, so raising concurrency improves
    // throughput for slow calls without firing an immediate request burst.
    // Markdown/download work is local and therefore runs through a separate
    // limiter; it never blocks the next eligible provider read.
    const requestPacer = new ScheduledRequestPacer(config.requestDelayMs)
    const outputGate = new ScheduledConcurrencyGate(platformConfig.maxConcurrentConversations)
    let rateLimited = false

    const exportResolvedConversation = async (
      convItem: ConversationListItem,
      conversation: Conversation
    ): Promise<void> => {
      let prepared: { markdown: string; filename: string }
      try {
        // Scheduled PDF export is deliberately unsupported: the MV3 worker
        // cannot render a document safely in the background.
        const exportFormat = platformConfig.format || config.defaultFormat
        if (exportFormat !== 'markdown') {
          throw new Error('Scheduled PDF export is not available in the background worker')
        }
        const exportOptions = buildScheduledExportOptions(exportFormat, settings)
        const markdown = conversationToMarkdown(conversation, exportOptions)
        const baseFilename = generateFilename(settings.filenamePattern, conversation)
        const filename = buildDownloadFilename(
          baseFilename,
          platform,
          '.md',
          settings.downloadFolder,
          settings.customFolderName
        )
        prepared = { markdown, filename }
      } catch {
        console.error('[Scheduled Export] Could not prepare Markdown output')
        recordFailure('serialization_failed')
        return
      }

      let downloadId: number | null = null
      try {
        // Build a service-worker-safe URL and wait for Chrome to report that
        // the file actually completed before recording it in history.
        const url = textToDataUrl(prepared.markdown, 'text/markdown')
        try {
          await downloadAndWait(
            {
              url, filename: prepared.filename, saveAs: false,
              // Scheduled-only opt-in. Leave the browser's original conflict
              // behavior untouched for legacy settings and manual exports.
              ...(platformConfig.overwriteExistingFiles === true ? { conflictAction: 'overwrite' as const } : {}),
            },
            60_000,
            chrome.downloads,
            {
              signal,
              onStarted: async (id) => {
                downloadId = id
                await retainPendingDownload(id, {
                  id: convItem.id, platform, title: convItem.title,
                  exportedAt: Date.now(), filename: prepared.filename,
                })
                await registerScheduledRunDownload(runId, id)
              },
            }
          )
        } finally {
          if (downloadId !== null && runId) {
            await releaseScheduledRunResource(runId, 'downloadIds', downloadId)
          }
        }
      } catch (error) {
        if (isExportCancelledError(error)) throw error
        console.error('[Scheduled Export] Browser download did not complete')
        recordFailure(classifyScheduledDownloadFailure(error))
        return
      }

      try {
        // Track an item only after a completed download. This keeps a failed
        // item eligible for the next run.
        await completePendingDownload(downloadId!)
      } catch (error) {
        if (isExportCancelledError(error)) throw error
        console.error('[Scheduled Export] Could not save export history')
        recordFailure('history_write_failed')
        return
      }

      exported += 1
      status.lastRunExported += 1
      void reporter.persist()
    }

    await runWithConcurrency(
      toExport,
      platformConfig.maxConcurrentConversations,
      async (convItem) => {
        if (rateLimited) return
        await requestPacer.waitForTurn(signal)
        // An earlier concurrent request may have reported a limit while this
        // worker waited for its paced turn. Do not add more provider traffic.
        if (rateLimited) return
        throwIfExportCancelled(signal)
        // A shared claim counts a request only when it is about to start,
        // preserving the total-run ceiling across parallel providers.
        if (!budget.tryClaim()) return
        attempted += 1

        const resolution = await resolveScheduledConversation(
          convItem,
          async () => {
            const response = await chrome.tabs.sendMessage(tabId!, {
              type: 'FETCH_CONVERSATION_DETAIL',
              data: { id: convItem.id, title: convItem.title },
            })
            return response as ScheduledConversationFetchResult
          },
          item => handleFetchConversationDetailInBackgroundTab(item, signal, runId),
          signal,
        )

        if (resolution.directFailureReason === 'rate_limited') {
          rateLimited = true
          reporter.markPlatformStatus(platform, 'rate_limited')
          recordScheduledRateLimit(status, platform)
          void reporter.persist()
        }

        if (!resolution.conversation) {
          recordFailure(resolution.failureReason ?? 'detail_unavailable')
          return
        }

        if (resolution.fallbackRecovered) {
          status.lastRunFallbackRecovered = (status.lastRunFallbackRecovered ?? 0) + 1
          void reporter.persist()
        }

        const outputTask = outputGate.run(() => exportResolvedConversation(convItem, resolution.conversation!))
        outputTasks.push(outputTask)
        // A stop can abort a queued browser download before the aggregate
        // await below. Observe it immediately to prevent an unhandled worker
        // rejection while still allowing the outer queue to return the reason.
        void outputTask.catch(() => undefined)
      }
    )

    await Promise.allSettled(outputTasks)

    return {
      attempted,
      processed: exported + failed,
      // Success diagnostics are independent of repeat mode's attempt cadence.
      succeeded: !rateLimited
        && (platformConfig.skipAlreadyExported || toExport.length === 0 || exported > 0)
        && shouldAdvanceScheduledLastRun({
          attempted: exported + failed,
          exported,
          failed,
          // Repeat mode completes the budget-limited batch, not an archive backlog.
          skipped: platformConfig.skipAlreadyExported
            ? Math.max(0, eligibleConversations.length - (exported + failed))
            : 0,
          listComplete,
        }),
      rateLimited,
    }

  } catch (err) {
    await Promise.allSettled(outputTasks)
    if (isExportCancelledError(err)) {
      status.lastRunCancelled = true
      void reporter.persist()
      return { attempted, processed: exported + failed, succeeded: false, cancelled: true }
    }
    // Raw provider errors may contain private URLs, titles, or response text.
    console.error(`[Scheduled Export] Platform ${platform} failed`)
    const authRequired = isAuthenticationRequiredError(err)
    reporter.markPlatformStatus(platform, authRequired ? 'auth_required' : 'error')
    if (authRequired && !authenticationFailureRecorded) {
      recordFailure('authentication_required')
      authenticationFailureRecorded = true
    }
    // Do not persist raw provider errors: they can include a URL or a
    // conversation title. The aggregate failures remain visible in the UI.
    status.lastRunError = 'A scheduled provider could not be prepared.'
    void reporter.persist()
    return { attempted, processed: exported + failed, succeeded: false }
  } finally {
    // 9. Close the tab
    if (tabId && config.closeTabAfterExport) {
      try {
        await chrome.tabs.remove(tabId)
      } catch {
        // Tab might already be closed
      }
    }
    if (tabId && runId) {
      try {
        await releaseScheduledRunResource(runId, 'tabIds', tabId)
      } catch {
        // Resource bookkeeping must never leave the platform cleanup hanging.
      }
    }
  }
}
