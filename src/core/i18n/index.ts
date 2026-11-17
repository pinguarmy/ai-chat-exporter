import type { MessageKey } from './locales/en'
import { KEYS, VALUES as ENGLISH_VALUES } from './generated/en'

export type { MessageKey }

export type Locale = 'en' | 'zh-CN' | 'zh-TW' | 'de' | 'ja' | 'ko'

type Dictionary = Record<MessageKey, string>
type Values = readonly string[]

/**
 * Catalogue loading model
 * -----------------------
 * The per-locale source files in `./locales` are compiled by
 * `scripts/generate-i18n-chunks.mjs` into `./generated`: English ships with
 * every entry point (key text once, plus English copy), and each other locale
 * is a values-only JSON asset fetched by `loadLocale()`. Plain assets (rather
 * than bundler JS chunks) work in every extension context, including the
 * Firefox background page, and stay raw UTF-8.
 * Pages await `loadLocale()` while they load settings, before first render.
 * Until a locale is present, `t()`/`tDynamic()` answer in English, and a fetch
 * that fails leaves English in place instead of throwing.
 *
 * zh-CN and zh-TW are complete (enforced by the locale types). de, ja and ko
 * are deliberately partial and inherit the English copy key by key, so a newly
 * introduced key never renders as its internal lookup key.
 *
 * Entry points that render no UI (the content scripts) must not import this
 * module; `scripts/verify-build.js` fails the build if they do.
 */
// The WXT build copies `./generated/*.catalog` to `<extension root>/catalogs/`
// (see wxt.config.ts). They are addressed by that fixed path rather than through
// bundler-processed `new URL(..., import.meta.url)` references because Vite
// inlines every asset into library-mode bundles (the background worker), which
// would embed all catalogues as base64 in the worker script.
const LOCALE_CATALOGS = new Set<Exclude<Locale, 'en'>>(['zh-CN', 'zh-TW', 'de', 'ja', 'ko'])

function localeUrl(locale: Exclude<Locale, 'en'>): URL {
  return new URL(`/catalogs/${locale}.catalog`, globalThis.location.href)
}

async function fetchLocaleValues(locale: Exclude<Locale, 'en'>): Promise<unknown> {
  const response = await fetch(localeUrl(locale))
  if (!response.ok) throw new Error(`Locale ${locale} unavailable`)
  return response.json()
}

let source: (locale: Exclude<Locale, 'en'>) => Promise<unknown> = fetchLocaleValues

/** Test seam: replace how locale catalogues are read; pass nothing to restore fetch. */
export function setLocaleSource(read?: (locale: Exclude<Locale, 'en'>) => Promise<unknown>): void {
  source = read ?? fetchLocaleValues
}

const loaded: Partial<Record<Locale, Values>> = {}
const pending = new Map<Locale, Promise<void>>()
let keyIndex: Map<string, number> | undefined

function indexOfKey(key: string): number | undefined {
  if (!keyIndex) keyIndex = new Map(KEYS.map((name, index) => [name, index]))
  return keyIndex.get(key)
}

/** Whether the locale's catalogue is available synchronously. English always is. */
export function isLocaleLoaded(locale: Locale | undefined): boolean {
  return !locale || locale === 'en' || loaded[locale] !== undefined
}

/**
 * Make a locale's catalogue available to `t()`/`tDynamic()`. Never rejects:
 * an unknown locale or a failed chunk load resolves with English still in
 * effect, and a later call retries a failed load.
 */
export function loadLocale(locale: Locale | undefined): Promise<void> {
  if (isLocaleLoaded(locale)) return Promise.resolve()
  const target = locale as Exclude<Locale, 'en'>
  const existing = pending.get(target)
  if (existing) return existing
  if (!LOCALE_CATALOGS.has(target)) return Promise.resolve()
  const attempt = (async () => {
    try {
      const values = await source(target)
      if (Array.isArray(values) && values.every(value => typeof value === 'string')) {
        loaded[target] = values
      }
    } catch {
      // Keep English; the page stays usable and the next load retries.
    } finally {
      pending.delete(target)
    }
  })()
  pending.set(target, attempt)
  return attempt
}

function lookup(index: number, locale: Locale): string {
  const translated = locale === 'en' ? undefined : loaded[locale]?.[index]
  return translated || ENGLISH_VALUES[index] || KEYS[index]
}

/**
 * Fully resolved catalogue for a locale, English fallback applied, for the
 * locales currently loaded (others resolve to English). For tooling and tests;
 * UI code calls `t()`.
 */
export function getDictionary(locale: Locale): Dictionary {
  const out: Record<string, string> = {}
  KEYS.forEach((key, index) => {
    out[key] = lookup(index, locale)
  })
  return out as Dictionary
}

function interpolate(template: string, args: Array<string | number>): string {
  let str = template
  args.forEach((arg, index) => {
    str = str.replace(new RegExp(`\\{${index}\\}`, 'g'), String(arg))
  })
  return str
}

/** Translate a catalogue key. Unknown keys are a compile error; use `tDynamic` for runtime strings. */
export function t(key: MessageKey, locale: Locale, ...args: Array<string | number>): string {
  return tDynamic(key, locale, ...args)
}

/**
 * Escape hatch for keys that are not known at compile time (for example text
 * coming from another module). Falls back to English, then to the key itself.
 */
export function tDynamic(key: string, locale: Locale, ...args: Array<string | number>): string {
  const index = indexOfKey(key)
  const str = index === undefined ? key : lookup(index, locale)
  return args.length > 0 ? interpolate(str, args) : str
}

/** Browser locale tag used for date formatting in generated exports. */
export function localeTag(locale: Locale | undefined): string {
  const tags: Partial<Record<Locale, string>> = {
    'zh-CN': 'zh-CN',
    'zh-TW': 'zh-TW',
    de: 'de-DE',
    ja: 'ja-JP',
    ko: 'ko-KR'
  }
  return tags[locale ?? 'en'] ?? 'en-US'
}
