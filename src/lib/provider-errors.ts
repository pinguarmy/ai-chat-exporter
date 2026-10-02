import { t, type Locale } from './i18n'

/** Provider messages stay language-neutral in state; translate at the UI boundary. */
export function localizeProviderError(message: string, locale: Locale): string {
  const verification = message.match(/^(ChatGPT|Claude) did not return a verifiably complete/)
  if (verification) return t('{0} could not verify the complete conversation. Reload the provider page and retry.', locale, verification[1])
  if (/authentication required|sign.?in|session expired/i.test(message)) {
    return t('Sign in to the provider, then refresh the conversation list.', locale)
  }
  if (/timed out|timeout/i.test(message)) return t('Provider read timed out. Refresh to retry.', locale)
  const translated = t(message, locale)
  if (translated !== message || locale === 'en') return translated
  return t('The operation failed. Reload the provider page and retry.', locale)
}
