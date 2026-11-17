/**
 * Support link, About & License card and the transient "saved" toast.
 */

import { SUPPORT_URL, supportLabel } from '../../lib/support'
import { GithubChip } from '../icons'
import { t, type Locale, type MessageKey } from '../../lib/i18n'
import { APP_VERSION } from './options-constants'

export function SupportCard({ locale }: { locale: Locale }) {
  return (
    <div className="options-card about-card">
      <a className="link-btn" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">{supportLabel(locale)}</a>
    </div>
  )
}

export function AboutCard({ locale, T }: { locale: Locale; T: (key: MessageKey) => string }) {
  return (
    <div className="options-card about-card">
      <div className="options-card-header">
        <h2>{T('About')}</h2>
      </div>
      <div className="flex justify-between items-center text-sm">
        <div className="flex-col gap-1">
          <div className="font-bold" style={{ color: 'var(--text-primary)' }}>AI Chat Exporter <span className="text-xs text-muted" style={{ fontWeight: 'normal' }}>v{APP_VERSION}</span></div>
          <div className="text-xs text-muted">MIT License &bull; Free and Open Source Software</div>
        </div>
        <GithubChip
          title={t('View GitHub Repository', locale)}
          label="github.com/pinguarmy/ai-chat-exporter"
          iconSize={12}
          iconMarginRight="6px"
          style={{ padding: '6px 12px', fontSize: '11px' }}
        />
      </div>
    </div>
  )
}

export function SaveNotification({ T }: { T: (key: MessageKey) => string }) {
  return (
    <div className="save-notification" role="status" aria-live="polite">
      {T('Settings saved successfully!')}
    </div>
  )
}
