/**
 * QuickStartGuide behavior contract.
 *
 * First-use help is a native <details> disclosure: collapsed by default,
 * reopenable by pointer or keyboard, and free of any forced state (no
 * chrome.tabs side effects, no storage writes, no settings changes). Provider
 * links must be plain anchors with exact real URLs so users can inspect them,
 * and every supported locale must render translated copy without falling back
 * to English.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QuickStartGuide } from '../src/components/QuickStartGuide'
import { ONBOARDING_STRINGS } from '../src/lib/onboarding-i18n'
import type { Locale } from '../src/lib/i18n'

const PROVIDERS: ReadonlyArray<[name: string, href: string]> = [
  ['ChatGPT', 'https://chatgpt.com/'],
  ['Gemini', 'https://gemini.google.com/app'],
  ['Claude', 'https://claude.ai/'],
  ['DeepSeek', 'https://chat.deepseek.com/'],
  ['Grok', 'https://grok.com/'],
]

const ALL_LOCALES: Locale[] = ['en', 'zh-CN', 'zh-TW', 'de', 'ja', 'ko']

// Keys the guide itself renders; popup-side keys in the same module are
// covered by the i18n merge, not this component.
const GUIDE_KEYS = [
  'Quick start',
  '1. Open your chat',
  'Open a conversation on a supported site, then click the extension icon again.',
  '2. Choose a file',
  'PDF for reading or printing. Markdown for editing. ZIP for an archive with inline source files.',
  '3. Save and find it',
  'Files go to your browser download folder unless you choose another location in Settings.',
  'Preview lets you select messages or save only the last answer.',
  'No exporter account. Chats are processed in your browser; preview copies and optional recovery drafts use extension storage. External images may load from their original sites.',
]

function renderGuide(locale: Locale = 'en', initialOpen?: boolean) {
  const view = render(<QuickStartGuide locale={locale} initialOpen={initialOpen} />)
  const details = view.container.querySelector('details.quick-start-guide') as HTMLDetailsElement
  return { view, details }
}

describe('QuickStartGuide disclosure behavior', () => {
  it('renders collapsed by default with content recoverable via the summary', () => {
    const { details } = renderGuide()
    expect(details.open).toBe(false)
    const summary = screen.getByText('Quick start')
    expect(summary.tagName).toBe('SUMMARY')
    fireEvent.click(summary)
    expect(details.open).toBe(true)
    fireEvent.click(summary)
    expect(details.open).toBe(false)
  })

  it('opens natively from the keyboard-focusable summary', () => {
    const { details } = renderGuide()
    const summary = screen.getByText('Quick start')
    summary.focus()
    expect(document.activeElement).toBe(summary)
    fireEvent.click(summary)
    expect(details.open).toBe(true)
  })

  it('respects initialOpen without blocking toggling', () => {
    const { details } = renderGuide('en', true)
    expect(details.open).toBe(true)
    fireEvent.click(screen.getByText('Quick start'))
    expect(details.open).toBe(false)
  })

  it('performs no browser side effects when rendered', () => {
    const tabsCreate = vi.fn()
    ;(globalThis as { chrome?: unknown }).chrome = { tabs: { create: tabsCreate } }
    try {
      renderGuide('en', true)
      expect(tabsCreate).not.toHaveBeenCalled()
    } finally {
      delete (globalThis as { chrome?: unknown }).chrome
    }
  })
})

describe('QuickStartGuide provider links', () => {
  it('lists exactly the five supported providers with real URLs and safe target/rel', () => {
    renderGuide('en', true)
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(5)
    links.forEach((link, index) => {
      expect(link).toHaveProperty('href', PROVIDERS[index][1])
      expect(link).toHaveProperty('target', '_blank')
      const rel = link.getAttribute('rel') ?? ''
      expect(rel).toContain('noopener')
      expect(rel).toContain('noreferrer')
      expect(link.textContent).toBe(PROVIDERS[index][0])
    })
  })
})

describe('QuickStartGuide locales', () => {
  it.each(ALL_LOCALES)('renders translated copy for %s with no English fallback leak', (locale) => {
    const { view } = renderGuide(locale, true)
    const strings = ONBOARDING_STRINGS[locale]
    expect(screen.getByText(strings['Quick start']).tagName).toBe('SUMMARY')
    const text = view.container.textContent ?? ''
    for (const key of GUIDE_KEYS) {
      expect(text).toContain(strings[key])
      if (locale !== 'en') {
        // No non-English locale may leak an untranslated English sentence.
        expect(strings[key]).not.toBe(ONBOARDING_STRINGS.en[key])
      }
    }
    // Provider names stay in Latin script in every locale.
    for (const [name] of PROVIDERS) {
      expect(text).toContain(name)
    }
  })
})

describe('ONBOARDING_STRINGS dictionary', () => {
  it('translates every key into all six locales without English leaks', () => {
    const keys = Object.keys(ONBOARDING_STRINGS.en)
    expect(keys.length).toBeGreaterThan(0)
    for (const locale of ALL_LOCALES) {
      for (const key of keys) {
        const value = ONBOARDING_STRINGS[locale][key]
        expect(value).toBeTruthy()
        if (locale !== 'en') {
          expect(value).not.toBe(ONBOARDING_STRINGS.en[key])
        }
      }
    }
  })

  it('keeps {n} placeholders consistent across locales', () => {
    for (const key of Object.keys(ONBOARDING_STRINGS.en)) {
      const expected = (ONBOARDING_STRINGS.en[key].match(/\{\d+\}/g) ?? []).sort()
      for (const locale of ALL_LOCALES) {
        const actual = (ONBOARDING_STRINGS[locale][key].match(/\{\d+\}/g) ?? []).sort()
        expect(actual).toEqual(expected)
      }
    }
  })
})
