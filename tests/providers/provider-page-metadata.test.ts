import { beforeEach, describe, expect, it } from 'vitest'
import {
  cleanDocumentTitle,
  extractPageCreatedAt,
  titleFromFirstMatch,
  titleFromMessageText
} from '../../src/providers/page-metadata'

describe('provider page metadata helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  describe('extractPageCreatedAt', () => {
    it('reads the first time[datetime] as epoch milliseconds', () => {
      document.body.innerHTML =
        '<time datetime="2026-01-02T03:04:05Z"></time><time datetime="2030-01-01T00:00:00Z"></time>'
      expect(extractPageCreatedAt()).toBe(Date.parse('2026-01-02T03:04:05Z'))
    })

    it('does not fall through to a later element when the first datetime is malformed', () => {
      document.body.innerHTML =
        '<time datetime="not-a-date"></time><time datetime="2026-01-02T03:04:05Z"></time>'
      expect(extractPageCreatedAt()).toBeUndefined()
    })

    it('returns undefined without a datetime attribute value', () => {
      document.body.innerHTML = '<time datetime=""></time><time>today</time>'
      expect(extractPageCreatedAt()).toBeUndefined()
    })

    it('can be scoped to a subtree', () => {
      document.body.innerHTML =
        '<time datetime="2020-01-01T00:00:00Z"></time><section><time datetime="2026-05-06T00:00:00Z"></time></section>'
      expect(extractPageCreatedAt(document.querySelector('section')!)).toBe(
        Date.parse('2026-05-06T00:00:00Z')
      )
    })
  })

  describe('cleanDocumentTitle', () => {
    it.each([
      ['Trip plan - ChatGPT', 'ChatGPT', 'Trip plan'],
      ['Trip plan – ChatGPT', 'ChatGPT', 'Trip plan'],
      ['Trip plan | Claude', 'Claude', 'Trip plan'],
      ['Trip plan - Claude extra', 'Claude', 'Trip plan'],
      ['Trip plan - gemini', 'Gemini', 'Trip plan'],
      ['Grok - Grok', 'Grok', null],
      ['a - b - DeepSeek', 'DeepSeek', 'a - b']
    ])('%s (%s) -> %s', (title, brand, expected) => {
      expect(cleanDocumentTitle(title, brand)).toBe(expected)
    })

    it('returns null for the bare brand, empty and missing titles', () => {
      expect(cleanDocumentTitle('ChatGPT', 'ChatGPT')).toBeNull()
      expect(cleanDocumentTitle('', 'ChatGPT')).toBeNull()
      expect(cleanDocumentTitle(undefined, 'ChatGPT')).toBeNull()
      expect(cleanDocumentTitle(null, 'ChatGPT')).toBeNull()
    })

    it('leaves a title that only mentions the brand without a separator untouched', () => {
      expect(cleanDocumentTitle('Why Claude is helpful', 'Claude')).toBe('Why Claude is helpful')
    })

    it('treats the brand literally, not as a pattern', () => {
      expect(cleanDocumentTitle('Notes - A.I. Chat', 'A.I. Chat')).toBe('Notes')
      expect(cleanDocumentTitle('Notes - AXIX Chat', 'A.I. Chat')).toBe('Notes - AXIX Chat')
    })
  })

  describe('titleFromMessageText', () => {
    it('returns short text unchanged', () => {
      expect(titleFromMessageText('Hello')).toBe('Hello')
    })

    it('keeps exactly 80 characters and truncates longer text with an ellipsis', () => {
      expect(titleFromMessageText('a'.repeat(80))).toBe('a'.repeat(80))
      expect(titleFromMessageText('a'.repeat(81))).toBe(`${'a'.repeat(80)}...`)
    })

    it('returns null for empty or missing text', () => {
      expect(titleFromMessageText('')).toBeNull()
      expect(titleFromMessageText(null)).toBeNull()
      expect(titleFromMessageText(undefined)).toBeNull()
    })
  })

  describe('titleFromFirstMatch', () => {
    it('uses the first matching element in document order', () => {
      document.body.innerHTML = '<p class="a">first</p><p class="b">second</p>'
      expect(titleFromFirstMatch('.b, .a')).toBe('first')
    })

    it('returns null when nothing matches or the match has no text', () => {
      expect(titleFromFirstMatch('.missing')).toBeNull()
      document.body.innerHTML = '<p class="a">   </p>'
      expect(titleFromFirstMatch('.a')).toBeNull()
    })
  })
})
