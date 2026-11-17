import type { MessageKey } from '../core/i18n'
import { diagnoseExport, type ExportDiagnosticCode } from '../core/export-archive'
import type { Conversation } from '../core/types'

/** Diagnostics shown in the popup; timestamp and asset coverage are reported elsewhere. */
const DIAGNOSTIC_LABELS: Partial<Record<ExportDiagnosticCode, MessageKey>> = {
  unresolved_references: 'unresolved_references',
  duplicate_message_ids: 'duplicate_message_ids',
  tool_calls_without_observed_result: 'tool_calls_without_observed_result'
}

/** Compact source diagnostics; do not confuse transcript verification with archive coverage. */
export function ExportDiagnostics({
  conversation,
  T
}: {
  conversation: Conversation
  T: (key: MessageKey) => string
}) {
  const diagnostics = diagnoseExport(conversation).flatMap(d => {
    const label = DIAGNOSTIC_LABELS[d.code]
    return label ? [{ ...d, label }] : []
  })
  if (!diagnostics.length) return null
  return (
    <details className="export-diagnostics">
      <summary>
        {T('Export diagnostics')} ({diagnostics.length})
      </summary>
      <ul>
        {diagnostics.map(d => (
          <li key={d.code}>
            {T(d.label)}: {d.count}
          </li>
        ))}
      </ul>
    </details>
  )
}
