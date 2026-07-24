/**
 * Popup Component
 * Redesigned UI with collapsible settings, primary actions above the fold,
 * open-source trust badge, platform awareness, and theme sync.
 */

import React, { useState, useEffect, useCallback } from 'react'
import './styles/popup.css'
import { ExportButton } from './components/ExportButton'
import { FormatSelector } from './components/FormatSelector'
import { ConversationList } from './components/ConversationList'
import { hasUsableConversation } from './lib/bulk-conversation'
import { FilenameEditor } from './components/FilenameEditor'
import { Toggle } from './components/Toggle'
import { Section } from './components/Section'
import { Pill } from './components/Pill'
import { conversationToMarkdown, generateMarkdownFilename } from './lib/export-markdown'
import { exportToPdf } from './lib/export-pdf'
import { generateFilename } from './lib/filename'
import { buildDownloadFilename } from './lib/download-path'
import { t, type Locale } from './lib/i18n'
import type { 
  Conversation, ExportFormat, ExtensionSettings, ConversationListItem, 
  BulkExportProgress, ExportOptions
} from './lib/types'

/** Tab mode type */
type TabMode = 'current' | 'bulk'

/** Inline SVG Icons */
const SettingsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"></circle>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
  </svg>
)

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

const ChevronIcon = ({ direction }: { direction: 'up' | 'down' }) => (
  <svg 
    width="12" 
    height="12" 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2.5" 
    strokeLinecap="round" 
    strokeLinejoin="round"
    style={{ 
      transform: direction === 'up' ? 'rotate(180deg)' : 'none', 
      transition: 'transform 200ms cubic-bezier(0.4, 0, 0.2, 1)' 
    }}
  >
    <polyline points="6 9 12 15 18 9"></polyline>
  </svg>
)

/** Sun icon (light mode) */
const SunIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4"></circle>
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path>
  </svg>
)

/** Moon icon (dark mode) */
const MoonIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
  </svg>
)

const GithubChip = () => (
  <a
    href="https://github.com/pinguarmy/ai-chat-exporter"
    target="_blank"
    rel="noopener noreferrer"
    className="github-chip"
    title="View GitHub Repository"
  >
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px' }}>
      <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
    </svg>
    <span>100% free · open source</span>
  </a>
)

/**
 * Detect platform from URL
 */
function detectPlatformFromUrl(url: string): 'chatgpt' | 'gemini' | 'claude' | 'deepseek' | 'grok' | null {
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'chatgpt.com' || parsed.hostname === 'chat.openai.com') {
      return 'chatgpt'
    }
    if (parsed.hostname === 'gemini.google.com') {
      return 'gemini'
    }
    if (parsed.hostname === 'claude.ai') {
      return 'claude'
    }
    if (parsed.hostname === 'deepseek.com' || parsed.hostname === 'chat.deepseek.com') {
      return 'deepseek'
    }
    if (parsed.hostname === 'grok.com' || parsed.hostname === 'www.grok.com') {
      return 'grok'
    }
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
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [settings, setSettings] = useState<ExtensionSettings | null>(null)
  const [optionsOpen, setOptionsOpen] = useState(false)
  
  // Bulk export state
  const [tabMode, setTabMode] = useState<TabMode>('current')
  const [conversationList, setConversationList] = useState<ConversationListItem[]>([])
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

  // Locale-bound translator
  const locale: Locale = settings?.locale ?? 'en'
  const T = (key: string) => t(key, locale)

  // Load settings on mount
  useEffect(() => {
    loadSettings()
  }, [])

  // Detect platform and conversation when tab changes (debounced)
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

  // Synchronize theme with html attribute and support prefers-color-scheme
  useEffect(() => {
    if (settings?.theme) {
      document.documentElement.setAttribute('data-theme', settings.theme)
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light')
    }
  }, [settings?.theme])

  /**
   * Load extension settings
   */
  const loadSettings = async () => {
    try {
      const result = await chrome.storage.local.get('settings')
      if (result.settings) {
        setSettings(result.settings)
        setFormat(result.settings.defaultFormat)
      }
    } catch (err) {
      // Use defaults
    }
  }

  /**
   * Detect current platform and parse conversation
   */
  const detectPlatformAndConversation = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id || !tab.url) return

      const detected = detectPlatformFromUrl(tab.url)
      setPlatform(detected)
      
      if (!detected) return

      // Request conversation data from content script
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'PARSE_CONVERSATION'
      })

      if (response?.data) {
        setConversation(response.data)
        // Set in storage for the preview page
        await chrome.storage.local.set({
          [`conversation-${response.data.id}`]: { ...response.data, timestamp: Date.now() }
        })
        setError(null)
      } else {
        setConversation(null)
      }
    } catch (err) {
      setPlatform(null)
      setConversation(null)
    }
  }

  /**
   * Fetch conversation list via API (all conversations, not just sidebar)
   */
  const fetchConversationList = async () => {
    setBulkLoading(true)
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) return

      // Try FETCH_ALL_CONVERSATIONS first (API-based, gets all)
      try {
        const response = await chrome.tabs.sendMessage(tab.id, {
          type: 'FETCH_ALL_CONVERSATIONS'
        })
        if (response?.data && response.data.length > 0) {
          setConversationList(response.data)
          setBulkLoading(false)
          return
        }
      } catch (e) {
        // Fall back to DOM-based list
      }

      // Fallback: DOM-based sidebar list
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'FETCH_CONVERSATION_LIST'
      })

      if (response?.data) {
        setConversationList(response.data)
      }
    } catch (err) {
      setConversationList([])
    } finally {
      setBulkLoading(false)
    }
  }

  /**
   * Handle export action for current conversation
   */
  const handleExport = useCallback(async () => {
    if (!conversation) {
      setError(T('No conversation to export'))
      return
    }

    // Ensure conversation has a meaningful title for filename generation
    let exportConversation = conversation
    if (!conversation.title || 
        conversation.title === 'Untitled Conversation' || 
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversation.title)) {
      // Try to get title from document.title
      let betterTitle = ''
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (tab?.title) {
          // Strip platform suffixes like " - ChatGPT", " | Claude", etc.
          const cleaned = tab.title.replace(/\s*[-–|]\s*(ChatGPT|Claude|Gemini|DeepSeek|Grok).*$/i, '').trim()
          if (cleaned && cleaned.length > 0 && cleaned !== 'ChatGPT' && cleaned !== 'Claude' && cleaned !== 'Gemini' && cleaned !== 'DeepSeek' && cleaned !== 'Grok') {
            betterTitle = cleaned
          }
        }
      } catch {}
      
      // Fall back to first user message
      if (!betterTitle && conversation.messages.length > 0) {
        const firstUserMsg = conversation.messages.find(m => m.role === 'user')
        if (firstUserMsg) {
          betterTitle = firstUserMsg.content.substring(0, 80)
        }
      }
      
      if (betterTitle) {
        exportConversation = { ...conversation, title: betterTitle }
      }
    }

    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const exportOptions = {
        format,
        includeMetadata: settings?.includeMetadata ?? true,
        includeCodeBlocks: settings?.includeCodeBlocks ?? true,
        includeImages: settings?.includeImages ?? true,
        exportArtifacts: settings?.exportArtifacts ?? true,
        includeUploadedFiles: settings?.includeUploadedFiles ?? true,
        filenamePattern: settings?.filenamePattern
      }

      const baseFilename = settings?.filenamePattern 
        ? generateFilename(settings.filenamePattern, exportConversation)
        : generateMarkdownFilename(exportConversation).replace(/\.md$/, '')

      const downloadFolder = settings?.downloadFolder ?? 'default'
      const customFolderName = settings?.customFolderName ?? 'AI Chat Exports'

      const clearSuccess = () => setTimeout(() => setSuccess(null), 3000)

      if (format === 'markdown') {
        const markdown = conversationToMarkdown(exportConversation, exportOptions)
        const filename = buildDownloadFilename(baseFilename, exportConversation.platform, '.md', downloadFolder, customFolderName)
        
        // Create and download file
        const blob = new Blob([markdown], { type: 'text/markdown' })
        const url = URL.createObjectURL(blob)
        
        await chrome.downloads.download({
          url,
          filename,
          saveAs: false
        })
        
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        setSuccess(T('Exported as Markdown!'))
        clearSuccess()
      } else {
        const filename = buildDownloadFilename(baseFilename, exportConversation.platform, '.pdf', downloadFolder, customFolderName)
        await exportToPdf(exportConversation, exportOptions, filename)
        setSuccess(T('PDF exported successfully!'))
        clearSuccess()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : T('Export failed'))
    } finally {
      setLoading(false)
    }
  }, [conversation, format, settings])

  /**
   * Handle bulk export
   */
  const handleBulkExport = useCallback(async () => {
    if (selectedIds.length === 0) {
      setError(T('No conversations selected'))
      return
    }

    const selectedConversations = selectedIds
      .map(id => conversationList.find(conversation => conversation.id === id))
      .filter((conversation): conversation is ConversationListItem => !!conversation)

    if (selectedConversations.length === 0) {
      setError(T('No conversations selected'))
      return
    }

    setLoading(true)
    setError(null)
    setSuccess(null)
    setBulkProgress({
      total: selectedConversations.length,
      completed: 0,
      failed: 0,
      current: '',
      status: 'fetching'
    })

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) {
        throw new Error('No active tab')
      }

      const exportOptions: ExportOptions = {
        format,
        includeMetadata: settings?.includeMetadata ?? true,
        includeCodeBlocks: settings?.includeCodeBlocks ?? true,
        includeImages: settings?.includeImages ?? true,
        exportArtifacts: settings?.exportArtifacts ?? true,
        includeUploadedFiles: settings?.includeUploadedFiles ?? true,
        filenamePattern: settings?.filenamePattern,
        pdfRenderMode: format === 'pdf' ? 'bulk' : undefined
      }

      const downloadFolder = settings?.downloadFolder ?? 'default'
      const customFolderName = settings?.customFolderName ?? 'AI Chat Exports'

      const fetchConversation = async (convItem: ConversationListItem): Promise<Conversation> => {
        try {
          const response = await chrome.tabs.sendMessage(tab.id!, {
            type: 'FETCH_CONVERSATION_DETAIL',
            data: { id: convItem.id, title: convItem.title }
          })
          if (hasUsableConversation(response?.data as Conversation | null | undefined, convItem.id)) {
            return response.data as Conversation
          }
        } catch {
          // The selected conversation might not be the open tab.
        }

        const backgroundResponse = await chrome.runtime.sendMessage({
          type: 'FETCH_CONVERSATION_DETAIL_IN_BACKGROUND_TAB',
          data: convItem
        })
        if (hasUsableConversation(backgroundResponse?.data as Conversation | null | undefined, convItem.id)) {
          return backgroundResponse.data as Conversation
        }

        throw new Error(`Could not load real content for ${convItem.title || 'this conversation'}`)
      }

      // The next item is prefetched while the current one renders. Convert a
      // rejection into a settled result immediately so a fast API failure does
      // not surface as an unhandled rejection before the next loop iteration.
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

      // Keep PDF rendering single-threaded, but fetch the next conversation
      // while the current one is being rendered.
      let nextConversation = startConversationFetch(selectedConversations[0])
      let completed = 0
      let failed = 0
      for (let i = 0; i < selectedConversations.length; i++) {
        const convItem = selectedConversations[i]
        const currentConversation = nextConversation
        if (i + 1 < selectedConversations.length) {
          nextConversation = startConversationFetch(selectedConversations[i + 1])
        }

        setBulkProgress(prev => ({
          ...prev,
          current: convItem.title,
          status: 'exporting'
        }))

        try {
          const result = await currentConversation
          if (result.error) throw result.error
          if (!result.conversation) {
            throw new Error(`Could not load real content for ${convItem.title || 'this conversation'}`)
          }
          const conv = result.conversation

          const baseFilename = settings?.filenamePattern
            ? generateFilename(settings.filenamePattern, conv, i + 1)
            : `${conv.title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').substring(0, 200) || 'conversation'}`

          if (format === 'markdown') {
            const markdown = conversationToMarkdown(conv, exportOptions)
            const filename = buildDownloadFilename(baseFilename, conv.platform, '.md', downloadFolder, customFolderName)
            const blob = new Blob([markdown], { type: 'text/markdown' })
            const url = URL.createObjectURL(blob)
            
            await chrome.downloads.download({
              url,
              filename,
              saveAs: false
            })
            
            setTimeout(() => URL.revokeObjectURL(url), 1000)
          } else {
            const filename = buildDownloadFilename(baseFilename, conv.platform, '.pdf', downloadFolder, customFolderName)
            await exportToPdf(conv, exportOptions, filename)
          }

          setBulkProgress(prev => ({
            ...prev,
            completed: prev.completed + 1
          }))
          completed++
        } catch (err) {
          setBulkProgress(prev => ({
            ...prev,
            failed: prev.failed + 1
          }))
          failed++
        }
      }

      if (completed === 0) {
        setBulkProgress(prev => ({
          ...prev,
          status: 'error'
        }))
        setError(T('Bulk export failed'))
      } else {
        setBulkProgress(prev => ({
          ...prev,
          status: 'done'
        }))
        setSuccess(failed > 0 ? T('Bulk export completed with some failures.') : T('Bulk export completed!'))
      }
    } catch (err) {
      setBulkProgress(prev => ({
        ...prev,
        status: 'error'
      }))
      setError(err instanceof Error ? err.message : T('Bulk export failed'))
    } finally {
      setLoading(false)
    }
  }, [selectedIds, conversationList, format, settings])

  /**
   * Handle settings toggle changes
   */
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

  /**
   * Handle conversation selection
   */
  const handleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) 
        ? prev.filter(x => x !== id)
        : [...prev, id]
    )
  }

  /**
   * Select all / deselect all
   */
  const handleToggleAll = () => {
    if (selectedIds.length === conversationList.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(conversationList.map(c => c.id))
    }
  }

  /**
   * Open options page
   */
  const openOptions = () => {
    chrome.runtime.openOptionsPage()
  }

  /**
   * Switch to bulk mode and fetch conversations
   */
  const switchToBulk = () => {
    setTabMode('bulk')
    if (conversationList.length === 0) {
      fetchConversationList()
    }
  }

  /**
   * Estimate conversation file size in KB for Live Preview
   */
  const estimateSize = (conv: Conversation) => {
    try {
      const exportOptions = {
        format: 'markdown' as ExportFormat,
        includeMetadata: settings?.includeMetadata ?? true,
        includeCodeBlocks: settings?.includeCodeBlocks ?? true,
        includeImages: settings?.includeImages ?? true,
        exportArtifacts: settings?.exportArtifacts ?? true,
        includeUploadedFiles: settings?.includeUploadedFiles ?? true
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
  const allSelected = conversationList.length > 0 && selectedIds.length === conversationList.length

  return (
    <div className="popup-container">
      {/* Header */}
      <div className="popup-header">
        <div className="flex-col gap-1">
          <h1>AI Chat Exporter</h1>
          <div><GithubChip /></div>
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
        {/* Tabs */}
        <div className="tabs">
          <button 
            type="button"
            className={`tab ${tabMode === 'current' ? 'active' : ''}`} 
            onClick={() => setTabMode('current')}
          >
            {T('Current Chat')}
          </button>
          <button 
            type="button"
            className={`tab ${tabMode === 'bulk' ? 'active' : ''}`}
            onClick={switchToBulk}
          >
            {T('Bulk Export')}
          </button>
        </div>

        {/* Current Tab */}
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
                <div style={{ background: 'var(--primary-light)', padding: '12px', borderRadius: '50%' }}>
                  <span className="spinner" style={{ borderTopColor: 'var(--primary)', width: '22px', height: '22px' }}></span>
                </div>
                <div className="flex-col gap-1 items-center">
                  <p style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>{T('Detecting...')}</p>
                  <p className="text-xs text-muted" style={{ textAlign: 'center' }}>{T('Extracting conversation content')}</p>
                </div>
              </div>
            ) : (
              <>
                {/* Platform Badge + Conversation Info Card */}
                <div className="conversation-info">
                  <div className="conversation-info-header">
                    <Pill 
                      label={platformLabel || ''} 
                      platform={platform} 
                      icon={<AiIcon />} 
                    />
                  </div>
                  <h2>{conversation.title || T('Untitled Conversation')}</h2>
                  <div className="preview-summary">
                    <span>{t('{0} messages', locale, conversation.messages.length)} · {estimateSize(conversation)}</span>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => {
                        chrome.tabs.create({
                          url: chrome.runtime.getURL('tabs/preview.html') + `?id=${conversation.id}`
                        })
                      }}
                      title={T('Live Preview ↗')}
                    >
                      {T('Live Preview ↗')}
                    </button>
                  </div>
                </div>

                {/* Primary Row Layout Above Fold */}
                <div className="flex-col gap-2">
                  <span className="section-label">{T('Quick Export')}</span>
                  <FormatSelector value={format} onChange={setFormat} disabled={loading} />
                </div>

                {/* Status Messages */}
                {error && <div className="message error" role="alert">{error}</div>}
                {success && <div className="message success" role="alert">{success}</div>}

                <div className="mt-1">
                  <ExportButton
                    onClick={handleExport}
                    disabled={!conversation}
                    loading={loading}
                    format={format}
                    isSuccess={!!success}
                  />
                </div>

                {/* Collapsible Advanced Settings (Under Fold) */}
                <div className="flex-col">
                  <button 
                    type="button"
                    className="options-toggle-btn"
                    onClick={() => setOptionsOpen(!optionsOpen)}
                    aria-expanded={optionsOpen}
                  >
                    <span>{T('Advanced Export Options')}</span>
                    <ChevronIcon direction={optionsOpen ? 'up' : 'down'} />
                  </button>

                  <div className={`options-panel-container ${optionsOpen ? 'open' : ''}`}>
                    <div className="flex-col gap-3 mt-2 pb-2">
                      <FilenameEditor
                        value={settings?.filenamePattern || '{date}-{title}'}
                        onChange={(pattern) => {
                          if (settings) {
                            handleOptionChange('filenamePattern', pattern)
                          }
                        }}
                        conversation={conversation}
                        disabled={loading}
                      />

                      <Section title={T('Export Content')}>
                        <Toggle
                          label={T('Include Metadata')}
                          description={T('Add date, title, and platform at the top of exports')}
                          checked={settings?.includeMetadata ?? true}
                          onChange={(val) => handleOptionChange('includeMetadata', val)}
                          disabled={loading}
                        />
                        <Toggle
                          label={T('Include Code Blocks')}
                          description={T('Export code blocks in messages')}
                          checked={settings?.includeCodeBlocks ?? true}
                          onChange={(val) => handleOptionChange('includeCodeBlocks', val)}
                          disabled={loading}
                        />
                        <Toggle
                          label={T('Include Images')}
                          description={T('Export images embedded in conversations')}
                          checked={settings?.includeImages ?? true}
                          onChange={(val) => handleOptionChange('includeImages', val)}
                          disabled={loading}
                        />
                        <Toggle
                          label={T('Include Uploaded Files')}
                          description={T('Preserve references to files you uploaded to chat')}
                          checked={settings?.includeUploadedFiles ?? true}
                          onChange={(val) => handleOptionChange('includeUploadedFiles', val)}
                          disabled={loading}
                        />
                      </Section>

                      <Section title={T('Structure')}>
                        <Toggle
                          label={T('Export Artifacts')}
                          description={T('Isolate code artifacts and documents')}
                          checked={settings?.exportArtifacts ?? true}
                          onChange={(val) => handleOptionChange('exportArtifacts', val)}
                          disabled={loading}
                        />
                      </Section>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Bulk Tab */}
        {tabMode === 'bulk' && (
          <div className="tab-content" style={{ gap: '10px' }}>
            {/* Platform Badge + Refresh */}
            <div className="flex justify-between items-center">
              <Pill 
                label={platformLabel || T('Unknown')} 
                platform={platform || 'unknown'} 
                icon={<AiIcon />} 
              />
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
            
            {/* Conversation count */}
            <span className="text-xs text-muted" style={{ marginTop: '-4px' }}>
              {bulkLoading ? T('Loading conversations...') : `${conversationList.length} ${T('conversations found')}`}
            </span>

            {/* Bulk progress bar */}
            {bulkProgress.status !== 'idle' && bulkProgress.status !== 'done' && (
              <div className="flex-col gap-1">
                <div className="flex justify-between text-xs font-medium">
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '280px' }}>
                    {bulkProgress.status === 'fetching' ? T('Fetching...') : `${T('Exporting:')}${bulkProgress.current}`}
                  </span>
                  <span>{Math.round((bulkProgress.completed / bulkProgress.total) * 100)}%</span>
                </div>
                <div className="progress-bg">
                  <div 
                    className="progress-fill" 
                    style={{ width: `${(bulkProgress.completed / bulkProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* Select All Checkbox */}
            {conversationList.length > 0 && (
              <label className="checkbox-wrapper p-2 border-b" style={{ paddingBottom: '6px' }}>
                <input 
                  type="checkbox" 
                  className="checkbox" 
                  checked={allSelected} 
                  onChange={handleToggleAll} 
                  aria-label="Select all conversations"
                />
                <span className="text-xs font-bold text-secondary">{T('Select All / Deselect')}</span>
              </label>
            )}

            {/* Conversation List */}
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

            {/* Selected count + Format Selector */}
            <div className="flex justify-between items-center mt-1">
              <span className="text-xs font-bold text-secondary">{selectedIds.length} {T('selected')}</span>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted font-medium">{T('Format:')}</span>
                <select 
                  className="select"
                  value={format} 
                  onChange={e => setFormat(e.target.value as ExportFormat)}
                  aria-label="Select format for bulk export"
                >
                  <option value="markdown">Markdown</option>
                  <option value="pdf">PDF</option>
                </select>
              </div>
            </div>

            {/* Collapsible Advanced Export Options (Bulk) */}
            <div className="flex-col">
              <button 
                type="button"
                className="options-toggle-btn"
                onClick={() => setBulkOptionsOpen(!bulkOptionsOpen)}
                aria-expanded={bulkOptionsOpen}
              >
                <span>{T('Advanced Export Options')}</span>
                <ChevronIcon direction={bulkOptionsOpen ? 'up' : 'down'} />
              </button>

              <div className={`options-panel-container ${bulkOptionsOpen ? 'open' : ''}`}>
                <div className="flex-col gap-3 mt-2 pb-2">
                  <FilenameEditor
                    value={settings?.filenamePattern || '{date}-{title}'}
                    onChange={(pattern) => {
                      if (settings) {
                        handleOptionChange('filenamePattern', pattern)
                      }
                    }}
                    conversation={conversation}
                    disabled={loading}
                  />

                  <Section title={T('Export Content')}>
                    <Toggle
                      label={T('Include Metadata')}
                      description={T('Add date, title, and platform at the top of exports')}
                      checked={settings?.includeMetadata ?? true}
                      onChange={(val) => handleOptionChange('includeMetadata', val)}
                      disabled={loading}
                    />
                    <Toggle
                      label={T('Include Code Blocks')}
                      description={T('Export code blocks in messages')}
                      checked={settings?.includeCodeBlocks ?? true}
                      onChange={(val) => handleOptionChange('includeCodeBlocks', val)}
                      disabled={loading}
                    />
                    <Toggle
                      label={T('Include Images')}
                      description={T('Export images embedded in conversations')}
                      checked={settings?.includeImages ?? true}
                      onChange={(val) => handleOptionChange('includeImages', val)}
                      disabled={loading}
                    />
                    <Toggle
                      label={T('Include Uploaded Files')}
                      description={T('Preserve references to files you uploaded to chat')}
                      checked={settings?.includeUploadedFiles ?? true}
                      onChange={(val) => handleOptionChange('includeUploadedFiles', val)}
                      disabled={loading}
                    />
                  </Section>

                  <Section title={T('Structure')}>
                    <Toggle
                      label={T('Export Artifacts')}
                      description={T('Isolate code artifacts and documents')}
                      checked={settings?.exportArtifacts ?? true}
                      onChange={(val) => handleOptionChange('exportArtifacts', val)}
                      disabled={loading}
                    />
                  </Section>
                </div>
              </div>
            </div>

            {/* Status Messages */}
            {error && <div className="message error" role="alert">{error}</div>}
            {success && <div className="message success" role="alert">{success}</div>}

            {/* Export Button */}
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
