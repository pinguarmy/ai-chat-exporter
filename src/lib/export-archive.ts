import { renderableMessageReferences } from './message-references'
import { zipSync, strToU8 } from 'fflate'
import type { Conversation, ExportOptions } from './types'
import { conversationToMarkdown } from './export-markdown'
import { transcriptMetadata } from './transcript-metadata'
import { sanitizeFilename } from './filename'

export interface ExportDiagnostic { code: string; count: number }
export function diagnoseExport(conversation: Conversation): ExportDiagnostic[] {
  const result: ExportDiagnostic[] = []
  const add = (code: string, count: number) => { if (count) result.push({ code, count }) }
  add('unresolved_references', conversation.messages.reduce((n, m) => n + (m.referenceDiagnostics?.length || 0), 0))
  add('missing_message_timestamps', conversation.messages.filter(m => !Number.isFinite(m.timestamp)).length)
  add('duplicate_message_ids', conversation.messages.length - new Set(conversation.messages.map(m => m.id)).size)
  const events = conversation.events || []
  add('tool_calls_without_observed_result', events.filter(e => e.kind === 'tool_call' && !events.some(r => r.kind === 'tool_result' && (r.parentId === e.id || (e.callId && r.callId === e.callId)))).length)
  add('external_assets_not_embedded', conversation.messages.flatMap(m => m.attachments || []).filter(a => Boolean(a.url)).length)
  return result
}

/** Heuristic share copy. Mark every transformation; this is not a secret detector guarantee. */
export function redactShareText(text: string): { text: string; replacements: number } {
  let replacements = 0
  const replace = (...args: any[]) => { replacements++; return `${args[1] || ''}[REDACTED]` }
  const redacted = text
    .replace(/((?:[?&]|\b)(?:access_token|refresh_token|token|api[_-]?key|password|secret|signature|sig)=)[^\s&#)"']+/gi, replace)
    .replace(/((?:authorization|cookie|set-cookie)\s*:\s*)[^\r\n]+/gi, replace)
    .replace(/((?:[\"']?(?:api[_-]?key|password|secret|access_token|refresh_token)[\"']?)\s*:\s*[\"'])[^\"'\r\n]+/gi, replace)
    .replace(/\b(sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{16,})\b/g, () => { replacements++; return '[REDACTED]' })
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, (_m, prefix) => { replacements++; return prefix })
  return { text: redacted, replacements }
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource)
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('')
}
export async function buildArchive(conversation: Conversation, options: ExportOptions, exporterVersion: string, exportedAt = Date.now()) {
  const files: Record<string, Uint8Array> = {}
  let redactions = 0
  const put = (name: string, text: string) => {
    const processed = options.safeShare ? redactShareText(text) : { text, replacements: 0 }
    redactions += processed.replacements
    files[name] = strToU8(processed.text)
  }
  put('conversation.md', conversationToMarkdown(conversation, { ...options, exportedAt, referenceExportMode: options.safeShare ? 'titles' : options.referenceExportMode }))
  // Tool payloads can contain private arguments/results. Opt in separately from bundling.
  const events = options.includeToolTrace ? conversation.events || [] : []
  const transformJson = (value: unknown): unknown => {
    if (typeof value === 'string' && options.safeShare) { const r = redactShareText(value); redactions += r.replacements; return r.text }
    if (Array.isArray(value)) return value.map(transformJson)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, transformJson(v)]))
    return value
  }
  files['references.json'] = strToU8(JSON.stringify(transformJson(conversation.messages.map(message => ({ message_id: options.safeShare ? undefined : message.id, references: renderableMessageReferences(message.references, options.safeShare ? 'titles' : options.referenceExportMode), diagnostics: message.referenceDiagnostics?.map(d => options.safeShare ? { code: d.code } : d) }))), null, 2))
  files['trace.json'] = strToU8(JSON.stringify(transformJson({ schema_version: 2, coverage: conversation.traceCoverage || 'unavailable', included: Boolean(options.includeToolTrace), events }), null, 2))
  if (options.exportArtifacts) for (const [i, artifact] of (conversation.artifacts || []).entries()) {
    if (!artifact.content || (artifact.uploaded && options.includeUploadedFiles === false)) continue
    if (artifact.type === 'code' && !options.includeCodeBlocks) continue
    put(`assets/${i + 1}-${sanitizeFilename(artifact.title || 'artifact') || 'artifact'}.txt`, artifact.content)
  }
  const hashes = await Promise.all(Object.entries(files).map(async ([path, data]) => ({ path, bytes: data.length, sha256: await sha256(data) })))
  const manifest = {
    schema_version: 2, exporter_version: exporterVersion,
    conversation_id: options.safeShare ? undefined : conversation.id,
    provider: conversation.platform, branch: options.safeShare ? undefined : conversation.activeBranchId,
    ...transcriptMetadata(conversation, exportedAt),
    visible_message_count: conversation.messages.length, observed_tool_event_count: conversation.events?.length || 0,
    structure_validation: conversation.verification?.transcript || { verified: conversation.sourceCompleteness === 'verified' },
    authenticity_validation: 'unavailable',
    trace_coverage: conversation.traceCoverage || 'unavailable',
    assets_coverage: 'inline-artifacts-only; external attachments are not downloaded',
    raw_provider_payload: 'not-collected',
    share_copy: Boolean(options.safeShare), redaction_count: redactions,
    share_limitations: options.safeShare ? 'Heuristic credential redaction; review names, private content and unrecognized secrets before sharing.' : undefined,
    diagnostics: diagnoseExport(conversation), files: hashes,
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
  return { bytes: zipSync(files), manifest }
}
