import { describe, expect, it } from 'vitest'
import { conversationToHtml } from '../../../src/core/export-html'
import { conversationToMarkdown } from '../../../src/core/export-markdown'
import { STRINGS, t, type Locale } from '../../../src/core/i18n'
import type { Conversation, ExportOptions } from '../../../src/core/types'

const LOCALES: Locale[] = ['en', 'zh-CN', 'zh-TW', 'de', 'ja', 'ko']

const snapshotConversation: Conversation = {
  id: 'c',
  title: 'Snapshot',
  platform: 'claude',
  url: '',
  messages: [
    {
      id: 'm',
      role: 'assistant',
      content: 'Result',
      attachments: [
        { type: 'image', name: '', url: '' },
        { type: 'image', name: 'Remote', url: 'https://example.invalid/a.png' },
      ],
    },
  ],
  snapshot: {
    kind: 'page-snapshot',
    captureId: 'capture',
    capturedAt: 1,
    scope: 'observed-dom',
    generationState: 'idle',
  },
}

const baseOptions: ExportOptions = {
  format: 'markdown',
  includeMetadata: true,
  includeImages: true,
  includeCodeBlocks: true,
  exportArtifacts: true,
}

describe('exported-document image labels', () => {
  it('keeps the English Markdown bullets byte-identical', () => {
    const markdown = conversationToMarkdown(snapshotConversation, baseOptions)
    expect(markdown).toContain('- Image attachment (image omitted)')
    expect(markdown).toContain('- Remote (external image content is not embedded)')
    const disabled = conversationToMarkdown(snapshotConversation, { ...baseOptions, includeImages: false })
    expect(disabled).toContain('- Remote (image omitted)')
  })

  it('keeps the English HTML snapshot labels identical', () => {
    const html = conversationToHtml(snapshotConversation, { ...baseOptions, format: 'pdf' })
    expect(html).toContain('Image attachment (image omitted)')
    expect(html).toContain('Remote (external image content is not embedded)')
  })

  it('translates the snapshot bullets for a non-English locale', () => {
    const markdown = conversationToMarkdown(snapshotConversation, { ...baseOptions, locale: 'de' })
    expect(markdown).toContain('- Bildanhang (Bild ausgelassen)')
    expect(markdown).toContain('- Remote (externer Bildinhalt nicht eingebettet)')
    expect(markdown).not.toContain('image omitted')
    const html = conversationToHtml(snapshotConversation, { ...baseOptions, format: 'pdf', locale: 'ja' })
    expect(html).toContain('画像添付 (画像は省略されました)')
  })
})

describe('Platform label', () => {
  it('is translated for every locale and used in exported Markdown', () => {
    const labels = new Map(LOCALES.map(locale => [locale, t('Platform', locale)]))
    expect(labels.get('en')).toBe('Platform')
    expect(labels.get('de')).toBe('Plattform')
    expect(labels.get('ja')).toBe('プラットフォーム')
    expect(labels.get('ko')).toBe('플랫폼')
    for (const locale of LOCALES.filter(locale => locale !== 'en')) expect(labels.get(locale)).not.toBe('Platform')
    const markdown = conversationToMarkdown(snapshotConversation, { ...baseOptions, locale: 'ko' })
    expect(markdown).toContain('- **플랫폼:**')
  })
})

describe('new catalogue keys', () => {
  const KEYS = [
    'Settings could not be saved.',
    'Settings could not be saved. Please retry.',
    'Image attachment',
    'image omitted',
    'external image content is not embedded',
    'image unavailable',
  ] as const

  it.each(KEYS)('%s has a translation in every non-English locale', key => {
    const english = STRINGS.en[key]
    expect(english).toBe(key)
    for (const locale of LOCALES.filter(locale => locale !== 'en')) {
      expect(STRINGS[locale][key], `${locale}: ${key}`).not.toBe(english)
    }
  })
})
