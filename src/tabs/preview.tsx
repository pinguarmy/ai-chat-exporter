import { ExportDiagnostics } from '../components/ExportDiagnostics'
import { requestSettingsPatch } from '../lib/settings-store'
import { transcriptMetadata } from '../lib/transcript-metadata'
/**
 * Preview Page Component
 * Polished document preview with rendered chat bubbles and raw markdown view
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import '../styles/popup.css'
import '../styles/print.css'
import type { Conversation, ChatMessage, ExtensionSettings } from '../lib/types'
import { DEFAULT_SETTINGS, mergeExtensionSettings } from '../lib/types'
import { conversationToMarkdown } from '../lib/export-markdown'
import { generateArtifactsHtml, getAssistantDisplayName, platformDisplayName } from '../lib/export-html'
import { preparePreviewMessage, shouldShowHeaderMetadata } from '../lib/preview-message'
import { exportConversationFile } from '../lib/export-download'
import { buildExportOptions } from '../lib/export-options'
import { analyzeConversationIntegrity, conversationIntegrityError, isConversationExportable, isTranscriptVerified } from '../lib/conversation-integrity'
import { t, type Locale } from '../lib/i18n'
import { useFullPageScroll } from '../lib/use-full-page-scroll'
import { useThemeSync } from '../lib/use-theme-sync'
import { DownloadIcon, SunIcon, MoonIcon } from '../components/icons'
import type { PageSnapshot } from '../lib/types'
import { isPageSnapshot, snapshotNotice, prepareSnapshotForOutput, buildSnapshotExportOptions } from '../lib/page-snapshot'
import { loadPageSnapshotPreview, deletePageSnapshotPreview } from '../lib/page-snapshot-cache'
import { downloadPageSnapshot } from '../lib/snapshot-download'

type PreviewMode = 'rendered' | 'markdown'

/**
 * Render a single message as a chat bubble
 */
function MessageBubble({
  msg,
  assistantLabel,
  includeMetadata,
  includeCodeBlocks,
  includeImages,
  includeUploadedFiles,
  showMessageTimestamps,
  referenceExportMode,
  snapshotOnly = false,
  locale
}: {
  msg: ChatMessage
  assistantLabel: string
  includeMetadata: boolean
  includeCodeBlocks: boolean
  includeImages: boolean
  includeUploadedFiles?: boolean
  showMessageTimestamps: boolean
  referenceExportMode: ExtensionSettings['referenceExportMode']
  snapshotOnly?: boolean
  locale: Locale
}) {
  const isUser = msg.role === 'user'
  const isSystem = msg.role === 'system'
  const prepared = preparePreviewMessage(msg, {
    includeMetadata,
    includeCodeBlocks,
    includeImages,
    includeUploadedFiles,
    showMessageTimestamps,
    referenceExportMode,
    locale,
  })
  const renderedContent = prepared.contentHtml
  const references = prepared.references
  const timestamp = prepared.timestamp
  const hasTimestamp = prepared.hasTimestamp
  const otherAttachments = prepared.otherAttachments

  return (
    <div className={`chat-bubble ${isUser ? 'user' : isSystem ? 'system' : 'ai'}`}>
      <div className="message-meta">
        <span className="role-label">
          {msg.authorName || (isUser ? t('User', locale) : isSystem ? t('System', locale) : msg.modelName || assistantLabel)}
        </span>
        {hasTimestamp && timestamp && (
          <>
            <span className="meta-separator" aria-hidden="true">·</span>
            <time className="timestamp" dateTime={timestamp.toISOString()}>
              {timestamp.toISOString()}
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
      {prepared.shouldRenderStandaloneCodeBlocks && prepared.codeBlocks.map((block, i) => (
        <pre key={`code-${i}`} {...(block.language ? { 'data-language': block.language } : {})}>
          <code>{block.code}</code>
        </pre>
      ))}

      {snapshotOnly && msg.attachments?.filter(att => att.type === 'image' && !(att.uploaded && includeUploadedFiles === false)).map((att, i) => (
        <p className="attachments" key={`snapshot-label-${i}`}>{att.name || t('Image', locale)} · {t('External image content may be unavailable.', locale)}</p>
      ))}
      {prepared.imageAttachments.filter(att => !!att.url).map((att, i) => (
        <figure className="image" key={`img-${i}`}>
          <img src={att.url} alt={att.name || 'Image'} />
        </figure>
      ))}

      {/* Other (non-image) attachments */}
      {otherAttachments.length > 0 && (
        <div className="attachments">
          <strong>{t('Attachments', locale)}:</strong>
          <ul>
            {otherAttachments.map((att, i) => (
              <li key={`att-${i}`}>
                {att.safeUrl ? (
                  <a href={att.safeUrl} target="_blank" rel="noreferrer">
                    {att.name}
                  </a>
                ) : (
                  att.name
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * Preview page for exported conversations with polished document layout
 */
export default function Preview() {
  useFullPageScroll()

  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [snapshot, setSnapshot] = useState<PageSnapshot | null>(null)
  const [downloading, setDownloading] = useState(false)
  const downloadController = useRef<AbortController | null>(null)
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

  // prepareSnapshotForOutput can reject an empty filtered result. Rendering
  // must not throw: keep the raw capture in state (it can be reconfigured
  // externally), surface the output error, and disable copy/download.
  const preparedResult = useMemo(() => {
    if (!snapshot) return { prepared: null as PageSnapshot | null, error: null as string | null }
    try {
      return { prepared: prepareSnapshotForOutput(snapshot, settings), error: null }
    } catch (err) {
      return { prepared: null, error: err instanceof Error ? t(err.message, locale) : t('Snapshot output could not be prepared under the current settings.', locale) }
    }
  }, [snapshot, settings, locale])
  const prepared = preparedResult.prepared
  const outputError = snapshot ? preparedResult.error : null
  const displayed = snapshot ? (prepared?.conversation || null) : conversation
  const pdfRequested = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('format') === 'pdf' && !!params.get('snapshot')
  }, [])
  const artifactHtml = displayed && settings.exportArtifacts
    ? generateArtifactsHtml(displayed, snapshot ? buildSnapshotExportOptions('markdown', settings, snapshot.capturedAt) : buildExportOptions('markdown', settings))
    : ''

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const params = new URLSearchParams(window.location.search)
        const captureId = params.get('snapshot')
        if (captureId !== null) {
          if (!captureId) throw new Error('Page snapshot is unavailable for preview')
          const cached = await loadPageSnapshotPreview(captureId)
          if (!cached || !isPageSnapshot(cached.snapshot) || cached.snapshot.captureId !== captureId) throw new Error('Page snapshot is unavailable for preview')
          const stored = await chrome.storage.local.get('settings')
          if (!active) return
          const next = mergeExtensionSettings({ ...stored.settings, ...cached.settings })
          setSettings(next); setTheme(next.theme); setLocale(next.locale)
          setSnapshot(cached.snapshot)
          return
        }
        const id = params.get('id')
        if (!id) throw new Error('No conversation to preview')
        const result = await chrome.storage.local.get(['settings', `conversation-${id}`])
        if (!active) return
        const conv = result[`conversation-${id}`] as Conversation | undefined
        if (!conv) throw new Error(`Conversation ${id} is unavailable for preview`)
        const next = mergeExtensionSettings({ ...result.settings, ...conv.previewSettings })
        setSettings(next); setTheme(next.theme); setLocale(next.locale)
        setConversation(conv)
        const integrity = analyzeConversationIntegrity(conv)
        setIntegrityWarning(isConversationExportable(conv) ? null : conversationIntegrityError(integrity))
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load conversation')
      } finally { if (active) setLoading(false) }
    }
    void load()
    return () => { active = false; downloadController.current?.abort() }
  }, [])

  useEffect(() => {
    if (displayed) setMarkdownContent(conversationToMarkdown(displayed, snapshot
      ? buildSnapshotExportOptions('markdown', settings, snapshot.capturedAt)
      : buildExportOptions('markdown', settings)))
    else setMarkdownContent('')
  }, [displayed, snapshot, settings])

  /**
   * Toggle theme and persist it like popup/options do
   */
  const toggleTheme = async () => {
    const next: ExtensionSettings['theme'] = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    const updated = { ...settings, theme: next }
    setSettings(updated)
    try {
      await requestSettingsPatch({ theme: next })
    } catch {}
  }

  /**
   * Copy markdown content to clipboard
   */
  const copyToClipboard = async () => {
    if (outputError || !displayed || (!snapshot && !isConversationExportable(conversation))) {
      setFeedback(outputError || (conversation ? conversationIntegrityError(analyzeConversationIntegrity(conversation)) : T('Conversation is unavailable')))
      return
    }
    // Always build the copy from the current prepared conversation; the cached
    // markdown panel content can lag behind a settings change.
    const freshMarkdown = conversationToMarkdown(displayed, snapshot ? buildSnapshotExportOptions('markdown', settings, snapshot.capturedAt) : buildExportOptions('markdown', settings))
    try {
      await navigator.clipboard.writeText(freshMarkdown)
      setFeedback('Copied!')
      setTimeout(() => setFeedback(null), 2000)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = freshMarkdown
      document.body.appendChild(textarea)
      textarea.select()
      // execCommand is deprecated and may be absent entirely; treat a missing
      // or throwing implementation as a plain copy failure.
      let copied = false
      if (typeof document.execCommand === 'function') {
        try { copied = document.execCommand('copy') } catch { copied = false }
      }
      document.body.removeChild(textarea)
      if (!copied) { setFeedback('Copy failed'); return }
      setFeedback('Copied!')
      setTimeout(() => setFeedback(null), 2000)
    }
  }

  /**
   * Download markdown content as file
   */
  const downloadContent = async (format: 'markdown' | 'pdf' = 'markdown') => {
    if (downloading) return
    if (outputError || !displayed || (!snapshot && !isConversationExportable(conversation))) {
      setFeedback(outputError || (conversation ? conversationIntegrityError(analyzeConversationIntegrity(conversation)) : T('Conversation is unavailable')))
      return
    }
    const controller = new AbortController()
    downloadController.current = controller
    setDownloading(true); setFeedback(null)
    try {
      if (snapshot) await downloadPageSnapshot(snapshot, format, settings, { signal: controller.signal })
      else await exportConversationFile(conversation!, buildExportOptions('markdown', settings), settings, { markdown: markdownContent })
      setFeedback('Downloaded!')
    } catch (err) {
      setFeedback(controller.signal.aborted ? 'Download cancelled' : err instanceof Error ? err.message : T('Download failed'))
    } finally { downloadController.current = null; setDownloading(false) }
  }

  const deleteSnapshot = async () => {
    if (!snapshot || downloading) return
    try {
      await deletePageSnapshotPreview(snapshot.captureId)
      setSnapshot(null); setMarkdownContent(''); setError(T('Page snapshot is unavailable for preview'))
    } catch (err) { setFeedback(err instanceof Error ? err.message : 'Could not delete temporary snapshot') }
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

  const platformName = displayed ? platformDisplayName(displayed.platform) : T('Unknown')
  // Snapshot bubbles use the same redacted export options as the download so
  // a custom assistant label never leaks raw text in a share preview.
  const assistantLabel = displayed
    ? getAssistantDisplayName(displayed, snapshot
      ? buildSnapshotExportOptions('markdown', settings, snapshot.capturedAt)
      : buildExportOptions('markdown', settings))
    : platformName

  const createdDate = snapshot ? new Date(snapshot.capturedAt).toISOString() : conversation ? transcriptMetadata(conversation).provider_created_at || T('Date unavailable') : T('Date unavailable')

  return (
    <div className={`preview-container pdf-style-${settings.pdfStyle || 'minimal'}`}>
      {!snapshot && <ExportDiagnostics conversation={conversation} T={T} />}
      {/* Header with title, metadata, and action buttons */}
      <div className="preview-header">
        <div className="preview-header-title">
          <h1>
            {displayed?.title || T('Preview')}
          </h1>
          {(snapshot || shouldShowHeaderMetadata({ includeMetadata: settings.includeMetadata })) && (
            <div className="preview-header-meta">
              <span>{createdDate}</span>
              <span>&bull;</span>
              <span className="preview-header-platform">{platformName}</span>
              <span>&bull;</span>
              <span>{t('{0} messages', locale, displayed?.messages.length || 0)}</span>
              {!snapshot && isTranscriptVerified(conversation) === true && (
                <>
                  <span>&bull;</span>
                  <span>{T('Verified source')}</span>
                </>
              )}
            </div>
          )}
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
            disabled={downloading || !!outputError}
          >
            {T('Copy')}
          </button>
          <button
            className={`btn ${snapshot && pdfRequested ? 'btn-outline' : 'btn-primary'} btn-header`}
            onClick={() => void downloadContent('markdown')}
            disabled={downloading || !!outputError}
          >
            <DownloadIcon /> {snapshot ? T('Download Markdown') : T('Download')}
          </button>
          {snapshot && <>
            <button className={`btn ${pdfRequested ? 'btn-primary' : 'btn-outline'} btn-header`} autoFocus={pdfRequested} disabled={downloading || !!outputError} onClick={() => void downloadContent('pdf')}>{T('Download PDF')}</button>
            {downloading && <button className="btn btn-outline btn-header" onClick={() => downloadController.current?.abort()}>{T('Cancel download')}</button>}
            <button className="btn btn-outline btn-header" disabled={downloading} onClick={() => void deleteSnapshot()}>{T('Delete temporary snapshot')}</button>
          </>}
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
        {snapshot && (
          <div className="message preview-snapshot-notice" role="note">
            {/* The prepared snapshot carries the safe-share redaction count;
                the raw capture notice must not be used for share previews. */}
            {snapshotNotice(prepared ?? snapshot, locale)}
            {` ${T('Keep this page open for PDF or Save As exports. Use the full workspace for long runs.')}`}
          </div>
        )}
        {snapshot && pdfRequested && !outputError && (
          <div className="message preview-pdf-prompt" role="status">
            {T('PDF export does not start automatically. Choose Download PDF below when you are ready.')}
          </div>
        )}
        {outputError && (
          <div className="message error preview-output-error" role="alert">
            {outputError}
            {` ${T('Copy and download are disabled. Adjust the output settings and reopen the preview to export this capture.')}`}
          </div>
        )}
        {integrityWarning && (
          <div className="message error preview-integrity-warning" role="alert">
            {integrityWarning}
          </div>
        )}
        {mode === 'rendered' && displayed && (
          <div className="preview-message-list">
            {displayed.messages.map((msg, index) => (
              <MessageBubble
                key={`${index}-${msg.id}`}
                msg={msg}
                assistantLabel={assistantLabel}
                includeMetadata={settings.includeMetadata}
                includeCodeBlocks={settings.includeCodeBlocks}
                includeImages={settings.includeImages}
                snapshotOnly={!!snapshot}
                includeUploadedFiles={settings.includeUploadedFiles}
                showMessageTimestamps={settings.showMessageTimestamps}
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
