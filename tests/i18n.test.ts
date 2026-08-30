import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { STRINGS, localeTag, t, type Locale } from '../src/lib/i18n'

const locales: Locale[] = ['en', 'zh-CN', 'zh-TW', 'de', 'ja', 'ko']
const uiFiles = [
  'src/options.tsx',
  'src/popup.tsx',
  'src/tabs/preview.tsx',
  'src/components/FilenameEditor.tsx',
  'src/components/ExportOptionsPanel.tsx',
  'src/components/ConversationList.tsx',
]

describe('UI translations', () => {
  it('provides every English UI key in each supported locale', () => {
    const englishKeys = Object.keys(STRINGS.en)

    for (const locale of locales) {
      for (const key of englishKeys) {
        expect(STRINGS[locale][key], `${locale} is missing ${key}`).toBeTruthy()
      }
    }
  })

  it('resolves every literal UI translation key in the popup, options, and preview', () => {
    const keys = new Set(
      uiFiles.flatMap((file) => [
        ...[...readFileSync(resolve(__dirname, '..', file), 'utf8').matchAll(/\b(?:T|t|tr)\('([^']+)'/g)].map((match) => match[1]),
      ])
    )

    for (const locale of locales) {
      for (const key of keys) {
        expect(STRINGS[locale][key], `${locale} is missing ${key}`).toBeTruthy()
      }
    }
  })

  it('uses English as a fallback and interpolates complete scheduling labels', () => {
    expect(t('Minimum interval between starting detail reads for each provider ({0}s)', 'zh-CN', 5)).toBe('同一平台启动下一次对话详情读取前的最小间隔（5 秒）')
    expect(t('missing key', 'zh-TW')).toBe('missing key')
  })

  it('uses the correct browser locale for each added language', () => {
    expect(localeTag('de')).toBe('de-DE')
    expect(localeTag('ja')).toBe('ja-JP')
    expect(localeTag('ko')).toBe('ko-KR')
  })
})
