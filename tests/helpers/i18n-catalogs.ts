import { getDictionary, loadLocale, type Locale, type MessageKey } from '../../src/core/i18n'

const LOCALES: Locale[] = ['en', 'zh-CN', 'zh-TW', 'de', 'ja', 'ko']

// Locale catalogues are loaded on demand in the product; tests that inspect or
// translate with every locale import this helper so all of them are loaded
// before the suite runs.
await Promise.all(LOCALES.map(locale => loadLocale(locale)))

/** Fully resolved (English fallback applied) dictionary per locale. */
export const STRINGS = Object.fromEntries(
  LOCALES.map(locale => [locale, getDictionary(locale)])
) as Record<Locale, Record<MessageKey, string>>
