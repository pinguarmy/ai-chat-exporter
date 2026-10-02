import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { STRINGS, type Locale } from '../src/lib/i18n'
import { SNAPSHOT_STRINGS } from '../src/lib/snapshot-i18n'

const locales: Locale[] = ['en', 'zh-CN', 'zh-TW', 'de', 'ja', 'ko']
const files = ['src/components/PageSnapshotPanel.tsx', 'src/tabs/preview.tsx', 'src/tabs/recovery.tsx', 'src/lib/page-snapshot.ts']
const root = process.cwd()

describe('snapshot and recovery translations', () => {
  it('covers every literal T/t call in the snapshot panel, preview, recovery and snapshot generator', () => {
    for (const file of files) {
      const source = readFileSync(`${root}/${file}`, 'utf8')
      const keys = [...source.matchAll(/\b(?:T|t)\(\s*(['"])((?:\\.|(?!\1).)*?)\1/g)].map(match => match[2].replaceAll("\\'", "'"))
      for (const key of keys) for (const locale of locales) {
        expect(STRINGS[locale][key], `${file}: ${locale} missing ${key}`).toBeTruthy()
        if (locale !== 'en' && key in SNAPSHOT_STRINGS.en) {
          expect(STRINGS[locale][key], `${locale} copied English: ${key}`).not.toBe(key)
        }
      }
    }
  })
})
