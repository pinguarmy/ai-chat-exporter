import { describe, expect, it } from 'vitest'
import { t, type Locale } from '../../src/core/i18n'
import { readCss } from '../helpers/read-css'

const css = readCss('options.css')
const layoutLocales: Locale[] = ['de', 'ja', 'ko']

describe('localized options layout guardrails', () => {
  it('renders the longest scheduled-export copy in every added locale', () => {
    const key =
      'Runs while Chrome and the extension are alive. Changing the interval above applies that rolling schedule to every enabled platform; individual platform settings can override it. A set time means at or shortly after it — never to the exact second.'

    for (const locale of layoutLocales) {
      const copy = t(key, locale)
      expect(copy, `${locale} should render scheduling guidance`).not.toBe(key)
      expect(copy).not.toContain('{0}')
    }
  })

  it('keeps localized rail content contained and reflows before narrow card widths', () => {
    expect(css).toMatch(/\.schedule-rail-cell\s*\{[\s\S]*?min-width:\s*0;/)
    expect(css).toMatch(/\.schedule-rail-value\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/)
    expect(css).toMatch(/\.options-card-header h2\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/)
    expect(css).toMatch(
      /@media \(max-width:\s*720px\)[\s\S]*?\.schedule-rail\s*\{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/
    )
  })
})
