import type { ExportFormat } from '../lib/types'
import { t, type Locale } from '../lib/i18n'

interface FormatSelectorProps {
  value: ExportFormat
  onChange: (format: ExportFormat) => void
  archiveBundle?: boolean
  onArchiveChange?: (enabled: boolean) => void
  locale?: Locale
  disabled?: boolean
}

/** User jobs map directly to the existing format and archive settings. */
export function FormatSelector({ value, onChange, archiveBundle = false, onArchiveChange, locale = 'en', disabled = false }: FormatSelectorProps) {
  const selected = value === 'pdf' ? 'pdf' : archiveBundle ? 'zip' : 'markdown'
  const choices = [
    { id: 'markdown', label: 'Editable Markdown' },
    { id: 'pdf', label: 'Reading PDF' },
    ...(onArchiveChange ? [{ id: 'zip', label: 'Archive ZIP' }] : []),
  ]
  return <div className="format-selector" role="group" aria-label={t('Format:', locale)}>
    {choices.map(choice => <button key={choice.id} type="button"
      className={`format-btn ${selected === choice.id ? 'active' : ''}`}
      onClick={() => { onArchiveChange?.(choice.id === 'zip'); onChange(choice.id === 'pdf' ? 'pdf' : 'markdown') }}
      disabled={disabled} aria-pressed={selected === choice.id}>
      {t(choice.label, locale)}
    </button>)}
  </div>
}
