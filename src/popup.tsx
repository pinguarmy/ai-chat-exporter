/**
 * Popup Component
 * Redesigned UI with collapsible settings, primary actions above the fold,
 * open-source trust badge, platform awareness, and theme sync.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import './styles/popup.css'
import { ExportButton } from './components/ExportButton'
import { FormatSelector } from './components/FormatSelector'
import { ConversationList } from './components/ConversationList'
import { hasUsableConversation } from './lib/bulk-conversation'
import { Toggle } from './components/Toggle'
import { Pill } from './components/Pill'
import { ExportOptionsPanel } from './components/ExportOptionsPanel'
import { InfoTooltip } from './components/InfoTooltip'
import { SettingsIcon, SunIcon, MoonIcon, GithubChip } from './components/icons'
import { conversationToMarkdown } from './lib/export-markdown'
import { generateFilename, sanitizeFilename } from './lib/filename'
import { buildDownloadFilename } from './lib/download-path'
import { downloadMarkdownFile, finalizeExport } from './lib/export-download'
import { isExportCancelledError, throwIfExportCancelled } from './lib/export-cancel'
import { selectBulkConversations, normalizeBulkSelectionLimit } from './lib/bulk-selection'
import { analyzeConversationIntegrity, conversationIntegrityError, isConversationExportable, isTranscriptVerified } from './lib/conversation-integrity'
import { t, type Locale } from './lib/i18n'
import { mergeExtensionSettings } from './lib/types'
import { useThemeSync } from './lib/use-theme-sync'
import type { 
  Conversation, ExportFormat, ExtensionSettings, ConversationListItem, 
  BulkExportProgress, ExportOptions
} from './lib/types'

/** Tab mode type */
type TabMode = 'current' | 'bulk'

type ConversationListLoadMeta = {
  source: 'api' | 'sidebar'
  complete: boolean
  dateField?: 'last_activity'
  pagesFetched?: number
}

function getConversationListLoadMeta(value: unknown): ConversationListLoadMeta | null {
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

/** Inline SVG Icons */
const RefreshIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10"></polyline>
    <polyline points="1 20 1 14 7 14"></polyline>
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
  </svg>
)

const AiIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
  </svg>
)

/**
 * Detect platform from URL
 */
function detectPlatformFromUrl(url: string): 'chatgpt' | 'gemini' | 'claude' | 'deepseek' | 'grok' | null {
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'chatgpt.com' || parsed.hostname === 'chat.openai.com') return 'chatgpt'
    if (parsed.hostname === 'gemini.google.com') return 'gemini'
    if (parsed.hostname === 'claude.ai') return 'claude'
    if (parsed.hostname === 'deepseek.com' || parsed.hostname === 'chat.deepseek.com') return 'deepseek'
    if (parsed.hostname === 'grok.com' || parsed.hostname === 'www.grok.com') return 'grok'
  } catch {}
  return null
}

/**
 * Main Popup component
 */
export default function Popup() {
  const [platform, setPlatform] = useState<string | null>(null)
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [format, setFormat] = useState<ExportFormat>('markdown')
  const [loading, setLoading] = useState(false)
  const [stoppingExport, setStoppingExport] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [settings, setSettings] = useState<ExtensionSettings | null>(null)
  const [optionsOpen, setOptionsOpen] = useState(false)
  
  // Bulk export state
  const [tabMode, setTabMode] = useState<TabMode>('current')
  const [conversationList, setConversationList] = useState<ConversationListItem[]>([])
  const [conversationListMeta, setConversationListMeta] = useState<ConversationListLoadMeta | null>(null)
  const [conversationListNotice, setConversationListNotice] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<BulkExportProgress>({
    total: 0,
    completed: 0,
    failed: 0,
    current: '',
    status: 'idle'
  })
  const [bulkOptionsOpen, setBulkOptionsOpen] = useState(false)
  const [bulkFromDate, setBulkFromDate] = useState('')
  const [bulkToDate, setBulkToDate] = useState('')
  const [bulkSelectionLimit, setBulkSelectionLimit] = useState(100)
  const bulkDateRangeInvalid = Boolean(bulkFromDate && bulkToDate && bulkFromDate > bulkToDate)
  const [exportedConversationIds, setExportedConversationIds] = useState<string[]>([])
  const activeExportControllerRef = useRef<AbortController | null>(null)
  const activeBackgroundFetchIdsRef = useRef(new Set<string>())
  const backgroundFetchSequenceRef = useRef(0)
  // Content-script/API reads may resolve out of order while the active tab is
  // navigating. Only the latest detection request may commit popup state.
  const detectionSequenceRef = useRef(0)

  // Locale-bound translator
  const locale: Locale = settings?.locale ?? 'en'
  const T = (key: string) => t(key, locale)

  useEffect(() => {
    loadSettings()
  }, [])

  useEffect(() => {
    detectPlatformAndConversation()
    
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const handleTabUpdate = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => detectPlatformAndConversation(), 300)
    }
    
    chrome.tabs.onUpdated.addListener(handleTabUpdate)
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      chrome.tabs.onUpdated.removeListener(handleTabUpdate)
    }
  }, [])

  useThemeSync(settings?.theme)

  const loadSettings = async () => {
    try {
      const result = await chrome.storage.local.get('settings')
      if (result.settings) {
        const merged = mergeExtensionSettings(result.settings)
        setSettings(merged)
        setFormat(merged.defaultFormat)
      }
    } catch {
      // Use defaults
    }
  }

  /** Detect the active provider and load a safe exportable conversation. */
  const detectPlatformAndConversation = async () => {
    const requestSequence = ++detectionSequenceRef.current
    const isLatestRequest = () => detectionSequenceRef.current === requestSequence
    let detected: ReturnType<typeof detectPlatformFromUrl> = null
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!isLatestRequest() || !tab?.id || !tab.url) return

      detected = detectPlatformFromUrl(tab.url)
      setPlatform(detected)
      setSuccess(null)
      if (!detected) {
        setConversation(null)
        setError(null)
        return
      }

      // Popup reads are user-facing verification attempts. Bypass the short
      // background cooldown so Refresh actually retries the provider API.
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'PARSE_CONVERSATION',
        data: { forceVerify: true }
      })
      if (!isLatestRequest()) return

      if (response?.data) {
        setConversation(response.data)
        setError(null)
        // This cache is only a preview hand-off. Do not let its best-effort
        // storage write delay or supersede the latest visible conversation.
        void chrome.storage.local.set({
          [`conversation-${response.data.id}`]: { ...response.data, timestamp: Date.now() }
        }).catch(() => undefined)
      } else {
        setConversation(null)
        setError(typeof response?.error === 'string' && response.error
          ? response.error
          : 'Conversation content could not be verified for export.')
      }
    } catch (err) {
      if (!isLatestRequest()) return
      setConversation(null)
      // Keep a correctly detected provider visible; a content-script/API error
      // must not masquerade as "No Chat Detected".
      if (!detected) setPlatform(null)
      setError(err instanceof Error ? err.message : T('Could not read this conversation.'))
    }
  }

  /** Fetch conversation list via API and preserve whether the list is complete. */
  const fetchConversationList = async () => {
    setBulkLoading(true)
    setConversationListMeta(null)
    setConversationListNotice(null)
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) return

      const applyList = async (list: ConversationListItem[], meta: ConversationListLoadMeta | null) => {
        setConversationList(list)
        setConversationListMeta(meta)
        setSelectedIds(previous => previous.filter(id => list.some(item => item.id === id)))
        await loadExportedConversationIds(list)
      }

      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'FETCH_ALL_CONVERSATIONS' })
        if (Array.isArray(response?.data) && (response.data.length > 0 || response?.meta)) {
          const list = response.data as ConversationListItem[]
          await applyList(list, getConversationListLoadMeta(response.meta))
          return
        }
        if (response?.error && platform === 'gemini') {
          setConversationListNotice(
            /rate|429/i.test(String(response.error))
              ? T('Gemini is rate limiting this history request. Showing only current sidebar items.')
              : T('Gemini history request failed. Showing only current sidebar items.')
          )
        } else if (response?.error && platformLabel) {
          setConversationListNotice(t('{0} history request failed: {1}', locale, platformLabel, String(response.error)))
        }
      } catch {
        if (platform === 'gemini') {
          setConversationListNotice(T('Gemini history request failed. Showing only current sidebar items.'))
        } else if (platformLabel) {
          setConversationListNotice(t('{0} full history could not be loaded. Showing only currently visible sidebar items; refresh to retry.', locale, platformLabel))
        }
      }

      const response = await chrome.tabs.sendMessage(tab.id, { type: 'FETCH_CONVERSATION_LIST' })
      if (Array.isArray(response?.data)) {
        const list = response.data as ConversationListItem[]
        await applyList(list, { source: 'sidebar', complete: false })
      }
    } catch {
      setConversationList([])
      setConversationListMeta(null)
      if (platform === 'gemini') {
        setConversationListNotice(T('Gemini history request failed. Showing only current sidebar items.'))
      } else if (platformLabel) {
        setConversationListNotice(t('{0} full history could not be loaded. Showing only currently visible sidebar items; refresh to retry.', locale, platformLabel))
      }
    } finally {
      setBulkLoading(false)
    }
  }

  /** Read the bounded archive index used to skip duplicate bulk selections. */
  const loadExportedConversationIds = async (list: ConversationListItem[]) => {
    const sourcePlatform = list[0]?.platform
    if (!sourcePlatform) {
      setExportedConversationIds([])
      return
    }
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_EXPORTED_CONVERSATION_IDS',
        data: sourcePlatform,
      })
      setExportedConversationIds(Array.isArray(response?.data) ? response.data : [])
    } catch {
      setExportedConversationIds([])
    }
  }

  /** Handle export action for current conversation. */
  const handleExport = useCallback(async () => {
    if (!conversation) {
      setError(T('No conversation to export'))
      return
    }

    const integrity = analyzeConversationIntegrity(conversation)
    if (!isConversationExportable(conversation)) {
      setError(conversationIntegrityError(integrity))
      return
    }

    let exportConversation = conversation
    if (!conversation.title || 
        conversation.title === 'Untitled Conversation' || 
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversation.title)) {
      let betterTitle = ''
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (tab?.title) {
          const cleaned = tab.title.replace(/\s*[-–|]\s*(ChatGPT|Claude|Gemini|DeepSeek|Grok).*$/i, '').trim()
          if (cleaned && cleaned.length > 0 && !['ChatGPT', 'Claude', 'Gemini', 'DeepSeek', 'Grok'].includes(cleaned)) {
            betterTitle = cleaned
          }
        }
      } catch {}
      
      if (!betterTitle && conversation.messages.length > 0) {
        const firstUserMsg = conversation.messages.find(m => m.role === 'user')
        if (firstUserMsg) betterTitle = firstUserMsg.content.substring(0, 80)
      }
      
      if (betterTitle) exportConversation = { ...conversation, title: betterTitle }
    }

    setLoading(true)
    setStoppingExport(false)
    setError(null)
    setSuccess(null)
    const controller = new AbortController()
    activeExportControllerRef.current = controller

    try {
      const exportOptions = {
        format,
        includeMetadata: settings?.includeMetadata ?? true,
        includeCodeBlocks: settings?.includeCodeBlocks ?? true,
        includeImages: settings?.includeImages ?? true,
        exportArtifacts: settings?.exportArtifacts ?? true,
        includeUploadedFiles: settings?.includeUploadedFiles ?? true,
        referenceExportMode: settings?.referenceExportMode ?? 'titles',
        filenamePattern: settings?.filenamePattern,
        pdfStyle: settings?.pdfStyle ?? 'minimal',
        pdfTextLayer: settings?.pdfTextLayer ?? true,
        assistantDisplayName: settings?.assistantDisplayName ?? '',
        showMessageTimestamps: settings?.showMessageTimestamps ?? true,
        locale: settings?.locale ?? 'en'
      }

      const baseFilename = settings?.filenamePattern 
        ? generateFilename(settings.filenamePattern, exportConversation)
        : sanitizeFilename(exportConversation.title || 'conversation') || 'conversation'

      const downloadFolder = settings?.downloadFolder ?? 'default'
      const customFolderName = settings?.customFolderName ?? 'AI Chat Exports'
      const saveAs = settings?.askForSaveLocation ?? false

      const clearSuccess = () => setTimeout(() => setSuccess(null), 3000)

      if (format === 'markdown') {
        const markdown = conversationToMarkdown(exportConversation, exportOptions)
        const filename = buildDownloadFilename(baseFilename, exportConversation.platform, '.md', downloadFolder, customFolderName)
        await downloadMarkdownFile(markdown, { filename, saveAs, signal: controller.signal })
        await finalizeExport(exportConversation, format, filename, controller.signal)
        setSuccess(T('Exported as Markdown!'))
        clearSuccess()
      } else {
        const filename = buildDownloadFilename(baseFilename, exportConversation.platform, '.pdf', downloadFolder, customFolderName)
        const { exportToPdf } = await import('./lib/export-pdf')
        throwIfExportCancelled(controller.signal)
        await exportToPdf(exportConversation, exportOptions, filename, {
          signal: controller.signal,
          saveAs,
        })
        await finalizeExport(exportConversation, format, filename, controller.signal)
        setSuccess(T('PDF exported successfully!'))
        clearSuccess()
      }
    } catch (err) {
      if (isExportCancelledError(err)) setSuccess(T('Export stopped. Completed files were kept.'))
      else setError(err instanceof Error ? err.message : T('Export failed'))
    } finally {
      if (activeExportControllerRef.current === controller) activeExportControllerRef.current = null
      setStoppingExport(false)
      setLoading(false)
    }
  }, [conversation, format, settings])

  /** Handle bulk export. */
  const handleBulkExport = useCallback(async () => {
    if (selectedIds.length === 0) {
      setError(T('No conversations selected'))
      return
    }

    const selectedConversations = selectedIds
      .map(id => conversationList.find(conversation => conversation.id === id))
      .filter((conversation): conversation is ConversationListItem => !!conversation)

    const skipAlreadyExported = settings?.skipAlreadyExported ?? true
    const eligibleConversations = skipAlreadyExported
      ? selectedConversations.filter(item => !exportedConversationIds.includes(item.id))
      : selectedConversations

    if (eligibleConversations.length === 0) {
      setError(T('All selected conversations are already archived. Turn off duplicate protection to export them again.'))
      return
    }

    const controller = new AbortController()
    activeExportControllerRef.current = controller
    setLoading(true)
    setStoppingExport(false)
    setError(null)
    setSuccess(null)
    setBulkProgress({
      total: eligibleConversations.length,
      completed: 0,
      failed: 0,
      current: '',
      status: 'fetching'
    })

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) throw new Error('No active tab')

      const exportOptions: ExportOptions = {
        format,
        includeMetadata: settings?.includeMetadata ?? true,
        includeCodeBlocks: settings?.includeCodeBlocks ?? true,
        includeImages: settings?.includeImages ?? true,
        exportArtifacts: settings?.exportArtifacts ?? true,
        includeUploadedFiles: settings?.includeUploadedFiles ?? true,
        referenceExportMode: settings?.referenceExportMode ?? 'titles',
        filenamePattern: settings?.filenamePattern,
        pdfStyle: settings?.pdfStyle ?? 'minimal',
        pdfTextLayer: settings?.pdfTextLayer ?? true,
        assistantDisplayName: settings?.assistantDisplayName ?? '',
        showMessageTimestamps: settings?.showMessageTimestamps ?? true,
        pdfRenderMode: format === 'pdf' ? 'bulk' : undefined,
        locale: settings?.locale ?? 'en'
      }

      const downloadFolder = settings?.downloadFolder ?? 'default'
      const customFolderName = settings?.customFolderName ?? 'AI Chat Exports'
      const saveAs = settings?.askForSaveLocation ?? false

      const fetchConversation = async (convItem: ConversationListItem): Promise<Conversation> => {
        throwIfExportCancelled(controller.signal)
        let directError: string | null = null
        try {
          const response = await chrome.tabs.sendMessage(tab.id!, {
            type: 'FETCH_CONVERSATION_DETAIL',
            data: { id: convItem.id, title: convItem.title }
          })
          if (hasUsableConversation(response?.data as Conversation | null | undefined, convItem.id)) {
            return response.data as Conversation
          }
          directError = typeof response?.error === 'string' ? response.error : null
        } catch (error) {
          directError = error instanceof Error ? error.message : null
        }

        // Claude's page uses the same authoritative API path and its live DOM
        // is virtualized, so opening another tab cannot safely recover detail.
        // Skipping that fallback also prevents repeated API calls during a
        // provider outage or authentication failure.
        if (convItem.platform === 'claude') {
          throw new Error(directError || `Could not verify complete Claude content for ${convItem.title || 'this conversation'}`)
        }

        throwIfExportCancelled(controller.signal)
        const requestId = `popup-detail-${Date.now()}-${++backgroundFetchSequenceRef.current}`
        activeBackgroundFetchIdsRef.current.add(requestId)
        try {
          const backgroundResponse = await chrome.runtime.sendMessage({
            type: 'FETCH_CONVERSATION_DETAIL_IN_BACKGROUND_TAB',
            data: { item: convItem, requestId }
          })
          throwIfExportCancelled(controller.signal)
          if (hasUsableConversation(backgroundResponse?.data as Conversation | null | undefined, convItem.id)) {
            return backgroundResponse.data as Conversation
          }
        } finally {
          activeBackgroundFetchIdsRef.current.delete(requestId)
        }

        throw new Error(`Could not load real content for ${convItem.title || 'this conversation'}`)
      }

      const startConversationFetch = async (convItem: ConversationListItem): Promise<{
        conversation?: Conversation
        error?: unknown
      }> => {
        try {
          return { conversation: await fetchConversation(convItem) }
        } catch (error) {
          return { error }
        }
      }

      let currentConversationFetch = startConversationFetch(eligibleConversations[0])
      let completed = 0
      let failed = 0
      let cancelled = false
      for (let i = 0; i < eligibleConversations.length; i++) {
        if (controller.signal.aborted) {
          cancelled = true
          break
        }

        const convItem = eligibleConversations[i]
        setBulkProgress(prev => ({ ...prev, current: convItem.title, status: 'exporting' }))

        let nextConversationFetch: Promise<{ conversation?: Conversation; error?: unknown }> | null = null
        try {
          const result = await currentConversationFetch
          if (controller.signal.aborted) {
            cancelled = true
            break
          }
          nextConversationFetch = i + 1 < eligibleConversations.length
            ? startConversationFetch(eligibleConversations[i + 1])
            : null
          if (result.error) throw result.error
          if (!result.conversation) throw new Error(`Could not load real content for ${convItem.title || 'this conversation'}`)

          const conv = result.conversation
          const integrity = analyzeConversationIntegrity(conv)
          if (!isConversationExportable(conv)) throw new Error(conversationIntegrityError(integrity))

          const baseFilename = settings?.filenamePattern
            ? generateFilename(settings.filenamePattern, conv, i + 1)
            : sanitizeFilename(conv.title || 'conversation') || 'conversation'

          let filename: string
          if (format === 'markdown') {
            const markdown = conversationToMarkdown(conv, exportOptions)
            filename = buildDownloadFilename(baseFilename, conv.platform, '.md', downloadFolder, customFolderName)
            await downloadMarkdownFile(markdown, { filename, saveAs, signal: controller.signal })
          } else {
            filename = buildDownloadFilename(baseFilename, conv.platform, '.pdf', downloadFolder, customFolderName)
            const { exportToPdf } = await import('./lib/export-pdf')
            throwIfExportCancelled(controller.signal)
            await exportToPdf(conv, exportOptions, filename, { signal: controller.signal, saveAs })
          }

          await finalizeExport(conv, format, filename, controller.signal)

          setBulkProgress(prev => ({ ...prev, completed: prev.completed + 1 }))
          completed++
          setExportedConversationIds(previous => previous.includes(conv.id) ? previous : [...previous, conv.id])
          currentConversationFetch = nextConversationFetch ?? currentConversationFetch
        } catch (err) {
          if (controller.signal.aborted || isExportCancelledError(err)) {
            cancelled = true
            break
          }
          setBulkProgress(prev => ({ ...prev, failed: prev.failed + 1 }))
          failed++
          currentConversationFetch = nextConversationFetch ?? (i + 1 < eligibleConversations.length
            ? startConversationFetch(eligibleConversations[i + 1])
            : currentConversationFetch)
        }
      }

      if (cancelled) {
        setBulkProgress(prev => ({ ...prev, status: 'cancelled', current: '' }))
        setSuccess(T('Export stopped. Completed files were kept.'))
      } else if (completed === 0) {
        setBulkProgress(prev => ({ ...prev, status: 'error' }))
        setError(T('Bulk export failed'))
      } else {
        setBulkProgress(prev => ({ ...prev, status: 'done' }))
        setSuccess(failed > 0 ? T('Bulk export completed with some failures.') : T('Bulk export completed!'))
      }
    } catch (err) {
      if (controller.signal.aborted || isExportCancelledError(err)) {
        setBulkProgress(prev => ({ ...prev, status: 'cancelled', current: '' }))
        setSuccess(T('Export stopped. Completed files were kept.'))
      } else {
        setBulkProgress(prev => ({ ...prev, status: 'error' }))
        setError(err instanceof Error ? err.message : T('Bulk export failed'))
      }
    } finally {
      if (activeExportControllerRef.current === controller) activeExportControllerRef.current = null
      activeBackgroundFetchIdsRef.current.clear()
      setStoppingExport(false)
      setLoading(false)
    }
  }, [selectedIds, conversationList, format, settings, exportedConversationIds])

  const handleOptionChange = async (key: keyof ExtensionSettings, value: any) => {
    if (!settings) return
    const updated = { ...settings, [key]: value }
    setSettings(updated)
    try {
      await chrome.storage.local.set({ settings: updated })
    } catch (err) {
      console.error('Failed to save settings:', err)
    }
  }

  const handleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const handleToggleAll = () => {
    if (selectedIds.length === conversationList.length) setSelectedIds([])
    else setSelectedIds(conversationList.map(c => c.id))
  }

  const applyBulkSelection = () => {
    if (bulkDateRangeInvalid) {
      setError(T('The start date must be on or before the end date.'))
      return
    }
    const selected = selectBulkConversations(conversationList, {
      from: bulkFromDate || undefined,
      to: bulkToDate || undefined,
      limit: normalizeBulkSelectionLimit(bulkSelectionLimit),
      excludedIds: (settings?.skipAlreadyExported ?? true) ? exportedConversationIds : [],
    })
    setSelectedIds(selected.map(item => item.id))
    setError(null)
  }

  const stopActiveExport = () => {
    if (!activeExportControllerRef.current) return
    setStoppingExport(true)
    activeExportControllerRef.current.abort()
    const requestIds = [...activeBackgroundFetchIdsRef.current]
    activeBackgroundFetchIdsRef.current.clear()
    for (const requestId of requestIds) {
      void chrome.runtime.sendMessage({
        type: 'CANCEL_BACKGROUND_CONVERSATION_FETCH',
        data: { requestId },
      }).catch(() => undefined)
    }
  }

  const openOptions = () => {
    chrome.runtime.openOptionsPage()
  }

  const switchToBulk = () => {
    setTabMode('bulk')
    if (conversationList.length === 0) fetchConversationList()
  }

  const estimateSize = (conv: Conversation) => {
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

  const platformLabel = platform === 'chatgpt' ? 'ChatGPT' : platform === 'gemini' ? 'Gemini' : platform === 'claude' ? 'Claude' : platform === 'deepseek' ? 'DeepSeek' : platform === 'grok' ? 'Grok' : null

  /** History completeness state for providers whose full list can be partial. */
  const historyState = bulkLoading
    ? null
    : conversationListNotice
      ? { message: conversationListNotice, warning: true }
      : platform === 'gemini'
        ? conversationListMeta?.source === 'api'
          ? conversationListMeta.complete
            ? { message: T('Gemini account history loaded. You do not need to scroll the sidebar.'), warning: false }
            : { message: T('Gemini returned a partial history. Refresh to retry; sidebar scrolling cannot complete it.'), warning: true }
          : conversationListMeta?.source === 'sidebar'
            ? { message: T('Gemini full history could not be loaded. Showing only current sidebar items; refresh to retry.'), warning: true }
            : null
        : conversationListMeta && platformLabel
          ? conversationListMeta.source === 'api'
            ? conversationListMeta.complete
              ? {
                  message: conversationListMeta.pagesFetched
                    ? t('{0} account history loaded ({1} pages).', locale, platformLabel, conversationListMeta.pagesFetched)
                    : t('{0} account history loaded.', locale, platformLabel),
                  warning: false
                }
              : {
                  message: conversationListMeta.pagesFetched
                    ? t('{0} returned a partial history after {1} pages. The count shown is not complete; refresh to retry.', locale, platformLabel, conversationListMeta.pagesFetched)
                    : t('{0} returned a partial history. The count shown is not complete; refresh to retry.', locale, platformLabel),
                  warning: true
                }
            : {
                message: t('{0} full history could not be loaded. Showing only currently visible sidebar items; refresh to retry.', locale, platformLabel),
                warning: true
              }
          : null

  return (
    <div className="popup-container">
      {/* Header */}
      <div className="popup-header">
        <div className="flex-col gap-1">
          <h1>{T('AI Chat Exporter')}</h1>
          <div><GithubChip title={t('View GitHub Repository', locale)} label={<span>{t('100% free · open source', locale)}</span>} /></div>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-icon"
            onClick={() => handleOptionChange('theme', settings?.theme === 'dark' ? 'light' : 'dark')}
            title={T('Toggle Theme')}
            aria-label={T('Toggle Theme')}
          >
            {settings?.theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
          <button 
            className="btn-icon" 
            onClick={openOptions} 
            title={T('Open Settings')}
            aria-label={T('Open Settings')}
          >
            <SettingsIcon />
          </button>
        </div>
      </div>
      
      {/* Body */}
      <div className="popup-body">
        <div className="tabs">
          <button type="button" className={`tab ${tabMode === 'current' ? 'active' : ''}`} onClick={() => setTabMode('current')}>
            {T('Current Chat')}
          </button>
          <button type="button" className={`tab ${tabMode === 'bulk' ? 'active' : ''}`} onClick={switchToBulk}>
            {T('Bulk Export')}
          </button>
        </div>

        {tabMode === 'current' && (
          <div className="tab-content">
            {!platform ? (
              <div className="empty-state">
                <div style={{ background: 'var(--bg-tertiary)', padding: '12px', borderRadius: '50%' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  </svg>
                </div>
                <div className="flex-col gap-1 items-center">
                  <p style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>{T('No Chat Detected')}</p>
                  <p className="text-xs text-muted" style={{ textAlign: 'center', maxWidth: '240px', lineHeight: 1.4 }}>
                    {T('Open a conversation on a supported platform to export:')}
                  </p>
                </div>
                <div className="flex justify-center flex-wrap gap-1 mt-1">
                  <span className="badge chatgpt">ChatGPT</span>
                  <span className="badge gemini">Gemini</span>
                  <span className="badge claude">Claude</span>
                  <span className="badge deepseek">DeepSeek</span>
                  <span className="badge grok">Grok</span>
                </div>
              </div>
            ) : !conversation ? (
              <div className="empty-state">
                {!error && (
                  <div style={{ background: 'var(--primary-light)', padding: '12px', borderRadius: '50%' }}>
                    <span className="spinner" style={{ borderTopColor: 'var(--primary)', width: '22px', height: '22px' }}></span>
                  </div>
                )}
                <div className="flex-col gap-1 items-center">
                  <p style={{ fontWeight: 600, fontSize: '14px', color: error ? 'var(--error)' : 'var(--text-primary)' }}>
                    {error ? T('Export verification failed') : T('Detecting...')}
                  </p>
                  <p className="text-xs text-muted" style={{ textAlign: 'center', maxWidth: '280px' }}>
                    {error || T('Extracting conversation content')}
                  </p>
                  {error && (
                    <button type="button" className="btn btn-outline btn-compact mt-1" onClick={detectPlatformAndConversation}>
                      {T('Refresh')}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="conversation-info">
                  <div className="conversation-info-header">
                    <Pill label={platformLabel || ''} platform={platform} icon={<AiIcon />} />
                  </div>
                  <h2>{conversation.title || T('Untitled Conversation')}</h2>
                  <div className="preview-summary">
                    <span>
                      {t('{0} messages', locale, conversation.messages.length)} · {estimateSize(conversation)}
                      {isTranscriptVerified(conversation) === true ? ` · ${T('Verified source')}` : ''}
                      {/* Full verification diagnostics UI is PR-12. */}
                    </span>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => {
                        chrome.tabs.create({ url: chrome.runtime.getURL('tabs/preview.html') + `?id=${conversation.id}` })
                      }}
                      title={T('Live Preview ↗')}
                    >
                      {T('Live Preview ↗')}
                    </button>
                  </div>
                </div>

                <div className="flex-col gap-2">
                  <span className="section-label">{T('Quick Export')}</span>
                  <FormatSelector value={format} onChange={setFormat} disabled={loading} />
                </div>

                {error && <div className="message error" role="alert">{error}</div>}
                {success && <div className="message success" role="alert">{success}</div>}

                <div className="mt-1">
                  <ExportButton onClick={handleExport} disabled={!conversation} loading={loading} format={format} isSuccess={!!success} locale={locale} />
                  {loading && (
                    <button type="button" className="btn btn-outline export-stop-btn" onClick={stopActiveExport} disabled={stoppingExport}>
                      {stoppingExport ? T('Stopping…') : T('Stop Export')}
                    </button>
                  )}
                </div>

                <ExportOptionsPanel
                  open={optionsOpen}
                  onToggle={() => setOptionsOpen(!optionsOpen)}
                  settings={settings}
                  conversation={conversation}
                  format={format}
                  loading={loading}
                  onOptionChange={handleOptionChange}
                  T={T}
                />
              </>
            )}
          </div>
        )}

        {tabMode === 'bulk' && (
          <div className="tab-content" style={{ gap: '10px' }}>
            <div className="flex justify-between items-center">
              <Pill label={platformLabel || T('Unknown')} platform={platform || 'unknown'} icon={<AiIcon />} />
              <button 
                type="button"
                className="btn btn-outline btn-compact flex items-center gap-1" 
                onClick={fetchConversationList}
                disabled={bulkLoading}
                title={T('Refresh conversation list')}
                aria-label={T('Refresh conversation list')}
              >
                <RefreshIcon /> 
                <span className="text-xs font-bold">{T('Refresh')}</span>
              </button>
            </div>
            
            <div className="bulk-history-summary" aria-live="polite">
              <span className="text-xs text-muted">
                {bulkLoading
                  ? (platform === 'gemini' ? T('Loading full Gemini history…') : T('Loading conversations...'))
                  : `${conversationList.length} ${T('conversations found')}`}
              </span>
              {historyState && (
                <p className={`bulk-history-state ${historyState.warning ? 'bulk-history-state-warning' : 'bulk-history-state-success'}`} role="status">
                  {historyState.message}
                </p>
              )}
            </div>

            <div className="bulk-selection-panel">
              <div className="bulk-selection-heading">
                <div>
                  <span className="section-label">
                    {T('Date & Quantity Selection')}
                    <InfoTooltip
                      text={`${T('Select a date range and a maximum number of conversations in one step. The cap keeps each bulk run bounded; dates come from the provider when available.')} ${T('Already archived conversations are excluded from this quick selection.')}`}
                    />
                  </span>
                </div>
                <button type="button" className="btn btn-outline btn-compact" onClick={applyBulkSelection} disabled={loading || bulkLoading || conversationList.length === 0 || bulkDateRangeInvalid}>
                  {T('Select Matching')}
                </button>
              </div>
              <div className="bulk-selection-controls">
                <label>
                  <span>{T('From')}</span>
                  <input className="input" type="date" value={bulkFromDate} onChange={event => setBulkFromDate(event.target.value)} disabled={loading || bulkLoading} />
                </label>
                <label>
                  <span>{T('To')}</span>
                  <input className="input" type="date" value={bulkToDate} onChange={event => setBulkToDate(event.target.value)} disabled={loading || bulkLoading} />
                </label>
                <label className="bulk-selection-limit">
                  <span>{T('Max conversations')}</span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={500}
                    value={bulkSelectionLimit}
                    onChange={event => setBulkSelectionLimit(normalizeBulkSelectionLimit(Number(event.target.value)))}
                    disabled={loading || bulkLoading}
                  />
                </label>
              </div>
              {bulkDateRangeInvalid && (
                <p className="bulk-selection-error" role="alert">{T('The start date must be on or before the end date.')}</p>
              )}
              <Toggle
                label={T('Skip Already Archived')}
                description={T('Use the recent export history to avoid duplicate bulk downloads. You can turn this off to intentionally export again.')}
                checked={settings?.skipAlreadyExported ?? true}
                onChange={value => handleOptionChange('skipAlreadyExported', value)}
                disabled={loading || bulkLoading}
              />
            </div>

            {(bulkProgress.status === 'fetching' || bulkProgress.status === 'exporting') && (
              <div className="flex-col gap-1">
                <div className="flex justify-between text-xs font-medium">
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '280px' }}>
                    {bulkProgress.status === 'fetching' ? T('Fetching...') : `${T('Exporting:')}${bulkProgress.current}`}
                  </span>
                  <span>{Math.round((bulkProgress.completed / bulkProgress.total) * 100)}%</span>
                </div>
                <div className="progress-bg">
                  <div className="progress-fill" style={{ width: `${(bulkProgress.completed / bulkProgress.total) * 100}%` }} />
                </div>
                <button type="button" className="btn btn-outline btn-compact export-stop-btn" onClick={stopActiveExport} disabled={stoppingExport}>
                  {stoppingExport ? T('Stopping…') : T('Stop Export')}
                </button>
              </div>
            )}

            <ConversationList
              conversations={conversationList}
              selectedIds={selectedIds}
              onSelect={handleSelect}
              onSelectAll={handleToggleAll}
              onDeselectAll={() => setSelectedIds([])}
              onExport={handleBulkExport}
              loading={loading}
              bulkLoading={bulkLoading}
              T={T}
            />

            <div className="flex-col gap-2 mt-1">
              <span className="section-label">{T('Format:')}</span>
              <FormatSelector value={format} onChange={setFormat} disabled={loading} />
            </div>

            <ExportOptionsPanel
              open={bulkOptionsOpen}
              onToggle={() => setBulkOptionsOpen(!bulkOptionsOpen)}
              settings={settings}
              conversation={conversation}
              format={format}
              loading={loading}
              onOptionChange={handleOptionChange}
              T={T}
            />

            {error && <div className="message error" role="alert">{error}</div>}
            {success && <div className="message success" role="alert">{success}</div>}

            <div className="mt-1">
              <ExportButton
                onClick={handleBulkExport}
                disabled={selectedIds.length === 0}
                loading={loading}
                format={format}
                text={`${T('Export')} ${selectedIds.length} ${T('Selected')}`}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
