// @vitest-environment jsdom
/**
 * Keys that used to be passed through the untyped `tDynamic` escape hatch
 * (and therefore rendered in English for every locale) must resolve to a real
 * translation in every locale, and the UI surfaces that use them must render
 * the translated copy.
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FilenameEditor } from '../../../src/components/FilenameEditor'
import { conversationToMarkdown } from '../../../src/core/export-markdown'
import { t, type Locale, type MessageKey } from '../../../src/core/i18n'
import { STRINGS } from '../../helpers/i18n-catalogs'
import { en } from '../../../src/core/i18n/locales/en'
import { zhCN } from '../../../src/core/i18n/locales/zh-CN'
import { zhTW } from '../../../src/core/i18n/locales/zh-TW'
import { de } from '../../../src/core/i18n/locales/de'
import { ja } from '../../../src/core/i18n/locales/ja'
import { ko } from '../../../src/core/i18n/locales/ko'
import { PAGE_CHANGED } from '../../../src/platform/page-snapshot-capture'
import { FILENAME_OPTIONS, type Conversation } from '../../../src/core/types'

afterEach(cleanup)

const NON_ENGLISH: Locale[] = ['zh-CN', 'zh-TW', 'de', 'ja', 'ko']
const AUTHORED: Record<Locale, Partial<Record<MessageKey, string>>> = {
  en,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  de,
  ja,
  ko
}

const NEWLY_TYPED_KEYS: MessageKey[] = [
  'Image unavailable',
  PAGE_CHANGED,
  'Conversation Date (start)',
  'Conversation Date & Time (start)',
  'Export Date (YYYY-MM-DD)',
  'Conversation Date (start, alias)',
  'Conversation Date & Time (start, alias)',
  'Conversation Title',
  'Number (for bulk)',
  'Message Count',
  '{0} concurrent reads',
  'Download cancelled',
  'Could not delete temporary snapshot'
]

describe('previously untyped UI keys', () => {
  it.each(NON_ENGLISH)('%s authors its own translation for every newly typed key', locale => {
    for (const key of NEWLY_TYPED_KEYS) {
      const translated = AUTHORED[locale][key]
      expect(translated, `${locale}: ${key}`).toBeTruthy()
      expect(translated, `${locale}: ${key} must not be the English copy`).not.toBe(en[key])
      expect(STRINGS[locale][key]).toBe(translated)
    }
  })

  it('keeps the concurrency choice free of an English plural suffix slot', () => {
    expect(Object.keys(en).some(key => key.includes('concurrent read{1}'))).toBe(false)
    for (const locale of ['en', ...NON_ENGLISH] as Locale[]) {
      const rendered = t('{0} concurrent reads', locale, 3)
      expect(rendered).toContain('3')
      expect(rendered).not.toMatch(/\{\d\}/)
    }
  })
})

describe('FilenameEditor variable labels', () => {
  it('labels every filename variable chip with catalogue copy', () => {
    for (const option of FILENAME_OPTIONS) expect(option.label in en, option.label).toBe(true)
  })

  it.each(NON_ENGLISH)('renders translated chip labels for %s', locale => {
    render(<FilenameEditor value="{title}" onChange={() => {}} defaultOpen locale={locale} />)
    for (const option of FILENAME_OPTIONS) {
      const label = t(option.label, locale)
      const chip = screen.getByRole('button', { name: t('Insert {0}', locale, label) })
      expect(chip.getAttribute('title')).toBe(`${label}: ${option.example}`)
    }
    // The eight labels that used to be English-only now differ from English.
    for (const key of [
      'Conversation Date (start)',
      'Conversation Title',
      'Message Count'
    ] as MessageKey[]) {
      expect(screen.queryByRole('button', { name: t('Insert {0}', 'en', en[key]) })).toBeNull()
    }
  })

  it('keeps English labels for the English locale', () => {
    render(<FilenameEditor value="{title}" onChange={() => {}} defaultOpen locale="en" />)
    expect(screen.getByRole('button', { name: 'Insert Conversation Title' })).toBeTruthy()
  })
})

describe('exported Markdown image placeholder', () => {
  const conversation: Conversation = {
    id: 'c1',
    title: 'Images',
    url: 'https://chatgpt.com/c/c1',
    platform: 'chatgpt',
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'see image',
        attachments: [{ type: 'image', name: 'shot.png', url: '' }]
      }
    ]
  }
  const options = {
    format: 'markdown' as const,
    includeMetadata: true,
    includeCodeBlocks: true,
    includeImages: true
  }

  it.each(['en', ...NON_ENGLISH] as Locale[])('follows the export locale (%s)', locale => {
    const markdown = conversationToMarkdown(conversation, { ...options, locale })
    expect(markdown).toContain(`(${t('Image unavailable', locale)})`)
  })
})
