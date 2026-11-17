/**
 * Typed contract for `chrome.runtime.sendMessage` requests that target the
 * background service worker.
 *
 * - `BackgroundMessageSpec` is the single source of truth: one entry per
 *   message type, with the `data` payload a sender supplies and the `data`
 *   payload the worker answers with.
 * - `isBackgroundRequest` is the runtime envelope check used by the worker.
 *   It is intentionally lenient about `data`: every handler already validates
 *   its own payload and answers with a specific, user-visible error string,
 *   and those answers (and their ordering relative to the sender checks) are
 *   part of the extension's behavior.
 * - `sendBackgroundMessage` is the typed sender used by extension pages.
 *
 * This module only has type-level dependencies on feature modules so it can
 * be imported from any extension context without pulling in worker code.
 */
import type {
  Conversation,
  ConversationListItem,
  ExportablePlatform,
  ExtensionSettings,
} from '../types'
import type { ManualExportJob } from '../manual-export-job'
import type { PageSnapshot } from '../page-snapshot'
import type { PageSnapshotPreview } from '../page-snapshot-cache'
import type { RecoveryDraftSummary, RecoveryStatus } from '../recovery-drafts'
import type { SnapshotContext } from '../recovery-monitor'

/** Sent by the conversation-preview path; a literal here avoids an import cycle. */
export const PREVIEW_SNAPSHOT_MESSAGE = 'STORE_PREVIEW_SNAPSHOT' as const

/** A conversation as it crosses the process boundary: archive-only payload removed. */
export type TransferableConversation = Omit<Conversation, 'rawProviderPayload'>

export interface BackgroundConversationDetailRequest {
  item: ConversationListItem
  requestId?: string
}

export interface StartManualExportData {
  items?: ConversationListItem[]
  settings?: ExtensionSettings
  /** Resume the persisted job; `items` and `settings` are then ignored. */
  resume?: boolean
}

export interface RecoveryTabData { tabId: number }
export interface RecoveryIdData { id: string }
export interface RecoveryCheckpointData {
  sessionKey: string
  token: string
  context: SnapshotContext
  snapshot: PageSnapshot
}
export interface RecoveryPauseData {
  sessionKey: string
  token: string
  /** Informational; the worker records its own fixed pause reason. */
  reason?: string
}

export interface ExportRequestData {
  conversation: TransferableConversation
  format: string
  filename?: string
}

/** The shape every message answers with: a payload or an error string. */
export interface BackgroundResponse<D = unknown> {
  data?: D
  error?: string
}

type Spec<Data, Response> = { data: Data; response: Response }
type NoData = undefined

/** One entry per background message: `data` the sender supplies, `response` the data it receives. */
export interface BackgroundMessageSpec {
  START_MANUAL_EXPORT: Spec<StartManualExportData, ManualExportJob>
  STOP_MANUAL_EXPORT: Spec<NoData, true>
  PATCH_SETTINGS: Spec<Partial<ExtensionSettings>, ExtensionSettings>
  STORE_PREVIEW_SNAPSHOT: Spec<TransferableConversation, true>
  STORE_PAGE_SNAPSHOT_PREVIEW: Spec<{ snapshot: PageSnapshot; settings?: Partial<ExtensionSettings> }, true>
  GET_PAGE_SNAPSHOT_PREVIEW: Spec<{ captureId: string }, PageSnapshotPreview | null>
  DELETE_PAGE_SNAPSHOT_PREVIEW: Spec<{ captureId: string }, true>
  START_RECOVERY_PROTECTION: Spec<RecoveryTabData, RecoveryStatus>
  STOP_RECOVERY_PROTECTION: Spec<RecoveryTabData, { state: 'off'; sessionKey: '' }>
  PAUSE_RECOVERY_PROTECTION: Spec<RecoveryPauseData, RecoveryStatus>
  GET_RECOVERY_STATUS: Spec<RecoveryTabData, RecoveryStatus>
  WRITE_RECOVERY_CHECKPOINT: Spec<RecoveryCheckpointData, RecoveryStatus>
  LIST_RECOVERY_DRAFTS: Spec<NoData, RecoveryDraftSummary[]>
  GET_RECOVERY_DRAFT: Spec<RecoveryIdData, PageSnapshot | null>
  DELETE_RECOVERY_DRAFT: Spec<RecoveryIdData, true>
  CLEAR_RECOVERY_DRAFTS: Spec<NoData, true>
  STOP_RECOVERY_DRAFT: Spec<RecoveryIdData, RecoveryStatus>
  EXPORT_REQUEST: Spec<ExportRequestData, string>
  FETCH_CONVERSATION_DETAIL_IN_BACKGROUND_TAB: Spec<ConversationListItem | BackgroundConversationDetailRequest, Conversation>
  CANCEL_BACKGROUND_CONVERSATION_FETCH: Spec<{ requestId?: string }, boolean>
  SCHEDULED_EXPORT_RUN: Spec<NoData, true>
  SCHEDULED_EXPORT_CLEAR_HISTORY: Spec<NoData, true>
  SCHEDULED_EXPORT_STOP: Spec<NoData, boolean>
  GET_EXPORTED_CONVERSATION_IDS: Spec<ExportablePlatform, string[]>
}

export type BackgroundRequestType = keyof BackgroundMessageSpec

/** Discriminated union of every request the worker understands. */
export type BackgroundRequest = {
  [T in BackgroundRequestType]: BackgroundMessageSpec[T]['data'] extends undefined
    ? { type: T; data?: undefined }
    : { type: T; data: BackgroundMessageSpec[T]['data'] }
}[BackgroundRequestType]

/** The request variant for one message type. */
export type BackgroundRequestOf<T extends BackgroundRequestType> = Extract<BackgroundRequest, { type: T }>

/** The `data` a successful response to `T` carries. */
export type BackgroundResponseData<T extends BackgroundRequestType> = BackgroundMessageSpec[T]['response']

// Declaring the table as a total Record makes a new message type a compile
// error until it is registered here, which keeps the validator exhaustive.
const REQUEST_TYPE_TABLE: Record<BackgroundRequestType, true> = {
  START_MANUAL_EXPORT: true,
  STOP_MANUAL_EXPORT: true,
  PATCH_SETTINGS: true,
  STORE_PREVIEW_SNAPSHOT: true,
  STORE_PAGE_SNAPSHOT_PREVIEW: true,
  GET_PAGE_SNAPSHOT_PREVIEW: true,
  DELETE_PAGE_SNAPSHOT_PREVIEW: true,
  START_RECOVERY_PROTECTION: true,
  STOP_RECOVERY_PROTECTION: true,
  PAUSE_RECOVERY_PROTECTION: true,
  GET_RECOVERY_STATUS: true,
  WRITE_RECOVERY_CHECKPOINT: true,
  LIST_RECOVERY_DRAFTS: true,
  GET_RECOVERY_DRAFT: true,
  DELETE_RECOVERY_DRAFT: true,
  CLEAR_RECOVERY_DRAFTS: true,
  STOP_RECOVERY_DRAFT: true,
  EXPORT_REQUEST: true,
  FETCH_CONVERSATION_DETAIL_IN_BACKGROUND_TAB: true,
  CANCEL_BACKGROUND_CONVERSATION_FETCH: true,
  SCHEDULED_EXPORT_RUN: true,
  SCHEDULED_EXPORT_CLEAR_HISTORY: true,
  SCHEDULED_EXPORT_STOP: true,
  GET_EXPORTED_CONVERSATION_IDS: true,
}

export const BACKGROUND_REQUEST_TYPES = Object.freeze(Object.keys(REQUEST_TYPE_TABLE) as BackgroundRequestType[])

export function isBackgroundRequestType(value: unknown): value is BackgroundRequestType {
  // hasOwnProperty: 'toString', '__proto__' and friends must not count as message types.
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(REQUEST_TYPE_TABLE, value)
}

/**
 * Envelope validation: an object whose `type` names a known message. Payload
 * shape is checked by each handler (see the module comment for why).
 */
export function isBackgroundRequest(message: unknown): message is BackgroundRequest {
  return Boolean(message) && typeof message === 'object' && isBackgroundRequestType((message as { type?: unknown }).type)
}

/** Send a typed request to the background worker; the response type follows the request type. */
export function sendBackgroundMessage<T extends BackgroundRequest>(
  request: T,
): Promise<BackgroundResponse<BackgroundResponseData<T['type']>> | undefined> {
  return chrome.runtime.sendMessage(request)
}
