import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { type Locale } from '../../../src/core/i18n'
import { STRINGS } from '../../helpers/i18n-catalogs'
import { en } from '../../../src/core/i18n/locales/en'
import { zhCN } from '../../../src/core/i18n/locales/zh-CN'
import { zhTW } from '../../../src/core/i18n/locales/zh-TW'
import { de } from '../../../src/core/i18n/locales/de'
import { ja } from '../../../src/core/i18n/locales/ja'
import { ko } from '../../../src/core/i18n/locales/ko'

/** Source dictionaries exactly as authored (before English fallback is applied). */
const SOURCE: Record<Locale, Record<string, string>> = {
  en,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  de,
  ja,
  ko
}
const LOCALES = Object.keys(SOURCE) as Locale[]
const NON_ENGLISH = LOCALES.filter(locale => locale !== 'en')

/** Locales that must translate every English key themselves. */
const COMPLETE_LOCALES: Locale[] = ['zh-CN', 'zh-TW']
/** Locales that intentionally inherit untranslated keys from English. */
const PARTIAL_LOCALES: Locale[] = ['de', 'ja', 'ko']

const englishKeys = Object.keys(en)
const placeholders = (text: string) => (text.match(/\{\d+\}/g) ?? []).sort()

describe('i18n catalogue', () => {
  it('covers every supported locale as either complete or partial', () => {
    expect([...COMPLETE_LOCALES, ...PARTIAL_LOCALES, 'en'].sort()).toEqual([...LOCALES].sort())
  })

  it.each(NON_ENGLISH)('%s contains no keys absent from English', locale => {
    const unknown = Object.keys(SOURCE[locale]).filter(key => !(key in en))
    expect(unknown).toEqual([])
  })

  it.each(NON_ENGLISH)('%s placeholders match the English key', locale => {
    const mismatched = Object.entries(SOURCE[locale])
      .filter(([key, value]) => {
        const expected = placeholders(en[key as keyof typeof en])
        return JSON.stringify(placeholders(value)) !== JSON.stringify(expected)
      })
      .map(([key]) => key)
    expect(mismatched).toEqual([])
  })

  it('keeps English placeholders aligned between each key and its English value', () => {
    // English values may be reworded, but must not drop or add interpolation slots
    // relative to the lookup key that call sites pass arguments for.
    const mismatched = Object.entries(en)
      .filter(
        ([key, value]) => JSON.stringify(placeholders(key)) !== JSON.stringify(placeholders(value))
      )
      .map(([key]) => key)
    expect(mismatched).toEqual([])
  })

  it.each(COMPLETE_LOCALES)('%s translates every English key', locale => {
    const missing = englishKeys.filter(key => !SOURCE[locale][key])
    expect(missing).toEqual([])
  })

  it.each(PARTIAL_LOCALES)(
    '%s is partial in source but complete after English fallback',
    locale => {
      expect(Object.keys(SOURCE[locale]).length).toBeLessThanOrEqual(englishKeys.length)
      const missing = englishKeys.filter(key => !STRINGS[locale][key as keyof typeof en])
      expect(missing).toEqual([])
      // Keys a partial locale omits resolve to the English copy.
      for (const key of englishKeys.filter(candidate => !(candidate in SOURCE[locale]))) {
        expect(STRINGS[locale][key as keyof typeof en]).toBe(en[key as keyof typeof en])
      }
    }
  )
})

describe('Chrome _locales messages', () => {
  const localesDir = resolve(__dirname, '..', '..', '..', 'public', '_locales')
  const read = (dir: string) =>
    JSON.parse(readFileSync(resolve(localesDir, dir, 'messages.json'), 'utf8')) as Record<
      string,
      { message: string }
    >
  const dirs = readdirSync(localesDir)
  const englishMessageKeys = Object.keys(read('en')).sort()

  it('ships the six expected locale directories', () => {
    expect([...dirs].sort()).toEqual(['de', 'en', 'ja', 'ko', 'zh_CN', 'zh_TW'])
  })

  it.each(dirs.filter(dir => dir !== 'en'))(
    '%s messages.json has the same keys as English',
    dir => {
      expect(Object.keys(read(dir)).sort()).toEqual(englishMessageKeys)
    }
  )

  it.each(dirs)('%s messages.json has a non-empty message for every key', dir => {
    for (const [key, entry] of Object.entries(read(dir))) {
      expect(entry.message, `${dir}:${key}`).toBeTruthy()
    }
  })
})
