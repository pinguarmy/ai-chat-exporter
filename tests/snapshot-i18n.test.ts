import { describe, expect, it } from 'vitest'
import { STRINGS, t, type Locale, type MessageKey } from '../src/lib/i18n'
import { snapshot } from '../src/lib/i18n/locales/en'

const locales: Locale[] = ['en', 'zh-CN', 'zh-TW', 'de', 'ja', 'ko']
const snapshotKeys = Object.keys(snapshot) as MessageKey[]

describe('snapshot and recovery translations', () => {
  // Every literal key used by the snapshot panel, preview, recovery page and snapshot
  // generator is checked against `MessageKey` by the type checker (`npm run lint`);
  // these tests cover what the compiler cannot: the resolved copy in each locale.
  it('has a catalogue of snapshot and recovery copy', () => {
    expect(snapshotKeys.length).toBeGreaterThan(0)
  })

  it('resolves every snapshot and recovery key in every locale', () => {
    for (const key of snapshotKeys) for (const locale of locales) {
      expect(STRINGS[locale][key], `${locale} missing ${key}`).toBeTruthy()
      expect(t(key, locale), `${locale} missing ${key}`).toBeTruthy()
    }
  })

  it('never copies English into a non-English locale', () => {
    for (const key of snapshotKeys) for (const locale of locales) {
      if (locale === 'en') continue
      expect(STRINGS[locale][key], `${locale} copied English: ${key}`).not.toBe(STRINGS.en[key])
    }
  })
})
