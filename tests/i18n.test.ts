import { describe, expect, it } from 'vitest'
import { STRINGS, localeTag, t, tDynamic, type Locale, type MessageKey } from '../src/lib/i18n'

const locales: Locale[] = ['en', 'zh-CN', 'zh-TW', 'de', 'ja', 'ko']

describe('UI translations', () => {
  it('provides every English UI key in each supported locale', () => {
    const englishKeys = Object.keys(STRINGS.en) as MessageKey[]

    for (const locale of locales) {
      for (const key of englishKeys) {
        expect(STRINGS[locale][key], `${locale} is missing ${key}`).toBeTruthy()
      }
    }
  })

  it('resolves every catalogue key to non-empty copy through t() in each locale', () => {
    // Literal keys used by the popup, options page, preview and shared components are
    // checked against `MessageKey` at compile time (`npm run lint`), so a UI key that
    // is missing from the English catalogue cannot build. Here we check resolution.
    const englishKeys = Object.keys(STRINGS.en) as MessageKey[]

    for (const locale of locales) {
      for (const key of englishKeys) {
        expect(t(key, locale), `${locale} resolves ${key} to nothing`).toBeTruthy()
      }
    }
  })

  it('uses English as a fallback and interpolates complete scheduling labels', () => {
    expect(t('Minimum interval between starting detail reads for each provider ({0}s)', 'zh-CN', 5)).toBe('同一平台启动下一次对话详情读取前的最小间隔（5 秒）')
    expect(tDynamic('missing key', 'zh-TW')).toBe('missing key')
  })

  it('resolves unknown dynamic keys to themselves in every locale, with interpolation', () => {
    for (const locale of locales) {
      expect(tDynamic('not a catalogue key', locale)).toBe('not a catalogue key')
      expect(tDynamic('not a catalogue key {0}', locale, 7)).toBe('not a catalogue key 7')
    }
  })

  it('falls back to English for keys a partial locale does not translate', () => {
    const key = 'Export Content' as const
    expect(t(key, 'de')).not.toBe(t(key, 'en'))
    expect(tDynamic('Unknown message', 'ja')).toBe('Unknown message')
  })

  it('uses the correct browser locale for each added language', () => {
    expect(localeTag('de')).toBe('de-DE')
    expect(localeTag('ja')).toBe('ja-JP')
    expect(localeTag('ko')).toBe('ko-KR')
  })
})
