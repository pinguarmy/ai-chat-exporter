import type { Locale } from './i18n'

const copy: Record<string, [string, string, string, string, string]> = {
  'No conversation open': ['尚未打开对话', '尚未開啟對話', 'Keine Unterhaltung geöffnet', '会話が開かれていません', '열린 대화가 없습니다'],
  'Open a conversation for current-chat export, or use Bulk Export to load account history.': ['打开一个对话即可导出当前对话；也可以使用批量导出加载账号历史。', '開啟一個對話即可匯出目前對話；也可以使用批次匯出載入帳號歷史。', 'Öffne eine Unterhaltung zum Exportieren oder lade den Kontoverlauf mit dem Sammelexport.', '現在の会話をエクスポートするには会話を開いてください。一括エクスポートではアカウントの履歴を読み込めます。', '현재 대화를 내보내려면 대화를 여세요. 일괄 내보내기로 계정 기록을 불러올 수도 있습니다.'],
  '{0} could not verify the complete conversation. Reload the provider page and retry.': ['无法验证 {0} 对话的完整性，已停止导出。请重新加载平台页面后重试。', '無法驗證 {0} 對話的完整性，已停止匯出。請重新載入平台頁面後重試。', 'Die Vollständigkeit der Unterhaltung bei {0} konnte nicht bestätigt werden. Lade die Plattformseite neu und versuche es erneut.', '{0} の会話の完全性を確認できませんでした。サイトを再読み込みしてお試しください。', '{0} 대화의 완전성을 확인하지 못했습니다. 사이트를 새로고침한 후 다시 시도하세요.'],
  'Sign in to the provider, then refresh the conversation list.': ['请先登录对应平台，再刷新对话列表。', '請先登入對應平台，再重新整理對話清單。', 'Melde dich bei der Plattform an und aktualisiere dann die Unterhaltungsliste.', 'サイトにログインしてから会話一覧を更新してください。', '해당 사이트에 로그인한 후 대화 목록을 새로고침하세요.'],
  'History loading timed out. Showing only visible sidebar conversations; refresh to retry.': ['历史列表加载超时。当前仅显示侧边栏可见对话，不代表完整历史；请刷新重试。', '歷史清單載入逾時。目前僅顯示側邊欄可見對話，不代表完整歷史；請重新整理再試。', 'Zeitüberschreitung beim Laden des Verlaufs. Nur sichtbare Unterhaltungen der Seitenleiste werden angezeigt; aktualisiere zum Wiederholen.', '履歴の読み込みがタイムアウトしました。サイドバーに表示された会話のみで、完全な履歴ではありません。更新してお試しください。', '기록 로딩 시간이 초과되었습니다. 사이드바에 보이는 대화만 표시되며 전체 기록이 아닙니다. 새로고침하세요.'],
  'History could not be loaded. Reload the provider page and refresh the list.': ['无法加载对话历史。请重新加载平台页面，再刷新列表。', '無法載入對話歷史。請重新載入平台頁面，再重新整理清單。', 'Der Verlauf konnte nicht geladen werden. Lade die Plattformseite neu und aktualisiere die Liste.', '会話履歴を読み込めませんでした。サイトを再読み込みして一覧を更新してください。', '대화 기록을 불러오지 못했습니다. 사이트를 새로고침한 후 목록을 갱신하세요.'],
  'Provider read timed out. Refresh to retry.': ['平台读取超时，请刷新重试。', '平台讀取逾時，請重新整理再試。', 'Zeitüberschreitung beim Lesen der Plattform. Aktualisiere zum Wiederholen.', 'サイトからの読み込みがタイムアウトしました。更新してお試しください。', '사이트 읽기 시간이 초과되었습니다. 새로고침하세요.'],
  'The operation failed. Reload the provider page and retry.': ['操作失败。请重新加载平台页面后重试。', '操作失敗。請重新載入平台頁面後重試。', 'Der Vorgang ist fehlgeschlagen. Lade die Plattformseite neu und versuche es erneut.', '操作に失敗しました。サイトを再読み込みしてお試しください。', '작업에 실패했습니다. 사이트를 새로고침한 후 다시 시도하세요.'],
}

export const PROVIDER_ERROR_STRINGS = Object.fromEntries(
  (['en', 'zh-CN', 'zh-TW', 'de', 'ja', 'ko'] as Locale[]).map((locale, index) => [
    locale, Object.fromEntries(Object.entries(copy).map(([key, values]) => [key, index === 0 ? key : values[index - 1]])),
  ]),
) as Record<Locale, Record<string, string>>
