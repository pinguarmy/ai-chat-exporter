/**
 * Typed message router for the background worker.
 *
 * `HANDLERS` is a total mapping over `BackgroundRequest['type']`: adding a
 * message type to the contract without a handler here is a compile error.
 */
import type {
  BackgroundRequest,
  BackgroundRequestOf,
  BackgroundRequestType,
  BackgroundResponse,
} from '../platform/background-messages'
import { isBackgroundRequest } from '../platform/background-messages'
import type { MessagePayload } from '../core/types'
import { persistSettingsPatch } from '../platform/settings-store'
import { handleCancelForegroundConversationDetailRequest, handleForegroundConversationDetailRequest } from './background-fetch'
import { handleExportRequest, handleClearExportHistory, handleGetExportedConversationIds } from './export-history'
import { handleStartManualExport, handleStopManualExport } from './manual-export'
import {
  handleClearRecoveryDrafts, handleDeleteRecoveryDraft, handleGetRecoveryDraft, handleGetRecoveryStatus,
  handleListRecoveryDrafts, handlePauseRecoveryProtection, handleStartRecoveryProtection,
  handleStopRecoveryDraft, handleStopRecoveryProtection, handleWriteRecoveryCheckpoint,
} from './recovery'
import { handleScheduledExportRun, handleScheduledExportStop } from './scheduled-export'
import {
  handleDeletePageSnapshotPreview, handleGetPageSnapshotPreview,
  handleStorePageSnapshotPreview, handleStorePreviewSnapshot,
} from './snapshot-preview'

export type BackgroundHandler<T extends BackgroundRequestType> = (
  request: BackgroundRequestOf<T>,
  sender: chrome.runtime.MessageSender,
) => Promise<BackgroundResponse>

export type BackgroundHandlerTable = { [T in BackgroundRequestType]: BackgroundHandler<T> }

export const HANDLERS: BackgroundHandlerTable = {
  START_MANUAL_EXPORT: handleStartManualExport,
  STOP_MANUAL_EXPORT: handleStopManualExport,
  PATCH_SETTINGS: async ({ data }) => ({ data: await persistSettingsPatch(data) }),
  STORE_PREVIEW_SNAPSHOT: handleStorePreviewSnapshot,
  STORE_PAGE_SNAPSHOT_PREVIEW: handleStorePageSnapshotPreview,
  GET_PAGE_SNAPSHOT_PREVIEW: handleGetPageSnapshotPreview,
  DELETE_PAGE_SNAPSHOT_PREVIEW: handleDeletePageSnapshotPreview,
  START_RECOVERY_PROTECTION: handleStartRecoveryProtection,
  STOP_RECOVERY_PROTECTION: handleStopRecoveryProtection,
  PAUSE_RECOVERY_PROTECTION: handlePauseRecoveryProtection,
  GET_RECOVERY_STATUS: handleGetRecoveryStatus,
  WRITE_RECOVERY_CHECKPOINT: handleWriteRecoveryCheckpoint,
  LIST_RECOVERY_DRAFTS: handleListRecoveryDrafts,
  GET_RECOVERY_DRAFT: handleGetRecoveryDraft,
  DELETE_RECOVERY_DRAFT: handleDeleteRecoveryDraft,
  CLEAR_RECOVERY_DRAFTS: handleClearRecoveryDrafts,
  STOP_RECOVERY_DRAFT: handleStopRecoveryDraft,
  EXPORT_REQUEST: ({ data }) => handleExportRequest(data),
  FETCH_CONVERSATION_DETAIL_IN_BACKGROUND_TAB: ({ data }) => handleForegroundConversationDetailRequest(data),
  CANCEL_BACKGROUND_CONVERSATION_FETCH: ({ data }) => handleCancelForegroundConversationDetailRequest(data?.requestId),
  SCHEDULED_EXPORT_RUN: () => handleScheduledExportRun(),
  SCHEDULED_EXPORT_CLEAR_HISTORY: () => handleClearExportHistory(),
  SCHEDULED_EXPORT_STOP: () => handleScheduledExportStop(),
  GET_EXPORTED_CONVERSATION_IDS: ({ data }) => handleGetExportedConversationIds(data),
}

function dispatch<T extends BackgroundRequestType>(
  request: BackgroundRequestOf<T>,
  sender: chrome.runtime.MessageSender,
): Promise<BackgroundResponse> {
  return (HANDLERS[request.type as T] as BackgroundHandler<T>)(request, sender)
}

/** Handle one incoming message. Exported for tests; the listener wraps it. */
export async function handleMessage(
  message: MessagePayload,
  sender: chrome.runtime.MessageSender,
): Promise<BackgroundResponse> {
  // Only this extension's own contexts may drive the worker. There is no
  // externally_connectable today, but never rely on the manifest alone.
  if (sender.id !== chrome.runtime.id) {
    return { error: 'Unauthorized message sender' }
  }

  if (!isBackgroundRequest(message)) {
    return { error: `Unknown message type: ${message.type}` }
  }
  return dispatch(message as BackgroundRequest, sender)
}

/** The `chrome.runtime.onMessage` listener. Returns true to keep the channel open for the async reply. */
export function onRuntimeMessage(
  message: MessagePayload,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
): boolean {
  handleMessage(message, sender)
    .then(response => sendResponse(response))
    .catch(error => {
      const snapshotOrRecovery = /SNAPSHOT|RECOVERY/.test(message?.type || '')
      sendResponse({ error: snapshotOrRecovery ? 'Local save operation failed. Existing saved content was retained; retry or save Markdown directly.' : error.message })
    })

  return true // Keep message channel open for async response
}
