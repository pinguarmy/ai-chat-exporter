/**
 * Card 2: what an export contains (content, PDF layout, structure).
 */

import { Toggle } from '../Toggle'
import { Section } from '../Section'
import type { ExtensionSettings } from '../../lib/types'

interface ContentCardProps {
  settings: ExtensionSettings
  T: (key: string) => string
  updateSetting: <K extends keyof ExtensionSettings>(key: K, value: ExtensionSettings[K]) => void
}

export function ContentCard({ settings, T, updateSetting }: ContentCardProps) {
  return (
    <div className="options-card content-card">
      <div className="options-card-header">
        <h2>{T('Export Content Configuration')}</h2>
      </div>

      <Section title={T('Export Content')} className="mb-2">
        <Toggle
          label={T('Include Metadata')}
          description={T('Add date, title, and platform at the top of exports')}
          checked={settings.includeMetadata}
          onChange={(val) => updateSetting('includeMetadata', val)}
        />

        <Toggle
          label={T('Include Code Blocks')}
          description={T('Export code blocks in messages')}
          checked={settings.includeCodeBlocks}
          onChange={(val) => updateSetting('includeCodeBlocks', val)}
        />

        <Toggle
          label={T('Include Images')}
          description={T('Export images embedded in conversations')}
          checked={settings.includeImages}
          onChange={(val) => updateSetting('includeImages', val)}
        />

        <Toggle
          label={T('Include Uploaded Files')}
          description={T('Preserve references to files you uploaded to chat')}
          checked={settings.includeUploadedFiles}
          onChange={(val) => updateSetting('includeUploadedFiles', val)}
        />

        <div className="options-row">
          <div>
            <div className="option-label">{T('Source References')}</div>
            <div className="option-description">{T('Control citation titles and private connector links')}</div>
          </div>
          <select
            className="input select"
            value={settings.referenceExportMode}
            onChange={(e) => updateSetting('referenceExportMode', e.target.value as ExtensionSettings['referenceExportMode'])}
            aria-label={T('Source References')}
          >
            <option value="off">{T('Do not export references')}</option>
            <option value="titles">{T('Titles only (recommended)')}</option>
            <option value="safe-links">{T('Public links')}</option>
            <option value="all-links">{T('All sanitized links')}</option>
          </select>
        </div>
      </Section>

      <Section title={T('PDF')} className="mt-2">
        <div className="options-row">
          <div>
            <div className="option-label">{T('PDF Appearance')}</div>
            <div className="option-description">{T('Use a centered, neutral reading layout')}</div>
          </div>
          <select
            className="input select"
            value={settings.pdfStyle ?? 'minimal'}
            onChange={(e) => updateSetting('pdfStyle', e.target.value as ExtensionSettings['pdfStyle'])}
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
            value={settings.assistantDisplayName ?? ''}
            onChange={(e) => updateSetting('assistantDisplayName', e.target.value)}
            placeholder={T('Auto (provider/model)')}
            aria-label={T('Assistant Label')}
          />
        </div>

        <Toggle
          label={T('Searchable Text')}
          description={T('Add a searchable and copyable text layer to PDF pages')}
          checked={settings.pdfTextLayer ?? true}
          onChange={(val) => updateSetting('pdfTextLayer', val)}
        />
        <Toggle
          label={T('Message Timestamps')}
          description={T('Show input and answer times when available')}
          checked={settings.showMessageTimestamps ?? true}
          onChange={(val) => updateSetting('showMessageTimestamps', val)}
        />
      </Section>

      <Section title={T('Structure')} className="mt-2">
        <Toggle
          label={T('Export Artifacts')}
          description={T('Isolate code artifacts and documents')}
          checked={settings.exportArtifacts}
          onChange={(val) => updateSetting('exportArtifacts', val)}
        />
      </Section>
    </div>
  )
}
