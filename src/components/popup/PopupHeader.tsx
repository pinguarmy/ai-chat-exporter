/**
 * Popup header: title, open-source badge, theme toggle and settings shortcut.
 */

import { GithubChip, MoonIcon, SettingsIcon, SunIcon } from '../icons'
import { t, type Locale } from '../../core/i18n'
import type { Translate } from './popup-utils'

interface PopupHeaderProps {
  theme: 'light' | 'dark' | undefined
  locale: Locale
  T: Translate
  onToggleTheme: () => void
  onOpenSettings: () => void
}

export function PopupHeader({ theme, locale, T, onToggleTheme, onOpenSettings }: PopupHeaderProps) {
  return (
    <div className="popup-header">
      <div className="flex-col gap-1">
        <h1>{T('AI Chat Exporter')}</h1>
        <div>
          <GithubChip
            title={t('View GitHub Repository', locale)}
            label={<span>{t('100% free · open source', locale)}</span>}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          className="btn-icon"
          onClick={() => onToggleTheme()}
          title={T('Toggle Theme')}
          aria-label={T('Toggle Theme')}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
        <button
          className="btn-icon"
          onClick={onOpenSettings}
          title={T('Open Settings')}
          aria-label={T('Open Settings')}
        >
          <SettingsIcon />
        </button>
      </div>
    </div>
  )
}
