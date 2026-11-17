import { useEffect } from 'react'
import type { Locale } from '../core/i18n'

/** Language also selects the correct regional serif fallback, including forms. */
export function useLocaleSync(locale?: Locale) {
  useEffect(() => {
    document.documentElement.lang = locale || 'en'
  }, [locale])
}
