import type { Conversation, ChatMessage, Attachment, MessageReference, ConversationArtifact, ExportFormat, ExportOptions, ExtensionSettings, PageSnapshot, SnapshotMetadata } from './types'
import { mergeExtensionSettings } from './types'
import { t, type Locale } from './i18n'
import { redactShareText } from './share-redaction'
export type { PageSnapshot, SnapshotMetadata } from './types'

const text = (value: unknown): string => typeof value === 'string' ? value : ''
const optionalText = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value : undefined
const timestamp = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000 ? value : undefined
const safeUrl = (value: unknown): string => {
  const url = text(value).trim()
  try { const parsed = new URL(url); return /^https?:$/.test(parsed.protocol) && !parsed.username && !parsed.password && !/[\s<>"']/.test(url) ? url : '' } catch { return '' }
}

function cleanAttachment(value: Attachment): Attachment | null {
  if (!value || !['image', 'file', 'link'].includes(value.type)) return null
  const name = optionalText(value.name)
  const url = safeUrl(value.url)
  // A missing external asset remains a readable label, never invented bytes.
  if (!name && !url && !optionalText(value.url)) return null
  return { type: value.type, url, name: name || (value.type === 'image' ? 'Image attachment' : 'Attachment'), ...(value.uploaded === true ? { uploaded: true } : {}) }
}

function cleanReference(value: MessageReference): MessageReference | null {
  if (!value || !['file', 'web', 'memory', 'unknown'].includes(value.type)) return null
  const title = optionalText(value.title)
  if (!title) return null
  const url = safeUrl(value.url)
  return { type: value.type, title, ...(url ? { url } : {}), ...(value.private === true || value.type === 'unknown' ? { private: true } : {}), ...(optionalText(value.source) ? { source: value.source } : {}) }
}

function cleanMessage(value: ChatMessage): ChatMessage | null {
  if (!value || !['user', 'assistant'].includes(value.role)) return null
  const attachments = Array.isArray(value.attachments) ? value.attachments.map(cleanAttachment).filter((a): a is Attachment => !!a) : []
  const references = Array.isArray(value.references) ? value.references.map(cleanReference).filter((r): r is MessageReference => !!r) : []
  const codeBlocks = Array.isArray(value.codeBlocks) ? value.codeBlocks.filter(b => b && typeof b.code === 'string' && b.code.trim()).map(b => ({ code: b.code, ...(optionalText(b.language) ? { language: b.language } : {}) })) : []
  const content = text(value.content)
  if (!content.trim() && !attachments.length && !references.length && !codeBlocks.length) return null
  return {
    id: optionalText(value.id) || crypto.randomUUID(), role: value.role as 'user' | 'assistant', content,
    ...(optionalText(value.authorName) ? { authorName: value.authorName } : {}),
    ...(optionalText(value.modelName) ? { modelName: value.modelName } : {}),
    ...(timestamp(value.timestamp) !== undefined ? { timestamp: value.timestamp } : {}),
    ...(attachments.length ? { attachments } : {}), ...(references.length ? { references } : {}),
    ...(codeBlocks.length ? { codeBlocks } : {}),
  }
}

function cleanArtifact(value: ConversationArtifact): ConversationArtifact | null {
  if (!value || !['code', 'document', 'image', 'html'].includes(value.type)) return null
  const title = optionalText(value.title)
  const content = text(value.content)
  const url = safeUrl(value.url)
  if (!content.trim() && !title && !url && !optionalText(value.url)) return null
  return { type: value.type, content, ...(title || optionalText(value.url) ? { title: title || 'External artifact' } : {}), ...(url ? { url } : {}),
    ...(optionalText(value.language) ? { language: value.language } : {}),
    ...(optionalText(value.mimeType) ? { mimeType: value.mimeType } : {}),
    ...(value.uploaded === true ? { uploaded: true } : {}) }
}

export function buildPageSnapshot(conversation: Conversation, generationState: SnapshotMetadata['generationState'] = 'unknown', capturedAt = Date.now(), captureId: string = crypto.randomUUID()): PageSnapshot {
  if (!conversation || !['chatgpt', 'gemini', 'claude', 'deepseek', 'grok'].includes(conversation.platform) || !['generating', 'idle', 'unknown'].includes(generationState) || timestamp(capturedAt) === undefined || !optionalText(captureId)) throw new Error('Invalid page snapshot metadata')
  const messages = Array.isArray(conversation.messages) ? conversation.messages.map(cleanMessage).filter((m): m is ChatMessage => !!m) : []
  if (!messages.length) throw new Error('Page snapshot has no visible user or assistant content')
  const metadata: SnapshotMetadata = { kind: 'page-snapshot', captureId, capturedAt, scope: 'observed-dom', generationState }
  const artifacts = Array.isArray(conversation.artifacts) ? conversation.artifacts.map(cleanArtifact).filter((a): a is ConversationArtifact => !!a) : []
  return { ...metadata, conversation: {
    id: optionalText(conversation.id) || `local-${captureId}`, title: text(conversation.title), url: safeUrl(conversation.url), platform: conversation.platform,
    messages, ...(artifacts.length ? { artifacts } : {}),
    ...(optionalText(conversation.modelName) ? { modelName: conversation.modelName } : {}),
    ...(timestamp(conversation.createdAt) !== undefined ? { createdAt: conversation.createdAt } : {}),
    source: 'dom', sourceCompleteness: 'unverified',
    verification: { provider: conversation.platform, source: 'dom', transcript: { verified: false, method: 'dom-unverified', reasons: ['page_snapshot_only'] }, capturedAt },
    snapshot: metadata,
  } }
}

export function isPageSnapshot(value: unknown): value is PageSnapshot {
  if (!value || typeof value !== 'object') return false
  const item = value as PageSnapshot
  const c = item.conversation
  const platforms = ['chatgpt', 'gemini', 'claude', 'deepseek', 'grok']
  if (item.kind !== 'page-snapshot' || item.scope !== 'observed-dom' || !optionalText(item.captureId) || item.captureId.length > 256 || timestamp(item.capturedAt) === undefined || !['generating', 'idle', 'unknown'].includes(item.generationState) || !c || typeof c !== 'object') return false
  if (!platforms.includes(c.platform) || !c.snapshot || c.snapshot.kind !== item.kind || c.snapshot.captureId !== item.captureId || c.snapshot.capturedAt !== item.capturedAt || c.snapshot.scope !== item.scope || c.snapshot.generationState !== item.generationState) return false
  if (c.source !== 'dom' || c.sourceCompleteness !== 'unverified' || c.verification?.source !== 'dom' || c.verification?.provider !== c.platform || c.verification?.capturedAt !== item.capturedAt || c.verification?.transcript?.verified !== false || c.verification?.transcript?.method !== 'dom-unverified' || !Array.isArray(c.verification?.transcript?.reasons) || !c.verification.transcript.reasons.includes('page_snapshot_only')) return false
  if (typeof c.id !== 'string' || typeof c.title !== 'string' || typeof c.url !== 'string' || !Array.isArray(c.messages) || !c.messages.length) return false
  if (c.rawProviderPayload !== undefined || c.events !== undefined || c.previewSettings !== undefined || c.traceCoverage !== undefined || c.activeBranchId !== undefined || c.source !== 'dom') return false
  if (c.messages.some(m => !m || !['user', 'assistant'].includes(m.role) || typeof m.id !== 'string' || typeof m.content !== 'string' ||
    (m.attachments !== undefined && (!Array.isArray(m.attachments) || m.attachments.some(a => !a || !['image', 'file', 'link'].includes(a.type) || typeof a.url !== 'string'))) ||
    (m.references !== undefined && (!Array.isArray(m.references) || m.references.some(r => !r || typeof r.title !== 'string' || !['file', 'web', 'memory', 'unknown'].includes(r.type)))) ||
    (m.codeBlocks !== undefined && (!Array.isArray(m.codeBlocks) || m.codeBlocks.some(b => !b || typeof b.code !== 'string'))))) return false
  if (item.share !== undefined && (!item.share || !Number.isSafeInteger(item.share.redactionCount) || item.share.redactionCount < 0 || !Array.isArray(item.share.limitations) || item.share.limitations.some(v => typeof v !== 'string'))) return false
  if (JSON.stringify(item.share) !== JSON.stringify(c.snapshot.share)) return false
  return c.messages.some(m => m && ['user', 'assistant'].includes(m.role) && (typeof m.content === 'string' && !!m.content.trim() || Array.isArray(m.attachments) && m.attachments.some(a => a && (optionalText(a.name) || safeUrl(a.url))) || Array.isArray(m.references) && m.references.some(r => r && optionalText(r.title)) || Array.isArray(m.codeBlocks) && m.codeBlocks.some(b => b && optionalText(b.code))))
}

export function snapshotNotice(snapshot: SnapshotMetadata, locale: Locale = 'en'): string {
  const time = new Date(snapshot.capturedAt).toISOString()
  const share = snapshot.share ? ` ${t('Heuristic safe-share: {0} redactions; review for remaining sensitive information.', locale, snapshot.share.redactionCount)}` : ''
  if (locale === 'zh-CN') return `页面快照 · 捕获于 ${time}。仅包含此次捕获时页面已加载、可读取的会话内容，未验证完整历史。未加载消息及外部附件内容可能不包含在内。${snapshot.generationState === 'generating' ? '回答在捕获时仍在生成。' : ''}${snapshot.generationState === 'unknown' ? '捕获时的生成状态未知。' : ''}${share}`
  if (locale === 'zh-TW') return `頁面快照 · 擷取於 ${time}。僅包含此次擷取時頁面已載入、可讀取的對話內容，未驗證完整歷史。未載入訊息及外部附件內容可能不包含在內。${snapshot.generationState === 'generating' ? '回答在擷取時仍在生成。' : ''}${snapshot.generationState === 'unknown' ? '擷取時的生成狀態未知。' : ''}${share}`
  return `${t('Page snapshot · captured at {0}. Includes only conversation content loaded and readable on this page at capture time; complete history has not been verified. Unloaded messages and external attachment contents may be absent.', locale, time)}${snapshot.generationState === 'generating' ? ` ${t('The answer was still generating at capture time.', locale)}` : ''}${snapshot.generationState === 'unknown' ? ` ${t('Generation status at capture time is unknown.', locale)}` : ''}${share}`
}

export function buildSnapshotExportOptions(format: ExportFormat, settings?: Partial<ExtensionSettings>, capturedAt?: number): ExportOptions {
  if (format !== 'markdown' && format !== 'pdf') throw new Error('Unsupported snapshot format')
  const merged = mergeExtensionSettings(settings)
  return { format, includeMetadata: merged.includeMetadata, includeCodeBlocks: merged.includeCodeBlocks,
    includeImages: merged.includeImages, exportArtifacts: merged.exportArtifacts,
    includeUploadedFiles: merged.includeUploadedFiles, safeShare: merged.safeShare,
    referenceExportMode: merged.safeShare ? 'titles' : merged.referenceExportMode,
    pdfStyle: merged.pdfStyle, pdfTextLayer: merged.pdfTextLayer,
    assistantDisplayName: merged.safeShare ? redactOutput(merged.assistantDisplayName).text : merged.assistantDisplayName,
    showMessageTimestamps: merged.showMessageTimestamps,
    locale: merged.locale, exportedAt: capturedAt, archiveBundle: false, includeRawPayload: false, includeToolTrace: false }
}

function redactOutput(value: string): { text: string; replacements: number } {
  const first = redactShareText(value)
  let count = 0
  const cleaned = first.text.replace(/https?:\/\/[^\s)\]>"']+/gi, () => { count++; return '[link omitted]' })
  return { text: cleaned, replacements: first.replacements + count }
}

export function prepareSnapshotForOutput(snapshot: PageSnapshot, settings?: Partial<ExtensionSettings>): PageSnapshot {
  if (!isPageSnapshot(snapshot)) throw new Error('Invalid page snapshot')
  // Rebuild from a whitelist even for deserialized data, never pass raw/events onward.
  const copy = buildPageSnapshot(snapshot.conversation, snapshot.generationState, snapshot.capturedAt, snapshot.captureId)
  if (!settings?.safeShare) {
    if (snapshot.share) {
      const share = { redactionCount: snapshot.share.redactionCount, limitations: ['Heuristic redaction cannot guarantee removal of all sensitive information.'] }
      copy.share = share; copy.conversation.snapshot = { ...copy.conversation.snapshot!, share }
    }
    assertSnapshotOutput(copy, settings); return copy
  }
  let redactionCount = snapshot.share?.redactionCount || 0
  const redact = (value: string) => { const result = redactOutput(value); redactionCount += result.replacements; return result.text }
  const c = copy.conversation
  c.title = redact(c.title).replace(/https?:\/\/[^\s)\]>"']+/gi, '[link omitted]')
  c.url = '' // URLs may encode account or conversation identities, not just recognizable tokens.
  c.id = '[REDACTED]'
  if (c.modelName) c.modelName = redact(c.modelName)
  for (const m of c.messages) {
    m.id = `message-${c.messages.indexOf(m) + 1}`
    m.content = redact(m.content).replace(/https?:\/\/[^\s)\]>"']+/gi, '[link omitted]')
    if (m.authorName) m.authorName = redact(m.authorName).replace(/https?:\/\/[^\s)\]>"']+/gi, '[link omitted]')
    if (m.modelName) m.modelName = redact(m.modelName)
    m.codeBlocks?.forEach(b => { b.code = redact(b.code).replace(/https?:\/\/[^\s)\]>"']+/gi, '[link omitted]'); if (b.language) b.language = redact(b.language) })
    m.attachments?.forEach(a => { a.name = redact(a.name || (a.type === 'image' ? 'Image attachment' : 'Attachment')).replace(/https?:\/\/[^\s)\]>"']+/gi, '[link omitted]'); a.url = '' })
    m.references?.forEach(r => { r.title = redact(r.title).replace(/https?:\/\/[^\s)\]>"']+/gi, '[link omitted]'); r.url = undefined; if (r.source) r.source = redact(r.source) })
  }
  c.artifacts?.forEach(a => { if (a.title) a.title = redact(a.title); a.content = redact(a.content).replace(/https?:\/\/[^\s)\]>"']+/gi, '[link omitted]'); a.url = undefined; if (a.language) a.language = redact(a.language); if (a.mimeType) a.mimeType = redact(a.mimeType) })
  const share = { redactionCount, limitations: ['Heuristic redaction cannot guarantee removal of all sensitive information.'] }
  copy.share = share
  c.snapshot = { ...c.snapshot!, share }
  assertSnapshotOutput(copy, settings)
  return copy
}

/** Shared gate for preview, clipboard and download, independent of rendering engines. */
export function assertSnapshotOutput(snapshot: PageSnapshot, settings?: Partial<ExtensionSettings>): void {
  const options = buildSnapshotExportOptions('markdown', settings)
  const visible = snapshot.conversation.messages.some(m =>
    !!m.content.replace(options.includeCodeBlocks ? /$^/ : /```[\s\S]*?```/g, '').replace(options.includeImages ? /$^/ : /!\[[^\]]*\]\([^)]*\)/g, '').trim() ||
    options.includeCodeBlocks && !!m.codeBlocks?.some(b => b.code.trim()) ||
    options.referenceExportMode !== 'off' && !!m.references?.some(r => r.title.trim()) ||
    !!m.attachments?.some(a => !(a.uploaded && options.includeUploadedFiles === false) && (a.type === 'image' || !!(a.name || a.url)))
  )
  if (!visible) throw new Error('Page snapshot has no output content under selected settings')
}
