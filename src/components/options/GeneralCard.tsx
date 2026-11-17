/**
 * Card 1: general settings, appearance, download location and the filename
 * pattern editor with its live preview.
 */

import { Toggle } from '../Toggle'
import { InfoTooltip } from '../InfoTooltip'
import { FilenameEditor } from '../FilenameEditor'
import type { Locale, MessageKey } from '../../core/i18n'
import type { DownloadFolderOption, ExportFormat, ExtensionSettings } from '../../core/types'

interface GeneralCardProps {
  settings: ExtensionSettings
  locale: Locale
  T: (key: MessageKey) => string
  previewPath: string
  updateSetting: <K extends keyof ExtensionSettings>(key: K, value: ExtensionSettings[K]) => void
}

export function GeneralCard({ settings, locale, T, previewPath, updateSetting }: GeneralCardProps) {
  const openDownloadsFolder = () => {
    try {
      chrome.downloads.showDefaultFolder()
    } catch (err) {
      console.error('Failed to open downloads folder:', err)
    }
  }

  return (
    <div className="options-card general-card">
      <div className="options-card-header">
        <h2>{T('General & Appearance')}</h2>
      </div>

      <div className="options-row">
        <div>
          <div className="option-label">
            {T('Default Format')}
            <InfoTooltip text={T('Primary format used for one-click exports')} />
          </div>
        </div>
        <select
          className="input select"
          value={settings.defaultFormat}
          onChange={(e) => updateSetting('defaultFormat', e.target.value as ExportFormat)}
          aria-label={T('Default Format')}
        >
          <option value="markdown">{T('Markdown (.md)')}</option>
          <option value="pdf">{T('PDF Document')}</option>
        </select>
      </div>

      <div className="options-row">
        <div>
          <div className="option-label">
            {T('UI Theme')}
            <InfoTooltip text={T('Select color theme for extension popup and options')} />
          </div>
        </div>
        <select
          className="input select"
          value={settings.theme}
          onChange={(e) => updateSetting('theme', e.target.value as ExtensionSettings['theme'])}
          aria-label={T('UI Theme')}
        >
          <option value="light">{T('Light Mode')}</option>
          <option value="dark">{T('Dark Mode')}</option>
        </select>
      </div>

      <div className="options-row">
        <div>
          <div className="option-label">{T('Language')}</div>
        </div>
        <select
          className="input select"
          value={settings.locale ?? 'en'}
          onChange={(e) => updateSetting('locale', e.target.value as Locale)}
          aria-label={T('Language')}
        >
          <option value="en">{T('English')}</option>
          <option value="zh-CN">{T('简体中文')}</option>
          <option value="zh-TW">{T('繁體中文')}</option>
          <option value="de">Deutsch</option>
          <option value="ja">日本語</option>
          <option value="ko">한국어</option>
        </select>
      </div>

      <div className="options-row options-row-divider">
        <div>
          <div className="option-label">
            {T('Download Folder Strategy')}
            <InfoTooltip text={T('Organize downloaded exports into subfolders')} />
          </div>
        </div>
        <select
          className="input select"
          value={settings.downloadFolder}
          onChange={(e) => updateSetting('downloadFolder', e.target.value as DownloadFolderOption)}
          aria-label={T('Download Folder Strategy')}
        >
          <option value="default">{T('Default Downloads Folder')}</option>
          <option value="by-platform">{T('Organize By Platform')}</option>
          <option value="custom">{T('Use Custom Subfolder')}</option>
        </select>
      </div>

      {settings.downloadFolder === 'custom' && (
        <div className="options-row" style={{ animation: 'fadeIn 200ms ease' }}>
          <div>
            <div className="option-label">
              {T('Custom Subfolder Name')}
              <InfoTooltip text={T('Exports will be placed inside: Downloads/[folder name]')} />
            </div>
          </div>
          <input
            className="input"
            value={settings.customFolderName}
            onChange={(e) => updateSetting('customFolderName', e.target.value)}
            placeholder="AI Chat Exports"
            aria-label={T('Custom Subfolder Name')}
          />
        </div>
      )}

      <div className="download-boundary-note">
        <div>
          <span className="download-boundary-title">
            {T('Where files can go')}
            <InfoTooltip text={T('Choose Downloads root, a platform subfolder, or your own Downloads subfolder. Browser extensions cannot write directly to an arbitrary absolute path.')} />
          </span>
        </div>
        <button type="button" className="btn btn-outline btn-compact" onClick={openDownloadsFolder}>
          {T('Open Downloads Folder')}
        </button>
      </div>

      <Toggle
        label={T('Ask where to save interactive exports')}
        description={T('Opens the browser Save As chooser so you can select any local folder. This prompts once per file and is not used by scheduled export.')}
        checked={settings.askForSaveLocation ?? false}
        onChange={(value) => updateSetting('askForSaveLocation', value)}
      />

      <div className="filename-settings-panel">
        <div className="options-subsection-heading">
          <div>
            <span className="option-label">
              {T('Filename Pattern')}
              <InfoTooltip text={T('Write your own pattern or insert variables. {date} is the first day of this conversation; {end_date} is the export day.')} />
            </span>
          </div>
        </div>
        <FilenameEditor
          value={settings.filenamePattern}
          onChange={(pattern) => updateSetting('filenamePattern', pattern)}
          defaultOpen
          locale={locale}
        />
        <div className="filename-preview">
          <span>{T('Preview')}</span>
          <code>{previewPath}</code>
        </div>
      </div>
    </div>
  )
}
