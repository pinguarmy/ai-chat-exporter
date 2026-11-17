/**
 * Pure helpers shared by the popup shell, its panels and its hooks.
 */

import { conversationToMarkdown } from '../../core/export-markdown'
import { t, type Locale } from '../../core/i18n'
import type { BulkFailureCategory } from '../../core/bulk-selection'
import type { Conversation, ExportFormat, ExtensionSettings } from '../../core/types'

/** Tab mode type */
export type TabMode = 'current' | 'bulk'

/** Locale-bound translator passed down from the popup shell. */
export type Translate = (key: string, ...args: Array<string | number>) => string

export type ConversationListLoadMeta = {
  source: 'api' | 'sidebar'
  complete: boolean
  dateField?: 'last_activity'
  pagesFetched?: number
}

export function getConversationListLoadMeta(value: unknown): ConversationListLoadMeta | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ConversationListLoadMeta>
  if ((candidate.source !== 'api' && candidate.source !== 'sidebar') || typeof candidate.complete !== 'boolean') {
    return null
  }
  return {
    source: candidate.source,
    complete: candidate.complete,
    ...(candidate.dateField === 'last_activity' ? { dateField: candidate.dateField } : {}),
    ...(Number.isFinite(candidate.pagesFetched) ? { pagesFetched: candidate.pagesFetched } : {})
  }
}

/**
 * Detect platform from URL
 */
export function detectPlatformFromUrl(url: string): 'chatgpt' | 'gemini' | 'claude' | 'deepseek' | 'grok' | null {
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'chatgpt.com' || parsed.hostname === 'chat.openai.com') return 'chatgpt'
    if (parsed.hostname === 'gemini.google.com') return 'gemini'
    if (parsed.hostname === 'claude.ai') return 'claude'
    if (parsed.hostname === 'deepseek.com' || parsed.hostname === 'chat.deepseek.com') return 'deepseek'
    if (parsed.hostname === 'grok.com' || parsed.hostname === 'www.grok.com') return 'grok'
  } catch { /* an unparseable URL is simply not a supported provider page */ }
  return null
}

export async function targetTabs(): Promise<chrome.tabs.Tab[]> {
  const id = new URLSearchParams(window.location.search).get('sourceTab')
  if (id && /^\d+$/.test(id)) return [await chrome.tabs.get(Number(id))]
  return chrome.tabs.query({ active: true, currentWindow: true })
}

export function getPlatformLabel(platform: string | null): string | null {
  return platform === 'chatgpt' ? 'ChatGPT' : platform === 'gemini' ? 'Gemini' : platform === 'claude' ? 'Claude' : platform === 'deepseek' ? 'DeepSeek' : platform === 'grok' ? 'Grok' : null
}

export const getCategoryLabel = (category: BulkFailureCategory, loc: Locale): string => {
  switch (category) {
    case 'rate_limited':
      return t('Rate limited', loc)
    case 'network_error':
      return t('Network error', loc)
    case 'verification_failed':
      return t('Verification failed', loc)
    case 'export_failed':
      return t('Export error', loc)
    default:
      return t('Unknown error', loc)
  }
}

export const estimateSize = (conv: Conversation, settings: ExtensionSettings | null) => {
  try {
    const exportOptions = {
      format: 'markdown' as ExportFormat,
      includeMetadata: settings?.includeMetadata ?? true,
      includeCodeBlocks: settings?.includeCodeBlocks ?? true,
      includeImages: settings?.includeImages ?? true,
      exportArtifacts: settings?.exportArtifacts ?? true,
      includeUploadedFiles: settings?.includeUploadedFiles ?? true,
      referenceExportMode: settings?.referenceExportMode ?? 'titles',
      locale: settings?.locale ?? 'en'
    }
    const markdown = conversationToMarkdown(conv, exportOptions)
    const bytes = new Blob([markdown]).size
    if (bytes < 1024) return `${bytes} B`
    return `${(bytes / 1024).toFixed(1)} KB`
  } catch {
    return '0 KB'
  }
}
