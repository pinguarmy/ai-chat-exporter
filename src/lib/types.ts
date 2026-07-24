/**
 * Shared TypeScript interfaces for AI Chat Exporter
 */

/**
 * Represents a single message in a conversation
 */
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
}

/**
 * Represents an attachment in a message
 */
export interface Attachment {
  /** Type of attachment */
  type: 'image' | 'file' | 'link'
  /** URL of the attachment */
  url: string
  /** Optional display name */
  name?: string
  /** True when this is a file the USER uploaded into the chat (vs. an
   *  AI-generated artifact). Used to honor the includeUploadedFiles option. */
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
  /** Platform where the conversation originates */
  platform: 'chatgpt' | 'gemini' | 'claude' | 'deepseek' | 'grok'
  /** Optional artifacts extracted from the conversation */
  artifacts?: ConversationArtifact[]
}

/**
 * Supported export formats
 */
export type ExportFormat = 'pdf' | 'markdown'

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
  /** Filename pattern template (e.g., '{date}-{title}') */
  filenamePattern?: string
  /** Use bounded lower-cost rendering when exporting many PDFs. */
  pdfRenderMode?: 'quality' | 'bulk'
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
}

/**
 * Tracks progress of a bulk export operation
 */
export interface BulkExportProgress {
  total: number
  completed: number
  failed: number
  current: string // title of current conversation being exported
  status: 'idle' | 'fetching' | 'exporting' | 'done' | 'error'
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
  { key: 'date', label: 'Export Date (YYYY-MM-DD)', example: '2026-06-11' },
  { key: 'datetime', label: 'Export Date & Time', example: '2026-06-11T143022' },
  { key: 'end_date', label: 'Current/Export Date', example: '2026-06-11' },
  { key: 'conv_date', label: 'Conversation Date (start)', example: '2026-05-20' },
  { key: 'conv_datetime', label: 'Conversation Date & Time (start)', example: '2026-05-20T103000' },
  { key: 'title', label: 'Conversation Title', example: 'my-chat-about-python' },
  { key: 'platform', label: 'Platform', example: 'chatgpt' },
  { key: 'index', label: 'Number (for bulk)', example: '001' },
  { key: 'msgcount', label: 'Message Count', example: '24' },
]

/**
 * Platform parser interface
 */
export interface PlatformParser {
  /** The platform this parser handles */
  platform: 'chatgpt' | 'gemini' | 'claude' | 'deepseek' | 'grok'
  
  /**
   * Parse the current conversation from the DOM
   * @returns Promise resolving to the parsed conversation or null
   */
  parseCurrentConversation(): Promise<Conversation | null>
  
  /**
   * Check if the current page is a conversation page
   */
  isConversationPage(): boolean
  
  /**
   * Get the title of the current conversation
   */
  getConversationTitle(): string
}

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
  /** Whether to export artifacts as separate files */
  exportArtifacts: boolean
  /** Whether to include uploaded file references */
  includeUploadedFiles: boolean
  /** UI language */
  locale: 'en' | 'zh-CN' | 'zh-TW'
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
  exportArtifacts: true,
  includeUploadedFiles: true
}
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

/** Message types for communication between components */
export type MessageType = 
  | 'PARSE_CONVERSATION'
  | 'CONVERSATION_PARSED'
  | 'EXPORT_REQUEST'
  | 'EXPORT_COMPLETE'
  | 'GET_SETTINGS'
  | 'SETTINGS_UPDATED'
  | 'DETECT_PLATFORM'
  | 'PLATFORM_DETECTED'
  | 'FETCH_CONVERSATION_LIST'
  | 'CONVERSATION_LIST_FETCHED'
  | 'FETCH_ALL_CONVERSATIONS'
  | 'ALL_CONVERSATIONS_FETCHED'
  | 'FETCH_CONVERSATION_DETAIL'
  | 'FETCH_CONVERSATION_DETAIL_IN_BACKGROUND_TAB'
  | 'BULK_EXPORT'
  | 'BULK_EXPORT_PROGRESS'
  | 'SCHEDULED_EXPORT_RUN'
  | 'SCHEDULED_EXPORT_STATUS'
  | 'SCHEDULED_EXPORT_CONFIG'
  | 'SCHEDULED_EXPORT_CLEAR_HISTORY'

/**
 * Message payload interface
 */
export interface MessagePayload<T = unknown> {
  type: MessageType
  data?: T
  error?: string
}
