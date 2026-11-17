/**
 * Popup footers: the always-visible support/recovery links and the Bulk
 * Export action bar (format, scope summary and export button).
 */

import { ExportButton } from '../ExportButton'
import { FormatSelector } from '../FormatSelector'
import { SUPPORT_URL, supportLabel } from '../../lib/support'
import { t, type Locale } from '../../lib/i18n'
import type { ExportFormat, ExtensionSettings } from '../../lib/types'
import type { Translate } from './popup-utils'

export function SupportFooter({ locale, T }: { locale: Locale; T: Translate }) {
  return (
    <div className="popup-footer support-footer">
      <a className="link-btn" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">{supportLabel(locale)}</a>
      <button type="button" className="link-btn" onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('tabs/recovery.html') })}>{T('Open recovery page')}</button>
    </div>
  )
}

interface BulkFooterProps {
  locale: Locale
  T: Translate
  format: ExportFormat
  setFormat: (format: ExportFormat) => void
  settings: ExtensionSettings | null
  loading: boolean
  bulkEligibleCount: number
  quickExportFormatDesc: string
  bulkFolderLabel: string
  handleOptionChange: (key: keyof ExtensionSettings, value: any) => void
  handleBulkExport: () => void
}

export function BulkFooter({
  locale, T, format, setFormat, settings, loading, bulkEligibleCount,
  quickExportFormatDesc, bulkFolderLabel, handleOptionChange, handleBulkExport,
}: BulkFooterProps) {
  return (
    <div className="popup-footer">
      <FormatSelector value={format} onChange={setFormat} disabled={loading} archiveBundle={settings?.archiveBundle} onArchiveChange={value => handleOptionChange('archiveBundle', value)} locale={locale} />
      <p className="text-xs text-muted bulk-export-summary">
        {t('Scope: {0} selected conversations · {1} · saved to {2}', locale, bulkEligibleCount, quickExportFormatDesc, bulkFolderLabel)}
      </p>
      <ExportButton onClick={() => handleBulkExport()} disabled={bulkEligibleCount === 0} loading={loading} format={format} text={`${T('Export')} ${bulkEligibleCount} ${T('Selected')}`} />
    </div>
  )
}
