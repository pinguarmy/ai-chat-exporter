/**
 * ExportOptionsPanel Component
 * Collapsible advanced export options shared by the popup's Current Chat and
 * Bulk Export tabs.
 */

import { useId } from 'react'
import { FilenameEditor } from './FilenameEditor'
import { Toggle } from './Toggle'
import { Section } from './Section'
import type { Conversation, ExportFormat, ExtensionSettings } from '../lib/types'

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

interface ExportOptionsPanelProps {
  settingsDirty?: boolean
  onSaveDefaults?: () => void
  onResetDefaults?: () => void
  open: boolean
  onToggle: () => void
  settings: ExtensionSettings | null
  conversation: Conversation | null
  format: ExportFormat
  loading: boolean
  onOptionChange: (key: keyof ExtensionSettings, value: any) => void
  T: (key: string) => string
}

/**
 * Collapsible "Advanced Export Options" panel: filename pattern, content
 * toggles, PDF-only settings, and structure options.
 */
export function ExportOptionsPanel({
  open,
  settingsDirty, onSaveDefaults, onResetDefaults,
  onToggle,
  settings,
  conversation,
  format,
  loading,
  onOptionChange,
  T
}: ExportOptionsPanelProps) {
  const panelId = useId()
  return (
    <div className="flex-col">
      <button
        type="button"
        className="options-toggle-btn"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span>{T('Advanced Export Options')}</span>
        <ChevronIcon direction={open ? 'up' : 'down'} />
      </button>

      <div id={panelId} hidden={!open} className={`options-panel-container ${open ? 'open' : ''}`}>
        <div className="flex-col gap-3 mt-2 pb-2">
          <p className="text-xs text-muted">{T('Changes here apply to this session. Save explicitly to change defaults.')}</p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-outline btn-compact" disabled={!settingsDirty || loading} onClick={onSaveDefaults}>{T('Save as defaults')}</button>
            <button type="button" className="btn btn-outline btn-compact" disabled={!settingsDirty || loading} onClick={onResetDefaults}>{T('Reset to defaults')}</button>
          </div>
          <FilenameEditor
            value={settings?.filenamePattern || '{date}-{title}'}
            onChange={(pattern) => {
              if (settings) {
                onOptionChange('filenamePattern', pattern)
              }
            }}
            conversation={conversation}
            disabled={loading}
            locale={settings?.locale ?? 'en'}
          />

          <Section title={T('Export Content')}>
              <Toggle
                label={T('Message Timestamps')}
                description={T('Show input and answer times when available')}
                checked={settings?.showMessageTimestamps ?? true}
                onChange={(val) => onOptionChange('showMessageTimestamps', val)}
                disabled={loading}
              />
            <Toggle
              label={T('Include Metadata')}
              description={T('Add date, title, and platform at the top of exports')}
              checked={settings?.includeMetadata ?? true}
              onChange={(val) => onOptionChange('includeMetadata', val)}
              disabled={loading}
            />
            <Toggle
              label={T('Include Code Blocks')}
              description={T('Export code blocks in messages')}
              checked={settings?.includeCodeBlocks ?? true}
              onChange={(val) => onOptionChange('includeCodeBlocks', val)}
              disabled={loading}
            />
            <Toggle
              label={T('Include Images')}
              description={T('Export images embedded in conversations')}
              checked={settings?.includeImages ?? true}
              onChange={(val) => onOptionChange('includeImages', val)}
              disabled={loading}
            />
            <Toggle
              label={T('Include Uploaded Files')}
              description={T('Preserve references to files you uploaded to chat')}
              checked={settings?.includeUploadedFiles ?? true}
              onChange={(val) => onOptionChange('includeUploadedFiles', val)}
              disabled={loading}
            />
            <div className="options-row">
              <div>
                <div className="option-label">{T('Source References')}</div>
                <div className="option-description">{T('Control citation titles and private connector links')}</div>
              </div>
              <select
                className="select"
                value={settings?.referenceExportMode ?? 'titles'}
                onChange={(e) => onOptionChange('referenceExportMode', e.target.value as ExtensionSettings['referenceExportMode'])}
                disabled={loading}
                aria-label={T('Source References')}
              >
                <option value="off">{T('Do not export references')}</option>
                <option value="titles">{T('Titles only (recommended)')}</option>
                <option value="safe-links">{T('Public links')}</option>
                <option value="all-links">{T('All sanitized links')}</option>
              </select>
            </div>
          </Section>

          {format === 'pdf' && (
            <Section title={T('PDF')}>
              <div className="options-row">
                <div>
                  <div className="option-label">{T('PDF Appearance')}</div>
                  <div className="option-description">{T('Use a centered, neutral reading layout')}</div>
                </div>
                <select
                  className="select"
                  value={settings?.pdfStyle ?? 'minimal'}
                  onChange={(e) => onOptionChange('pdfStyle', e.target.value as ExtensionSettings['pdfStyle'])}
                  disabled={loading}
                  aria-label={T('PDF Appearance')}
                >
                  <option value="minimal">{T('Minimal centered (recommended)')}</option>
                  <option value="classic">{T('Classic conversation cards')}</option>
                </select>
              </div>
              <div className="options-row">
                <div>
                  <div className="option-label">{T('Assistant Label')}</div>
                  <div className="option-description">{T('Use provider or model name when available')}</div>
                </div>
                <input
                  className="input"
                  value={settings?.assistantDisplayName ?? ''}
                  onChange={(e) => onOptionChange('assistantDisplayName', e.target.value)}
                  placeholder={T('Auto (provider/model)')}
                  aria-label={T('Assistant Label')}
                  disabled={loading}
                />
              </div>
              <Toggle
                label={T('Searchable Text')}
                description={T('Add a searchable and copyable text layer to PDF pages')}
                checked={settings?.pdfTextLayer ?? true}
                onChange={(val) => onOptionChange('pdfTextLayer', val)}
                disabled={loading}
              />
            </Section>
          )}

          {format === 'markdown' && <Section title={T('Archive bundle')}>
            <p className="text-muted" style={{ fontSize: '12px', lineHeight: 1.45, margin: '2px 0 6px' }}>
              {T('When enabled, downloads a .zip containing Markdown, a manifest of references, and checksums. When disabled, downloads a single .md file.')}
            </p>
            <Toggle label={T('Download ZIP with manifest')} checked={settings?.archiveBundle ?? false} onChange={val => onOptionChange('archiveBundle', val)} disabled={loading} />
            {settings?.archiveBundle && <>
              <p className="text-xs text-muted">{T('Includes Markdown, hashes and inline artifacts. External attachments are not downloaded.')}</p>
              <Toggle label={T('Include tool trace')} description={T('Tool arguments and results may contain private data. Only provider-exposed events are available.')} checked={settings?.includeToolTrace ?? false} onChange={val => onOptionChange('includeToolTrace', val)} disabled={loading} />
              <Toggle label={T('Create share copy')} description={T('Redacts common credentials. Review private content before sharing.')} checked={settings?.safeShare ?? false} onChange={val => onOptionChange('safeShare', val)} disabled={loading} />
              <Toggle label={T('Include raw provider data')} description={T('Packs the original platform response (gzip) into the archive for long-term preservation or re-parsing. Larger file; stays only in your download.')} checked={settings?.includeRawPayload ?? false} onChange={val => onOptionChange('includeRawPayload', val)} disabled={loading} />
            </>}
          </Section>}
          <Section title={T('Structure')}>
            <Toggle
              label={T('Export Artifacts')}
              description={T('Isolate code artifacts and documents')}
              checked={settings?.exportArtifacts ?? true}
              onChange={(val) => onOptionChange('exportArtifacts', val)}
              disabled={loading}
            />
          </Section>
        </div>
      </div>
    </div>
  )
}
