/**
 * Preview Page Component
 * Polished document preview with rendered chat bubbles and raw markdown view
 */

import { useState, useEffect } from 'react'
import '../styles/popup.css'
import '../styles/print.css'
import type { Conversation, ChatMessage, ExtensionSettings } from '../lib/types'
import { DEFAULT_SETTINGS, mergeExtensionSettings } from '../lib/types'
import { conversationToMarkdown } from '../lib/export-markdown'
import { formatHtmlContent, generateArtifactsHtml, getAssistantDisplayName, platformDisplayName } from '../lib/export-pdf'
import { embedInlineImageAttachments, isInlineImageAttachment, removeInlineMarkdownImages } from '../lib/inline-media'
import { renderableMessageReferences } from '../lib/message-references'
import { generateFilename, sanitizeFilename } from '../lib/filename'
import { buildDownloadFilename } from '../lib/download-path'
import { downloadMarkdownFile, finalizeExport } from '../lib/export-download'
import { analyzeConversationIntegrity, conversationIntegrityError, isConversationExportable, isTranscriptVerified } from '../lib/conversation-integrity'
import { t, type Locale } from '../lib/i18n'
import { useFullPageScroll } from '../lib/use-full-page-scroll'
import { useThemeSync } from '../lib/use-theme-sync'
import { DownloadIcon, SunIcon, MoonIcon } from '../components/icons'

type PreviewMode = 'rendered' | 'markdown'

/**
 * Render a single message as a chat bubble
 */
function MessageBubble({
  msg,
  assistantLabel,
  showMessageTimestamps,
  includeImages,
  referenceExportMode,
  locale
}: {
  msg: ChatMessage
  assistantLabel: string
  showMessageTimestamps: boolean
  includeImages: boolean
  referenceExportMode: ExtensionSettings['referenceExportMode']
  locale: Locale
}) {
  const isUser = msg.role === 'user'
  const isSystem = msg.role === 'system'
  const inlineImages = embedInlineImageAttachments(msg.content, msg.attachments)
  const content = includeImages ? inlineImages.content : removeInlineMarkdownImages(inlineImages.content)
  const renderedContent = formatHtmlContent(content)
  const hasEmbeddedCodeBlocks = /```[\s\S]*?```/.test(content)
  const references = renderableMessageReferences(msg.references, referenceExportMode)
  const timestamp = msg.timestamp ? new Date(msg.timestamp) : null
  const hasTimestamp = Boolean(timestamp && !Number.isNaN(timestamp.getTime()) && showMessageTimestamps)

  return (
    <div className={`chat-bubble ${isUser ? 'user' : isSystem ? 'system' : 'ai'}`}>
      <div className="message-meta">
        <span className="role-label">
          {msg.authorName || (isUser ? t('User', locale) : isSystem ? t('System', locale) : assistantLabel)}
        </span>
        {hasTimestamp && timestamp && (
          <>
            <span className="meta-separator" aria-hidden="true">·</span>
            <time className="timestamp" dateTime={timestamp.toISOString()}>
              {new Intl.DateTimeFormat(locale, {
                year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
              }).format(timestamp)}
            </time>
          </>
        )}
      </div>

      {/* Render the same safe Markdown structure used by PDF export. */}
      {renderedContent && (
        <div
          className="message-content"
          dangerouslySetInnerHTML={{ __html: renderedContent }}
        />
      )}

      {references.length > 0 && (
        <div className="attachments references">
          <strong>{t('Sources', locale)}:</strong>
          <ul>
            {references.map((reference, index) => (
              <li key={`${reference.title}-${index}`}>
                {reference.url
                  ? <a href={reference.url} target="_blank" rel="noreferrer">{reference.title}</a>
                  : reference.title}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Code blocks */}
      {!hasEmbeddedCodeBlocks && msg.codeBlocks?.map((block, i) => (
        <pre key={`code-${i}`}>
          <code>{block.code}</code>
        </pre>
      ))}

      {/* Image attachments */}
      {msg.attachments
        ?.filter(attachment => attachment.type === 'image' && includeImages && !isInlineImageAttachment(attachment, inlineImages.usedImageUrls))
        .map((att, i) => (
          <figure className="image" key={`img-${i}`}>
            <img src={att.url} alt={att.name || 'Image'} />
          </figure>
        ))}
    </div>
  )
}

/**
 * Preview page for exported conversations with polished document layout
 */
export default function Preview() {
  useFullPageScroll()

  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [mode, setMode] = useState<PreviewMode>('rendered')
  const [markdownContent, setMarkdownContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [locale, setLocale] = useState<Locale>('en')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS)
  const [integrityWarning, setIntegrityWarning] = useState<string | null>(null)

  useThemeSync(theme)

  const T = (key: string) => t(key, locale)

  const artifactHtml = conversation && settings.exportArtifacts
    ? generateArtifactsHtml(conversation, {
        format: 'markdown',
        includeMetadata: settings.includeMetadata,
        includeCodeBlocks: settings.includeCodeBlocks,
        includeImages: settings.includeImages,
        exportArtifacts: settings.exportArtifacts,
        includeUploadedFiles: settings.includeUploadedFiles,
        referenceExportMode: settings.referenceExportMode,
        filenamePattern: settings.filenamePattern,
        assistantDisplayName: settings.assistantDisplayName,
        showMessageTimestamps: settings.showMessageTimestamps,
        locale
      })
    : ''

  // Load settings (theme + locale) from storage
  useEffect(() => {
    chrome.storage.local.get('settings').then(result => {
      const s = mergeExtensionSettings(result.settings)
      setSettings(s)
      if (s.theme) setTheme(s.theme)
      if (s.locale) setLocale(s.locale)
    }).catch(() => {})
  }, [])

  // Load conversation from URL params or storage
  useEffect(() => {
    loadConversation()
  }, [])

  // Regenerate markdown content when conversation changes
  useEffect(() => {
    if (conversation) {
      generateMarkdown()
    }
  }, [conversation, settings])

  /**
   * Load conversation data
   */
  const loadConversation = async () => {
    try {
      const params = new URLSearchParams(window.location.search)
      const conversationId = params.get('id')

      if (conversationId) {
        const result = await chrome.storage.local.get(`conversation-${conversationId}`)
        const conv = result[`conversation-${conversationId}`]
        if (conv) {
          setConversation(conv)
          const integrity = analyzeConversationIntegrity(conv)
          setIntegrityWarning(isConversationExportable(conv) ? null : conversationIntegrityError(integrity))
          setLoading(false)
          return
        }
        // A requested id is authoritative. Never substitute another stored
        // conversation when the requested snapshot is missing.
        setError(t('Conversation {0} is unavailable for preview', locale, conversationId))
        setLoading(false)
        return
      }

      // Fallback: try to get active conversation
      const allItems = await chrome.storage.local.get(null) as unknown as Record<string, unknown>
      const conversationKey = Object.keys(allItems).find(k => k.startsWith('conversation-'))

      if (conversationKey) {
        const conv = allItems[conversationKey] as Conversation
        setConversation(conv)
        const integrity = analyzeConversationIntegrity(conv)
        setIntegrityWarning(isConversationExportable(conv) ? null : conversationIntegrityError(integrity))
      } else {
        setError(t('No conversation to preview', locale))
      }
    } catch (_err) {
      setError(t('Failed to load conversation', locale))
    } finally {
      setLoading(false)
    }
  }

  /**
   * Generate markdown content (used by both modes for copy/download)
   */
  const generateMarkdown = () => {
    if (!conversation) return
    setMarkdownContent(
      conversationToMarkdown(conversation, {
        format: 'markdown',
        includeMetadata: settings.includeMetadata,
        includeCodeBlocks: settings.includeCodeBlocks,
        includeImages: settings.includeImages,
        exportArtifacts: settings.exportArtifacts,
        includeUploadedFiles: settings.includeUploadedFiles,
        referenceExportMode: settings.referenceExportMode,
        filenamePattern: settings.filenamePattern,
        assistantDisplayName: settings.assistantDisplayName,
        showMessageTimestamps: settings.showMessageTimestamps,
        locale
      })
    )
  }

  /**
   * Toggle theme and persist it like popup/options do
   */
  const toggleTheme = async () => {
    const next: ExtensionSettings['theme'] = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    const updated = { ...settings, theme: next }
    setSettings(updated)
    try {
      await chrome.storage.local.set({ settings: updated })
    } catch {}
  }

  /**
   * Copy markdown content to clipboard
   */
  const copyToClipboard = async () => {
    if (!conversation || !isConversationExportable(conversation)) {
      setFeedback(conversation ? conversationIntegrityError(analyzeConversationIntegrity(conversation)) : T('Conversation is unavailable'))
      return
    }
    try {
      await navigator.clipboard.writeText(markdownContent)
      setFeedback('Copied!')
      setTimeout(() => setFeedback(null), 2000)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = markdownContent
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setFeedback('Copied!')
      setTimeout(() => setFeedback(null), 2000)
    }
  }

  /**
   * Download markdown content as file
   */
  const downloadContent = async () => {
    if (!conversation || !isConversationExportable(conversation)) {
      setFeedback(conversation ? conversationIntegrityError(analyzeConversationIntegrity(conversation)) : T('Conversation is unavailable'))
      return
    }
    try {
      const baseFilename = settings.filenamePattern
        ? generateFilename(settings.filenamePattern, conversation)
        : sanitizeFilename(conversation.title || 'conversation') || 'conversation'
      const downloadFilename = buildDownloadFilename(
        baseFilename,
        conversation.platform,
        '.md',
        settings.downloadFolder,
        settings.customFolderName
      )
      await downloadMarkdownFile(markdownContent, {
        filename: downloadFilename,
        saveAs: settings.askForSaveLocation ?? false,
      })
      await finalizeExport(conversation, 'markdown', downloadFilename)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : T('Download failed'))
      return
    }
    setFeedback('Downloaded!')
    setTimeout(() => setFeedback(null), 2000)
  }

  if (loading) {
    return (
      <div className="preview-container preview-status">
        <div className="empty-state">
          <span className="spinner"></span>
          <p className="preview-status-text">{T('Loading preview...')}</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="preview-container preview-status">
        <div className="empty-state">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <p className="preview-status-text error">{error}</p>
        </div>
      </div>
    )
  }

  const platformName = conversation ? platformDisplayName(conversation.platform) : 'Unknown'
  const assistantLabel = conversation
    ? getAssistantDisplayName(conversation, settings)
    : platformName

  const createdDate = conversation?.createdAt
    ? new Date(conversation.createdAt).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <div className={`preview-container pdf-style-${settings.pdfStyle || 'minimal'}`}>
      {/* Header with title, metadata, and action buttons */}
      <div className="preview-header">
        <div className="preview-header-title">
          <h1>
            {conversation?.title || T('Preview')}
          </h1>
          <div className="preview-header-meta">
            <span>{createdDate}</span>
            <span>&bull;</span>
            <span className="preview-header-platform">{platformName}</span>
            <span>&bull;</span>
            <span>{t('{0} messages', locale, conversation?.messages.length || 0)}</span>
            {isTranscriptVerified(conversation) === true && (
              <>
                <span>&bull;</span>
                <span>{T('Verified source')}</span>
              </>
            )}
          </div>
        </div>
        <div className="preview-actions">
          <button
            className="btn btn-icon"
            onClick={toggleTheme}
            title={T('Toggle Theme')}
            aria-label={T('Toggle Theme')}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
          <button
            className="btn btn-outline btn-header"
            onClick={copyToClipboard}
          >
            {T('Copy')}
          </button>
          <button
            className="btn btn-primary btn-header"
            onClick={downloadContent}
          >
            <DownloadIcon /> {T('Download')}
          </button>
        </div>
      </div>

      {/* Mode tab bar */}
      <div className="preview-tab-bar">
        <div className="tabs">
          <button
            className={`tab ${mode === 'rendered' ? 'active' : ''}`}
            onClick={() => setMode('rendered')}
          >
            {T('Rendered')}
          </button>
          <button
            className={`tab ${mode === 'markdown' ? 'active' : ''}`}
            onClick={() => setMode('markdown')}
          >
            {T('Markdown')}
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="preview-body">
        {integrityWarning && (
          <div className="message error preview-integrity-warning" role="alert">
            {integrityWarning}
          </div>
        )}
        {mode === 'rendered' && conversation && (
          <div className="preview-message-list">
            {conversation.messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                assistantLabel={assistantLabel}
                showMessageTimestamps={settings.showMessageTimestamps}
                includeImages={settings.includeImages}
                referenceExportMode={settings.referenceExportMode}
                locale={locale}
              />
            ))}
            {artifactHtml && (
              <div
                className="preview-artifacts"
                dangerouslySetInnerHTML={{ __html: artifactHtml }}
              />
            )}
          </div>
        )}

        {mode === 'markdown' && (
          <div className="markdown-panel">
            {markdownContent}
          </div>
        )}
      </div>

      {feedback && (
        <div className="save-notification" role="status" aria-live="polite">
          {T(feedback)}
        </div>
      )}
    </div>
  )
}
