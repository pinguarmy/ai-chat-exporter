import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { en } from '../../../src/core/i18n/locales/en'
import { zhCN } from '../../../src/core/i18n/locales/zh-CN'
import { zhTW } from '../../../src/core/i18n/locales/zh-TW'
import { de } from '../../../src/core/i18n/locales/de'
import { ja } from '../../../src/core/i18n/locales/ja'
import { ko } from '../../../src/core/i18n/locales/ko'
import type { Locale } from '../../../src/core/i18n'
import { buildChunks } from '../../../scripts/generate-i18n-chunks.mjs'

type I18n = typeof import('../../../src/core/i18n')
type Source = Parameters<I18n['setLocaleSource']>[0]

const generatedDir = resolve(__dirname, '../../../src/core/i18n/generated')
const readCatalogue = (locale: string) =>
  JSON.parse(readFileSync(resolve(generatedDir, `${locale}.catalog`), 'utf8'))

const LOCALES: Locale[] = ['en', 'zh-CN', 'zh-TW', 'de', 'ja', 'ko']
const overrides: Record<Locale, Record<string, string>> = {
  en,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  de,
  ja,
  ko
}

/** A fresh module instance, so nothing loaded by another test leaks in. */
async function freshI18n(source?: Source): Promise<I18n> {
  vi.resetModules()
  const module = await import('../../../src/core/i18n')
  module.setLocaleSource(source ?? (async locale => readCatalogue(locale)))
  return module
}

const KEY = 'Visible messages' as const

describe('locale catalogue loading', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('answers in English until a locale is loaded, then in that locale', async () => {
    const i18n = await freshI18n()
    expect(i18n.isLocaleLoaded('zh-CN')).toBe(false)
    expect(i18n.t(KEY, 'zh-CN')).toBe(en[KEY])
    expect(i18n.tDynamic('Unknown message', 'zh-CN')).toBe('Unknown message')

    await i18n.loadLocale('zh-CN')

    expect(i18n.isLocaleLoaded('zh-CN')).toBe(true)
    expect(i18n.t(KEY, 'zh-CN')).toBe(zhCN[KEY])
    // Other locales are untouched by loading one.
    expect(i18n.isLocaleLoaded('de')).toBe(false)
    expect(i18n.t(KEY, 'de')).toBe(en[KEY])
  })

  it('treats English and a missing locale as always loaded without reading anything', async () => {
    const source = vi.fn(async () => [])
    const i18n = await freshI18n(source)
    await i18n.loadLocale('en')
    await i18n.loadLocale(undefined)
    expect(i18n.isLocaleLoaded('en')).toBe(true)
    expect(source).not.toHaveBeenCalled()
  })

  it('shares one read between concurrent loads and reads each locale once', async () => {
    const source = vi.fn(async (locale: string) => readCatalogue(locale))
    const i18n = await freshI18n(source)
    await Promise.all([i18n.loadLocale('ja'), i18n.loadLocale('ja'), i18n.loadLocale('ja')])
    await i18n.loadLocale('ja')
    expect(source).toHaveBeenCalledTimes(1)
  })

  it('falls back to English, without throwing, when the catalogue cannot be read', async () => {
    const i18n = await freshI18n(async () => {
      throw new Error('chunk missing')
    })
    await expect(i18n.loadLocale('ko')).resolves.toBeUndefined()
    expect(i18n.isLocaleLoaded('ko')).toBe(false)
    expect(i18n.t(KEY, 'ko')).toBe(en[KEY])
    expect(i18n.t('Failed: {0}', 'ko', 'x')).toBe('Failed: x')
  })

  it('retries after a failed read instead of caching the failure', async () => {
    let fail = true
    const source = vi.fn(async (locale: string) => {
      if (fail) throw new Error('offline')
      return readCatalogue(locale)
    })
    const i18n = await freshI18n(source)
    await i18n.loadLocale('de')
    expect(i18n.isLocaleLoaded('de')).toBe(false)
    fail = false
    await i18n.loadLocale('de')
    expect(i18n.isLocaleLoaded('de')).toBe(true)
    expect(source).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['not an array', { nope: true }],
    ['non-string entries', [1, 2, 3]],
    ['null', null]
  ])('ignores a malformed catalogue (%s) and keeps English', async (_name, payload) => {
    const i18n = await freshI18n(async () => payload)
    await i18n.loadLocale('zh-TW')
    expect(i18n.isLocaleLoaded('zh-TW')).toBe(false)
    expect(i18n.t(KEY, 'zh-TW')).toBe(en[KEY])
  })

  it('treats an unknown locale value from storage as English', async () => {
    const i18n = await freshI18n()
    await expect(i18n.loadLocale('xx' as Locale)).resolves.toBeUndefined()
    expect(i18n.t(KEY, 'xx' as Locale)).toBe(en[KEY])
  })

  it('does not look up inherited object properties as catalogue keys', async () => {
    const i18n = await freshI18n()
    expect(i18n.tDynamic('constructor', 'en')).toBe('constructor')
    expect(i18n.tDynamic('toString', 'en')).toBe('toString')
  })
})

describe('resolved catalogue equals the authored sources', () => {
  // The shipped form (key index + values) must resolve exactly like the
  // authored per-locale files: English values, and for every other locale its
  // own value, else the English one.
  it.each(LOCALES)('%s resolves every key like its source file', async locale => {
    const i18n = await freshI18n()
    await i18n.loadLocale(locale)
    const resolved = i18n.getDictionary(locale)
    const keys = Object.keys(en)
    expect(Object.keys(resolved)).toEqual(keys)
    for (const key of keys) {
      const expected = overrides[locale][key] ?? (en as Record<string, string>)[key]
      expect(resolved[key as keyof typeof resolved], `${locale}: ${key}`).toBe(expected)
      expect(i18n.tDynamic(key, locale)).toBe(expected)
    }
  })

  it('keeps the committed generated files in sync with the locale sources', () => {
    const chunks: Record<string, string> = buildChunks()
    expect(readdirSync(generatedDir).sort()).toEqual(Object.keys(chunks).sort())
    for (const [name, contents] of Object.entries(chunks)) {
      expect(
        readFileSync(resolve(generatedDir, name), 'utf8'),
        `${name} is stale; run npm run i18n:generate`
      ).toBe(contents)
    }
  })

  it('ships each locale as a values-only array aligned with the English keys', () => {
    const keyCount = Object.keys(en).length
    for (const locale of LOCALES.filter(candidate => candidate !== 'en')) {
      const values = readCatalogue(locale)
      expect(values).toHaveLength(keyCount)
      expect(values.every((value: unknown) => typeof value === 'string')).toBe(true)
    }
    // English key text lives only in the English module, never in a locale file.
    const zh = readFileSync(resolve(generatedDir, 'zh-CN.catalog'), 'utf8')
    expect(zh).not.toContain('Export diagnostics')
  })
})
