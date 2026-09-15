import { diagnoseExport } from '../lib/export-archive'
import type { Conversation } from '../lib/types'

/** Compact source diagnostics; do not confuse transcript verification with archive coverage. */
export function ExportDiagnostics({ conversation, T }: { conversation: Conversation; T: (key: string) => string }) {
  const diagnostics = diagnoseExport(conversation).filter(d => d.code !== 'missing_message_timestamps' && d.code !== 'external_assets_not_embedded')
  if (!diagnostics.length) return null
  return <details className="export-diagnostics">
    <summary>{T('Export diagnostics')} ({diagnostics.length})</summary>
    <ul>{diagnostics.map(d => <li key={d.code}>{T(d.code)}: {d.count}</li>)}</ul>
  </details>
}
