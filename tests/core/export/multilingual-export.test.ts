import { describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { unzipSync, strFromU8 } from 'fflate'
import { conversationToMarkdown, generateMarkdownFilename } from '../../../src/core/export-markdown'
import { buildArchive } from '../../../src/core/export-archive'
import { generateFilename, sanitizeFilename, utf8ByteLength } from '../../../src/core/filename'
import {
  markdownOptions,
  multilingualConversation,
  multilingualEntries
} from '../../helpers/multilingual-corpus'
import '../../helpers/i18n-catalogs'

const strictUtf8 = new TextDecoder('utf-8', { fatal: true })

/** Windows-invalid characters plus names Windows refuses regardless of extension. */
// eslint-disable-next-line no-control-regex -- the Windows-invalid set includes control characters
const WINDOWS_INVALID = /[<>:"/\\|?*\u0000-\u001f]/

describe('multilingual corpus', () => {
  it('covers every script family the maintainers asked about', () => {
    const ids = multilingualEntries.map(entry => entry.id)
    for (const required of [
      'zh-hans',
      'zh-hant',
      'ja',
      'ko',
      'ar',
      'he',
      'rtl-mixed',
      'hi',
      'th',
      'ru',
      'vi',
      'el',
      'emoji',
      'nfd',
      'zwj-zwnj',
      'fullwidth',
      'math',
      'code-nonascii'
    ]) {
      expect(ids).toContain(required)
    }
    for (const entry of multilingualEntries) {
      for (const needle of entry.needles) {
        expect(entry.title + entry.user + entry.assistant, `${entry.id}: ${needle}`).toContain(
          needle
        )
      }
    }
  })

  describe.each(multilingualEntries)('$id ($label)', entry => {
    const conversation = multilingualConversation(entry)

    it('exports Markdown as valid UTF-8 that round-trips byte-for-byte', () => {
      const markdown = conversationToMarkdown(conversation, markdownOptions)
      const bytes = new TextEncoder().encode(markdown)
      expect(strictUtf8.decode(bytes)).toBe(markdown)
      expect(markdown).not.toContain('�')
      // Blob is what the extension actually hands to chrome.downloads.
      expect(markdown.startsWith('\uFEFF')).toBe(false)
      for (const needle of entry.needles) expect(markdown).toContain(needle)
      expect(markdown).toContain(entry.title)
      // The message body is reproduced verbatim, so its normalization form
      // (NFC/NFD) and invisible joiners are untouched.
      expect(markdown).toContain(entry.assistant)
      expect(markdown).toContain(entry.user)
      if (entry.nfd) expect(markdown.includes(entry.assistant.normalize('NFC'))).toBe(false)
    })

    it('keeps headings and code fences intact', () => {
      const markdown = conversationToMarkdown(conversation, markdownOptions)
      const fences = (entry.assistant.match(/^```/gm) ?? []).length
      expect((markdown.match(/^```/gm) ?? []).length).toBe(fences)
      expect(fences % 2).toBe(0)
      const heading = entry.assistant.split('\n').find(line => line.startsWith('## '))
      expect(heading).toBeTruthy()
      expect(markdown).toContain(`\n${heading}\n`)
    })

    it('produces a valid, Unicode-preserving filename on Windows, macOS and Linux', () => {
      for (const name of [
        sanitizeFilename(entry.title),
        generateFilename('{date}-{title}-{id}', conversation),
        generateMarkdownFilename(conversation).replace(/\.md$/, '')
      ]) {
        expect(name.length).toBeGreaterThan(0)
        expect(WINDOWS_INVALID.test(name)).toBe(false)
        expect(/[\s.]$/.test(name)).toBe(false)
        expect(name.startsWith('.')).toBe(false)
        expect(utf8ByteLength(name)).toBeLessThanOrEqual(200)
        // Well-formed UTF-16 (no lone surrogates) and no bidi spoofing controls.
        expect(name.isWellFormed()).toBe(true)
        expect(/[\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/.test(name)).toBe(false)
        // Unicode is preserved, not transliterated to underscores or '?'.
        expect(name).not.toMatch(/[?_]/)
      }
      // The title's letters survive; only separators change.
      const letters = (text: string) => text.replace(/[\s\u200B-\u200F-]/g, '')
      expect(letters(sanitizeFilename(entry.title))).toBe(
        letters(
          // eslint-disable-next-line no-control-regex -- the Windows-invalid set includes control characters
          entry.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/[\s.]+$/, '')
        ).replace(/^\.+/, '')
      )
    })

    it('builds a ZIP whose names and contents decode with standard tools', async () => {
      vi.stubGlobal('crypto', webcrypto)
      try {
        const { bytes } = await buildArchive(
          conversation,
          { ...markdownOptions, exportArtifacts: true },
          'test',
          Date.UTC(2026, 0, 2)
        )
        const files = unzipSync(bytes)
        const asset = Object.keys(files).find(name => name.startsWith('assets/'))
        expect(asset).toBe(`assets/1-${sanitizeFilename(entry.title)}.txt`)
        expect(strFromU8(files[asset!])).toBe(entry.assistant)
        const markdown = strFromU8(files['conversation.md'])
        expect(strictUtf8.decode(files['conversation.md'])).toBe(markdown)
        for (const needle of entry.needles) expect(markdown).toContain(needle)
        const manifest = JSON.parse(strFromU8(files['manifest.json']))
        expect(manifest.conversation_id).toBe(conversation.id)
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })
})

/** Parse the central directory so tests assert on the raw ZIP header bytes. */
function centralDirectory(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = bytes.length - 22
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--
  const count = view.getUint16(end + 10, true)
  let offset = view.getUint32(end + 16, true)
  const entries: Array<{ name: string; flags: number; madeBy: number; attrs: number }> = []
  for (let index = 0; index < count; index++) {
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    entries.push({
      name: new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength)),
      flags: view.getUint16(offset + 8, true),
      madeBy: view.getUint16(offset + 4, true) >> 8,
      attrs: view.getUint32(offset + 38, true)
    })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

describe('multilingual ZIP headers', () => {
  it('flags non-ASCII entry names as UTF-8 and marks the archive Unix-made', async () => {
    vi.stubGlobal('crypto', webcrypto)
    try {
      const entry = multilingualEntries.find(item => item.id === 'ja')!
      const { bytes } = await buildArchive(
        multilingualConversation(entry),
        { ...markdownOptions, exportArtifacts: true },
        'test'
      )
      const entries = centralDirectory(bytes)
      const asset = entries.find(item => item.name.startsWith('assets/'))!
      expect(asset.name).toContain('日本語')
      // Bit 11: the name is UTF-8. Without it, Windows/macOS show mojibake.
      expect(asset.flags & 0x800).toBe(0x800)
      // Host "Unix" (3): Info-ZIP `unzip` re-decodes MS-DOS-host names through
      // the OEM code page even when bit 11 is set, which corrupted CJK names.
      for (const item of entries) {
        expect(item.madeBy).toBe(3)
        expect(item.attrs >>> 16).toBe(0o100644)
      }
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('multilingual filename truncation', () => {
  const clusters = ['日本語の', '한국어', '👨\u200D👩\u200D👧\u200D👦', '🇯🇵', '👍🏽', 'e\u0301', 'क्ष']

  it.each([
    ['CJK (3 bytes each)', '日本語のタイトル'.repeat(40)],
    ['emoji ZWJ families (25 bytes each)', '👨\u200D👩\u200D👧\u200D👦'.repeat(40)],
    ['flags (8 bytes each)', '🇯🇵🇺🇸🇩🇪'.repeat(30)],
    ['NFD accents', 'cafe\u0301 re\u0301sume\u0301 '.repeat(40)],
    ['Thai with combining marks', 'ก่า้'.repeat(80)],
    ['Devanagari conjuncts', 'क्षत्रज्ञ '.repeat(40)],
    ['Arabic with harakat', 'بِسْمِ اللَّهِ '.repeat(40)]
  ])('never splits a character when truncating %s', (_label, title) => {
    const name = sanitizeFilename(title)
    expect(utf8ByteLength(name)).toBeLessThanOrEqual(200)
    expect(name.length).toBeGreaterThan(0)
    expect(name.isWellFormed()).toBe(true)
    // No lone combining mark, variation selector, modifier or joiner at either edge.
    // eslint-disable-next-line no-misleading-character-class -- asserting on lone combining marks/joiners
    expect(name).not.toMatch(/^[\p{M}\u200C\u200D\uFE0F\u{1F3FB}-\u{1F3FF}]/u)
    expect(name).not.toMatch(/[\u200C\u200D]$/)
    // What is left is a prefix of the (separator-normalized) input.
    const source = title.replace(/\s+/g, '-')
    expect(source.startsWith(name)).toBe(true)
    // And it is the longest such prefix on a character boundary.
    const rest = source.slice(name.length).replace(/^-+/, '')
    const next = Array.from(
      new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(rest),
      part => part.segment
    )[0]
    if (next) expect(utf8ByteLength(`${name}-${next}`)).toBeGreaterThan(200)
  })

  it('does not depend on Intl.Segmenter being available', () => {
    const original = Object.getOwnPropertyDescriptor(Intl, 'Segmenter')!
    // Simulate an engine without grapheme segmentation.
    Object.defineProperty(Intl, 'Segmenter', { ...original, value: undefined })
    try {
      for (const title of [
        '👨\u200D👩\u200D👧\u200D👦'.repeat(40),
        '🇯🇵🇺🇸🇩🇪'.repeat(30),
        'cafe\u0301 '.repeat(60),
        '👍🏽'.repeat(60)
      ]) {
        const name = sanitizeFilename(title)
        expect(utf8ByteLength(name)).toBeLessThanOrEqual(200)
        expect(name.isWellFormed()).toBe(true)
        // eslint-disable-next-line no-misleading-character-class -- asserting on lone combining marks/joiners
        expect(name).not.toMatch(/[\u200D\uFE0F\u0301]$/u)
        // A skin-tone modifier is only ever kept together with its base.
        expect(name.replace(/\u{1F44D}\u{1F3FD}/gu, '')).not.toMatch(/[\u{1F3FB}-\u{1F3FF}]/u)
        // Whole clusters only: the count of regional indicators stays even.
        expect(Array.from(name.match(/[\u{1F1E6}-\u{1F1FF}]/gu) ?? []).length % 2).toBe(0)
        expect(name).not.toMatch(/\u{1F468}$/u)
      }
    } finally {
      Object.defineProperty(Intl, 'Segmenter', original)
    }
  })

  it('keeps the id token when a long CJK title would overflow the byte budget', () => {
    const conversation = {
      ...multilingualConversation(multilingualEntries[0]),
      id: 'abcdef123456',
      title: '很长的标题'.repeat(60)
    }
    const name = generateFilename('{date}-{title}-{id}', conversation)
    expect(utf8ByteLength(name)).toBeLessThanOrEqual(200)
    expect(name.endsWith('-abcdef12')).toBe(true)
    expect(name.startsWith('2026-01-02-很长的标题')).toBe(true)
    expect(name.isWellFormed()).toBe(true)
  })

  it('drops unpaired surrogates and bidi controls but keeps ZWJ/ZWNJ spelling', () => {
    expect(sanitizeFilename('ab\uD83Dcd\uDE00ef')).toBe('abcdef')
    expect(sanitizeFilename('\u202Egpj.exe\u202C')).toBe('gpj.exe')
    expect(sanitizeFilename('\u200Fشرح\u200E')).toBe('شرح')
    // Persian ZWNJ, Indic ZWJ and emoji ZWJ sequences are orthography.
    expect(sanitizeFilename('می\u200Cخواهم')).toBe('می\u200Cخواهم')
    expect(sanitizeFilename('क्\u200Dष')).toBe('क्\u200Dष')
    expect(sanitizeFilename('👩\u200D💻 notes')).toBe('👩\u200D💻-notes')
    // Stray, doubled or edge joiners are not.
    expect(sanitizeFilename('a\u200D\u200Cb')).toBe('a\u200Db')
    expect(sanitizeFilename('\u200Dab\u200C')).toBe('ab')
    expect(sanitizeFilename('a \u200Cb')).toBe('a-b')
  })

  it.each(clusters)('is stable for the short cluster %s', cluster => {
    expect(sanitizeFilename(cluster)).toBe(cluster)
  })
})
