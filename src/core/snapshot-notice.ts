import type { SnapshotMetadata } from './types'
import { t, type Locale } from './i18n'

// Kept apart from `page-snapshot.ts` on purpose: that module is bundled into the
// content scripts, which must not pull in the UI message catalogue.

export function snapshotNotice(snapshot: SnapshotMetadata, locale: Locale = 'en'): string {
  const time = new Date(snapshot.capturedAt).toISOString()
  const share = snapshot.share
    ? ` ${t('Heuristic safe-share: {0} redactions; review for remaining sensitive information.', locale, snapshot.share.redactionCount)}`
    : ''
  if (locale === 'zh-CN')
    return `页面快照 · 捕获于 ${time}。仅包含此次捕获时页面已加载、可读取的会话内容，未验证完整历史。未加载消息及外部附件内容可能不包含在内。${snapshot.generationState === 'generating' ? '回答在捕获时仍在生成。' : ''}${snapshot.generationState === 'unknown' ? '捕获时的生成状态未知。' : ''}${share}`
  if (locale === 'zh-TW')
    return `頁面快照 · 擷取於 ${time}。僅包含此次擷取時頁面已載入、可讀取的對話內容，未驗證完整歷史。未載入訊息及外部附件內容可能不包含在內。${snapshot.generationState === 'generating' ? '回答在擷取時仍在生成。' : ''}${snapshot.generationState === 'unknown' ? '擷取時的生成狀態未知。' : ''}${share}`
  return `${t('Page snapshot · captured at {0}. Includes only conversation content loaded and readable on this page at capture time; complete history has not been verified. Unloaded messages and external attachment contents may be absent.', locale, time)}${snapshot.generationState === 'generating' ? ` ${t('The answer was still generating at capture time.', locale)}` : ''}${snapshot.generationState === 'unknown' ? ` ${t('Generation status at capture time is unknown.', locale)}` : ''}${share}`
}
