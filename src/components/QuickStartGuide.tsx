/**
 * QuickStartGuide Component
 * Collapsible first-use help built on native <details>/<summary>. Collapsed by
 * default so returning users are not blocked; it persists nothing, opens no
 * tabs by itself, and never changes settings. The parent popup supplies the
 * locale and merges ONBOARDING_STRINGS into the shared i18n tables.
 */

import { t, type Locale } from '../lib/i18n'

interface QuickStartGuideProps {
  /** Active UI locale; unknown keys fall back to English. */
  locale: Locale
  /** Render expanded for a first-use context; the summary stays toggleable. */
  initialOpen?: boolean
}

const PROVIDER_LINKS: ReadonlyArray<{ name: string; href: string }> = [
  { name: 'ChatGPT', href: 'https://chatgpt.com/' },
  { name: 'Gemini', href: 'https://gemini.google.com/app' },
  { name: 'Claude', href: 'https://claude.ai/' },
  { name: 'DeepSeek', href: 'https://chat.deepseek.com/' },
  { name: 'Grok', href: 'https://grok.com/' },
]

export function QuickStartGuide({ locale, initialOpen = false }: QuickStartGuideProps) {
  const T = (key: string) => t(key, locale)

  return (
    <details className="quick-start-guide" open={initialOpen || undefined}>
      <summary>{T('Quick start')}</summary>
      <div className="quick-start-content">
        <div className="quick-start-step">
          <p><strong>{T('1. Open your chat')}</strong></p>
          <p>{T('Open a conversation on a supported site, then click the extension icon again.')}</p>
          <p className="provider-links">
            {PROVIDER_LINKS.map((provider, index) => (
              <span key={provider.name}>
                {index > 0 && ' · '}
                <a href={provider.href} target="_blank" rel="noopener noreferrer">
                  {provider.name}
                </a>
              </span>
            ))}
          </p>
        </div>
        <div className="quick-start-step">
          <p><strong>{T('2. Choose a file')}</strong></p>
          <p>{T('PDF for reading or printing. Markdown for editing. ZIP for an archive with inline source files.')}</p>
        </div>
        <div className="quick-start-step">
          <p><strong>{T('3. Save and find it')}</strong></p>
          <p>{T('Files go to your browser download folder unless you choose another location in Settings.')}</p>
        </div>
        <p>{T('Preview lets you select messages or save only the last answer.')}</p>
        <p>{T('No exporter account. Chats are processed in your browser; preview copies and optional recovery drafts use extension storage. External images may load from their original sites.')}</p>
      </div>
    </details>
  )
}
