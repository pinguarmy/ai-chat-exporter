import { en, type MessageKey } from './locales/en'
import { zhCN } from './locales/zh-CN'
import { zhTW } from './locales/zh-TW'
import { de } from './locales/de'
import { ja } from './locales/ja'
import { ko } from './locales/ko'

export type { MessageKey }

export type Locale = 'en' | 'zh-CN' | 'zh-TW' | 'de' | 'ja' | 'ko'

type Dictionary = Record<MessageKey, string>

/**
 * zh-CN and zh-TW are complete (enforced by their types). de, ja and ko are
 * deliberately partial and inherit the complete English catalogue. This keeps
 * less-frequent error/status copy readable while the translated product
 * surface remains complete, and it prevents a newly introduced key from ever
 * rendering as its internal lookup key.
 */
const withEnglishFallback = (overrides: Partial<Dictionary>): Dictionary => ({
  ...en,
  ...overrides,
})

export const STRINGS: Record<Locale, Dictionary> = {
  en,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  de: withEnglishFallback(de),
  ja: withEnglishFallback(ja),
  ko: withEnglishFallback(ko),
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
  const strings = STRINGS as Record<Locale, Record<string, string> | undefined>
  const str = strings[locale]?.[key] ?? strings.en?.[key] ?? key
  return args.length > 0 ? interpolate(str, args) : str
}

/** Browser locale tag used for date formatting in generated exports. */
export function localeTag(locale: Locale | undefined): string {
  const tags: Partial<Record<Locale, string>> = {
    'zh-CN': 'zh-CN',
    'zh-TW': 'zh-TW',
    de: 'de-DE',
    ja: 'ja-JP',
    ko: 'ko-KR',
  }
  return tags[locale ?? 'en'] ?? 'en-US'
}
