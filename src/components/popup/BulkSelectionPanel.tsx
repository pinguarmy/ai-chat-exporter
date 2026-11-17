/**
 * Collapsible "Quick selection" rules for Bulk Export: date range, quantity
 * cap and duplicate protection.
 */

import { Toggle } from '../Toggle'
import { InfoTooltip } from '../InfoTooltip'
import { normalizeBulkSelectionLimit } from '../../core/bulk-selection'
import { t, type Locale } from '../../core/i18n'
import type { ExtensionSettings } from '../../core/types'
import type { Translate } from './popup-utils'

interface BulkSelectionPanelProps {
  locale: Locale
  T: Translate
  settings: ExtensionSettings | null
  loading: boolean
  bulkLoading: boolean
  hasVisibleConversations: boolean
  bulkFromDate: string
  setBulkFromDate: (value: string) => void
  bulkToDate: string
  setBulkToDate: (value: string) => void
  bulkSelectionLimit: string
  setBulkSelectionLimit: (value: string) => void
  bulkDateRangeInvalid: boolean
  applyBulkSelection: () => void
  handleOptionChange: (key: keyof ExtensionSettings, value: any) => void
}

export function BulkSelectionPanel({
  locale, T, settings, loading, bulkLoading, hasVisibleConversations,
  bulkFromDate, setBulkFromDate, bulkToDate, setBulkToDate,
  bulkSelectionLimit, setBulkSelectionLimit, bulkDateRangeInvalid,
  applyBulkSelection, handleOptionChange,
}: BulkSelectionPanelProps) {
  return (
    <details className="bulk-selection-panel">
      <summary className="bulk-selection-summary">
        <span>{T('Quick selection')}</span>
        <span className="bulk-selection-summary-value">
          {bulkFromDate || bulkToDate ? `${bulkFromDate || '…'} – ${bulkToDate || '…'} · ` : ''}
          {t('Up to {0}', locale, normalizeBulkSelectionLimit(Number(bulkSelectionLimit)))}
          {(settings?.skipAlreadyExported ?? true) ? ` · ${T('Skip archived')}` : ''}
        </span>
      </summary>
      <p className="text-xs text-muted">{T('Apply these rules to select conversations. Manual selections can exceed this limit.')}</p>
      <div className="bulk-selection-heading">
        <div>
          <span className="section-label">
            {T('Date & Quantity Selection')}
            <InfoTooltip
              text={`${T('Select a date range and a maximum number of conversations in one step. The cap keeps each bulk run bounded; dates come from the provider when available.')} ${T('Already archived conversations are excluded from this quick selection.')}`}
            />
          </span>
        </div>
        <button type="button" className="btn btn-outline btn-compact" onClick={applyBulkSelection} disabled={loading || bulkLoading || !hasVisibleConversations || bulkDateRangeInvalid}>
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
            onChange={event => setBulkSelectionLimit(event.target.value)}
            onBlur={() => setBulkSelectionLimit(String(normalizeBulkSelectionLimit(Number(bulkSelectionLimit))))}
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
    </details>
  )
}
