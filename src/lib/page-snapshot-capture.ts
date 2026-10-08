/**
 * Request an observed-DOM page snapshot from a provider tab.
 *
 * Shared by the snapshot panel and by the regular export button, which falls
 * back to a snapshot when the full source cannot be verified. The request is
 * DOM-only on the content-script side; this helper adds the consistency checks
 * that make the result safe to save: the response must echo our request id,
 * and the tab must still show the same URL after the capture.
 */
import { isPageSnapshot } from './page-snapshot'
import type { PageSnapshot } from './types'

export const CAPTURE_NOT_RECOGNIZED = 'The capture response was not recognized. Please retry.'
export const PAGE_CHANGED = 'The page changed while capturing. Please retry.'
export const NO_CAPTURE_TAB = 'Open a supported conversation tab to capture a snapshot.'

type CaptureResponse = {
  data?: unknown
  error?: unknown
  meta?: { requestId?: unknown }
}

export async function requestPageSnapshotFromTab(
  tabId: number,
  requestId: string = crypto.randomUUID(),
  isCurrent: () => boolean = () => true
): Promise<PageSnapshot | null> {
  const before = await chrome.tabs.get(tabId)
  const startUrl = before?.url ?? ''
  if (!startUrl) throw new Error(NO_CAPTURE_TAB)
  const response = (await chrome.tabs.sendMessage(tabId, {
    type: 'CAPTURE_PAGE_SNAPSHOT',
    data: { requestId },
  })) as CaptureResponse | undefined
  // A superseded request is dropped without reporting anything.
  if (!isCurrent()) return null
  if (response?.meta?.requestId !== requestId) throw new Error(CAPTURE_NOT_RECOGNIZED)
  if (typeof response?.error === 'string' && response.error) throw new Error(response.error)
  // A navigation during capture voids the result. The URL is a consistency
  // check only; identity comes from the echoed request id.
  const after = await chrome.tabs.get(tabId).catch(() => null)
  if (!after?.url || after.url !== startUrl) throw new Error(PAGE_CHANGED)
  if (!isPageSnapshot(response?.data)) throw new Error(CAPTURE_NOT_RECOGNIZED)
  return response.data
}
