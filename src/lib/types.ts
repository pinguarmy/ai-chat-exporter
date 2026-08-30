/**
 * Shared TypeScript interfaces for AI Chat Exporter
 */

import type { Locale } from './i18n'

/**
 * Represents a single message in a conversation
 */
export type MessageReferenceType = 'file' | 'web' | 'memory' | 'unknown'

/** Provider-neutral citation/source metadata attached to one visible turn. */
export interface MessageReference {
  type: MessageReferenceType
  /** Human-readable source title. May itself be private, so export policy applies. */
  title: string
  /** Sanitized HTTP(S) URL only; omitted when unsafe or unavailable. */
  url?: string
  /** True for account-scoped connectors such as Gmail, Drive, Docs or SharePoint. */
  private?: boolean
  /** Optional public attribution such as a publisher or hostname. */
  source?: string
}

export interface ChatMessage {
  /** Unique identifier for the message */
  id: string
  /** Role of the message sender */
  role: 'user' | 'assistant' | 'system'
  /** Text content of the message */
  content: string
  /** Optional author name */
  authorName?: string
  /** Optional timestamp (Unix milliseconds) */
  timestamp?: number
  /** Optional attachments (images, files, links) */
  attachments?: Attachment[]
  /** Optional code blocks extracted from the message */
  codeBlocks?: CodeBlock[]
  /** Structured citations and source references for this visible turn. */
  references?: MessageReference[]
}

/**
 * Represents an attachment
 */
export interface Attachment {
  /** Type of attachment */
  type: 'image' | 'file' | 'link'
  /** URL of the attachment */
  url: string
  /** Optional display name */
  name?: string
  /** True when the attachment originated in a user turn. Exporters use this
   *  provenance to hide uploaded non-image files without removing images. */
  uploaded?: boolean
}

/**
 * Represents a code block in a message
 */
export interface CodeBlock {
  /** Programming language (if detected) */
  language?: string
  /** The actual code content */
  code: string
}

/**
 * Represents an artifact extracted from a conversation
 */
export interface ConversationArtifact {
  /** Type of artifact */
  type: 'code' | 'document' | 'image' | 'html'
  /** Optional title/name for the artifact */
  title?: string
  /** The content of the artifact */
  content: string
  /** Programming language (for code artifacts) */
  language?: string
  /** MIME type (for document artifacts) */
  mimeType?: string
  /** Optional URL the artifact/research doc is hosted at (when it is a
   *  viewable document rather than inline content). Used by the markdown
   *  "## Artifacts" section so the toggle has real data to list. */
  url?: string
  /** True when this artifact is a user-uploaded file rather than model output. */
  uploaded?: boolean
}

/** Supported chat platforms. */
export type ConversationPlatform = 'chatgpt' | 'gemini' | 'claude' | 'deepseek' | 'grok'

/** Where the exported conversation body came from. */
export type ConversationSource = 'api' | 'dom' | 'mixed'

/**
 * Whether the provider source itself proved that the returned transcript is
 * complete. This is deliberately separate from message-shape heuristics: a
 * verified one-sided conversation can be legitimate, while a virtualized DOM
 * snapshot can look balanced and still be truncated.
 *
 * Compatibility field: when `verification` is present, `syncSourceCompleteness`
 * derives this from `verification.transcript.verified`.
 */
export type ConversationSourceCompleteness = 'verified' | 'unverified'

/** How the exporter proved (or failed to prove) that a transcript is complete. */
export type TranscriptVerificationMethod =
  | 'active-branch-root-chain'
  | 'provider-detail-terminal'
  | 'provider-api-complete'
  | 'provider-api-incomplete'
  | 'dom-unverified'

/**
 * Structured, non-private explanation of why a conversation is verified or not.
 * Reasons are machine codes such as `missing_parent` or `cycle`. Never put
 * conversation text, cookies, or tokens here.
 */
export interface VerificationEvidence {
  provider: ConversationPlatform
  source: ConversationSource
  transcript: {
    verified: boolean
    method: TranscriptVerificationMethod
    reasons: string[]
  }
  history?: {
    complete: boolean
    pagesFetched?: number
    terminalCursorObserved?: boolean
  }
  capturedAt: number
}

/**
 * Represents a complete conversation
 */
export interface Conversation {
  /** Unique identifier for the conversation */
  id: string
  /** Title of the conversation */
  title: string
  /** URL of the conversation page */
  url: string
  /** Array of messages in order */
  messages: ChatMessage[]
  /** Optional creation timestamp */
  createdAt?: number
  /** Optional model identifier supplied by the provider API */
  modelName?: string
  /** Platform where the conversation originates */
  platform: ConversationPlatform
  /** Optional artifacts extracted from the conversation */
  artifacts?: ConversationArtifact[]
  /** Parser/source that supplied the transcript body. */
  source?: ConversationSource
  /** Explicit provider-level completeness verification when available. */
  sourceCompleteness?: ConversationSourceCompleteness
  /** Structured verification evidence. Authoritative over sourceCompleteness. */
  verification?: VerificationEvidence
}

/**
 * Supported export formats
 */
export type ExportFormat = 'pdf' | 'markdown'

/** Visual treatment for PDF and rendered preview output. */
export type PdfStyle = 'minimal' | 'classic'

/** Privacy policy for source/citation references in exported files. */
export type ReferenceExportMode = 'off' | 'titles' | 'safe-links' | 'all-links'

/**
 * Options for exporting a conversation
 */
export interface ExportOptions {
  /** Export format (PDF or Markdown) */
  format: ExportFormat
  /** Whether to include metadata (title, timestamp, etc.) */
  includeMetadata: boolean
  /** Whether to preserve code blocks */
  includeCodeBlocks: boolean
  /** Whether to include images */
  includeImages: boolean
  /** When true, AI-generated artifacts / research docs are emitted as a
   *  separate "## Artifacts" section (the markdown equivalent of saving them
   *  as separate files). When false, they stay inline only. */
  exportArtifacts?: boolean
  /** When true, references to files the USER uploaded into the chat are kept.
   *  When false, uploaded-file references are stripped from the export. */
  includeUploadedFiles?: boolean
  /** Citation/reference privacy policy. Defaults to titles only. */
  referenceExportMode?: ReferenceExportMode
  /** Filename pattern template (e.g., '{date}-{title}') */
  filenamePattern?: string
  /** Use bounded lower-cost rendering when exporting many PDFs. */
  pdfRenderMode?: 'quality' | 'bulk'
  /** Add a selectable Unicode text layer to PDF pages for sharp search/copy. */
  pdfTextLayer?: boolean
  /** PDF visual treatment. Defaults to the centered, neutral minimal layout. */
  pdfStyle?: PdfStyle
  /** Optional assistant heading override; blank means provider/model label. */
  assistantDisplayName?: string
  /** Show per-message timestamps when the provider supplied them. */
  showMessageTimestamps?: boolean
  /** Locale for generated export labels and date formatting. */
  locale?: Locale
}

/**
 * Represents an item in the conversation list for bulk export
 */
export interface ConversationListItem {
  id: string
  title: string
  url: string
  platform: 'chatgpt' | 'gemini' | 'claude' | 'deepseek' | 'grok'
  /** Optional: number of messages */
  messageCount?: number
  /** Optional: creation timestamp */
  createdAt?: number
  /**
   * Provider list timestamp for the most recent activity. Kept separate from
   * createdAt so a provider's list ordering metadata is never presented as an
   * exact conversation-start date.
   */
  updatedAt?: number
}

/**
 * Tracks progress of a bulk export operation
 */
export interface BulkExportProgress {
  total: number
  completed: number
  failed: number
  current: string // title of current conversation being exported
  status: 'idle' | 'fetching' | 'exporting' | 'done' | 'cancelled' | 'error'
}

/**
 * A single filename variable option
 */
export interface FilenameOption {
  key: string        // e.g. "date", "title", "platform", "index"
  label: string      // e.g. "Date (YYYY-MM-DD)"
  example: string    // e.g. "2026-06-11"
}

/**
 * Available filename template variables
 */
export const FILENAME_OPTIONS: FilenameOption[] = [
  { key: 'date', label: 'Conversation Date (start)', example: '2026-05-20' },
  { key: 'datetime', label: 'Conversation Date & Time (start)', example: '2026-05-20T093000' },
  { key: 'end_date', label: 'Export Date (YYYY-MM-DD)', example: '2026-06-11' },
  { key: 'conv_date', label: 'Conversation Date (start, alias)', example: '2026-05-20' },
  { key: 'conv_datetime', label: 'Conversation Date & Time (start, alias)', example: '2026-05-20T093000' },
  { key: 'title', label: 'Conversation Title', example: 'my-chat-about-python' },
  { key: 'platform', label: 'Platform', example: 'chatgpt' },
  { key: 'index', label: 'Number (for bulk)', example: '001' },
  { key: 'msgcount', label: 'Message Count', example: '24' },
]

/**
 * Download folder options
 */
export type DownloadFolderOption = 'default' | 'by-platform' | 'custom'

/**
 * Extension settings stored in chrome.storage
 */
export interface ExtensionSettings {
  /** Default export format */
  defaultFormat: ExportFormat
  /** Whether to include metadata by default */
  includeMetadata: boolean
  /** Whether to include code blocks by default */
  includeCodeBlocks: boolean
  /** Whether to include images by default */
  includeImages: boolean
  /** UI theme */
  theme: 'light' | 'dark'
  /** Filename pattern template */
  filenamePattern: string
  /** Download folder strategy */
  downloadFolder: DownloadFolderOption
  /** Custom folder name (used when downloadFolder is 'custom') */
  customFolderName: string
  /** Open the browser's Save As chooser for interactive exports. */
  askForSaveLocation: boolean
  /** In bulk mode, omit conversations already recorded as exported. */
  skipAlreadyExported: boolean
  /** Whether to export artifacts as separate files */
  exportArtifacts: boolean
  /** Whether to include uploaded file references */
  includeUploadedFiles: boolean
  /** Citation/reference privacy policy for all export formats. */
  referenceExportMode: ReferenceExportMode
  /** Default visual treatment for PDF exports and the rendered preview */
  pdfStyle: PdfStyle
  /** Whether PDF exports include a Unicode searchable/copyable text layer */
  pdfTextLayer: boolean
  /** Optional assistant heading override; blank means provider/model label. */
  assistantDisplayName: string
  /** Whether per-message timestamps are shown when available. */
  showMessageTimestamps: boolean
  /** UI language */
  locale: Locale
  /** Scheduled export configuration */
  scheduledExport?: ScheduledExportSettings
}

/**
 * Default settings values
 */
export const DEFAULT_SETTINGS: ExtensionSettings = {
  defaultFormat: 'markdown',
  includeMetadata: true,
  includeCodeBlocks: true,
  includeImages: true,
  theme: 'light',
  locale: 'en',
  filenamePattern: '{date}-{title}',
  downloadFolder: 'default',
  customFolderName: 'AI Chat Exports',
  askForSaveLocation: false,
  skipAlreadyExported: true,
  exportArtifacts: true,
  includeUploadedFiles: true,
  // Keep useful source labels while avoiding account-scoped Gmail/Drive URLs
  // in files users may later share publicly.
  referenceExportMode: 'titles',
  pdfStyle: 'minimal',
  pdfTextLayer: true,
  assistantDisplayName: '',
  showMessageTimestamps: true
}

/**
 * Merge persisted settings with defaults so older records receive newly added
 * export preferences.
 */
export function mergeExtensionSettings(
  settings?: Partial<ExtensionSettings>
): ExtensionSettings {
  return { ...DEFAULT_SETTINGS, ...(settings || {}) }
}

/** Supported platforms for scheduled export */
export type ExportablePlatform = 'chatgpt' | 'claude' | 'gemini' | 'deepseek' | 'grok'

/** Schedule frequency options */
export type ScheduleFrequency = 'hourly' | 'every6h' | 'daily' | 'weekly' | 'custom'

/** Scheduled export configuration for a single platform */
export interface PlatformScheduleConfig {
  /** Whether this platform's schedule is enabled */
  enabled: boolean
  /** How often to check for new conversations */
  frequency: ScheduleFrequency
  /** Max conversations to export per run (prevents runaway exports) */
  maxPerRun: number
  /**
   * Maximum detail reads allowed to overlap for this provider. A higher value
   * can improve throughput, but each provider applies its own rate limits.
   */
  maxConcurrentConversations: number
  /** Export format override (falls back to defaultFormat) */
  format?: ExportFormat
  /**
   * Optional local wall-clock time (HH:mm) for daily and weekly schedules.
   * When omitted, those schedules retain their legacy relative-interval
   * behavior so existing users are not silently moved to a new run time.
   */
  timeOfDay?: string
  /** Local Sunday-first weekday (0–6) used by weekly schedules. */
  dayOfWeek?: number
  /**
   * Custom rolling interval in minutes. Used only when `frequency` is
   * `custom`; values are clamped by the scheduler before they are persisted.
   */
  intervalMinutes?: number
}

/** Complete scheduled export settings */
export interface ScheduledExportSettings {
  /** Whether scheduled export is globally enabled */
  enabled: boolean
  /** How often the background worker wakes up to inspect due platforms. */
  checkIntervalMinutes: number
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
  /** Number of provider workers allowed to run at the same time (1–3). */
  maxConcurrentPlatforms: number
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

/** Safe, aggregate reasons a scheduled export can fail. Never store chat text or titles here. */
export type ScheduledExportFailureReason =
  | 'rate_limited'
  | 'authentication_required'
  | 'detail_unavailable'
  | 'detail_incomplete'
  | 'fallback_unavailable'
  | 'fallback_incomplete'
  | 'serialization_failed'
  | 'download_request_failed'
  | 'download_interrupted'
  | 'download_timed_out'
  | 'history_write_failed'

/** Safe provider-level state from the most recent scheduled check. */
export type ScheduledExportPlatformState =
  | 'ready'
  | 'auth_required'
  | 'rate_limited'
  | 'error'

export interface ScheduledExportPlatformStatus {
  /** The last safe state observed for this provider. */
  state: ScheduledExportPlatformState
  /** When the provider check produced this state. */
  checkedAt: number
}

/** Status of the last scheduled export run */
export interface ScheduledExportStatus {
  /** Opaque identifier for the active run. It contains no conversation data. */
  runId?: string
  /** When the last run started */
  lastRunAt?: number
  /** When the last run finished */
  lastRunFinishedAt?: number
  /** Total conversations exported in last run */
  lastRunExported: number
  /** Total conversations that failed in last run */
  lastRunFailed: number
  /** Aggregate failure categories for the last run, with no conversation identifiers or content. */
  lastRunFailureBreakdown?: Partial<Record<ScheduledExportFailureReason, number>>
  /** Conversations rescued by opening their own inactive page after API detail was incomplete. */
  lastRunFallbackRecovered?: number
  /** Providers that rate limited this run. Names only; never chat data or raw provider errors. */
  lastRunRateLimitedPlatforms?: ExportablePlatform[]
  /** Last safe authentication/request state for each provider. */
  platformStatuses?: Partial<Record<ExportablePlatform, ScheduledExportPlatformStatus>>
  /** Any error message from the last run */
  lastRunError?: string
  /** Currently running? */
  isRunning: boolean
  /** Which platform is currently being processed */
  currentPlatform?: ExportablePlatform
  /** Providers currently active in this run. `currentPlatform` remains for older UI clients. */
  activePlatforms?: ExportablePlatform[]
  /** True when a user stopped the run before its queue was exhausted. */
  lastRunCancelled?: boolean
  /** A stop request was accepted and the queue is unwinding. */
  stopRequested?: boolean
}

/**
 * Message payload interface
 */
export interface MessagePayload<T = unknown> {
  type: string
  data?: T
  error?: string
}
