import type { MessageKey } from '../../core/i18n'
/**
 * Options page hero: title, theme toggle and version.
 */

import { MoonIcon, SettingsGearIcon, SunIcon } from '../icons'
import { APP_VERSION } from './options-constants'

interface OptionsHeroProps {
  theme: 'light' | 'dark'
  T: (key: MessageKey) => string
  onToggleTheme: () => void
}

export function OptionsHero({ theme, T, onToggleTheme }: OptionsHeroProps) {
  return (
    <header className="options-hero">
      <div className="options-hero-title">
        <p className="options-kicker">{T('Extension Settings')}</p>
        <h1>
          <SettingsGearIcon /> AI Chat Exporter
        </h1>
      </div>
      <div className="options-hero-actions">
        <button
          className="btn-icon"
          onClick={() => onToggleTheme()}
          title={T('Toggle Theme')}
          aria-label={T('Toggle Theme')}
        >
          {theme === 'dark' ? <SunIcon size={18} /> : <MoonIcon size={18} />}
        </button>
        <span className="options-version">v{APP_VERSION}</span>
      </div>
    </header>
  )
}
