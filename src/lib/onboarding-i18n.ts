import type { Locale } from './i18n'

type NonEnglishTranslations = [
  zhCN: string,
  zhTW: string,
  de: string,
  ja: string,
  ko: string,
]

/**
 * First-use quick-start copy for the collapsible help block. Same shape as
 * SNAPSHOT_STRINGS / RELEASE_150_STRINGS so the popup's i18n merge can spread
 * it in without replacing existing translations.
 */
const STRINGS_MAP: Record<string, NonEnglishTranslations> = {
  'Copy Markdown': ['复制 Markdown', '複製 Markdown', 'Markdown kopieren', 'Markdown をコピー', 'Markdown 복사'],
  'Download ZIP': ['下载 ZIP', '下載 ZIP', 'ZIP herunterladen', 'ZIP をダウンロード', 'ZIP 다운로드'],
  'Capture without downloading': ['只捕获，暂不下载', '僅擷取，暫不下載', 'Aufnehmen, ohne herunterzuladen', 'ダウンロードせずにキャプチャ', '다운로드 없이 캡처'],
  'Capture first to inspect or copy the page before saving. The main save button above captures and downloads in one step.': [
    '先捕获，可在保存前检查或复制页面。上方主按钮会一步完成捕获和下载。',
    '先擷取，可在儲存前檢查或複製頁面。上方主按鈕會一次完成擷取及下載。',
    'Zuerst aufnehmen, um die Seite vor dem Speichern zu prüfen oder zu kopieren. Die Hauptschaltfläche oben nimmt auf und lädt direkt herunter.',
    '先にキャプチャして、保存前に確認やコピーができます。上の保存ボタンはキャプチャとダウンロードを一度に行います。',
    '먼저 캡처하면 저장 전에 확인하거나 복사할 수 있습니다. 위의 저장 버튼은 캡처와 다운로드를 한 번에 수행합니다.',
  ],
  'Quick start': [
    '快速上手',
    '快速上手',
    'Schnellstart',
    'クイックスタート',
    '빠른 시작',
  ],
  '1. Open your chat': [
    '1. 打开对话',
    '1. 開啟對話',
    '1. Chat öffnen',
    '1. チャットを開く',
    '1. 대화 열기',
  ],
  'Open a conversation on a supported site, then click the extension icon again.': [
    '在受支持的网站打开一个对话，然后再次点击扩展图标。',
    '在支援的網站開啟一個對話，然後再次點擊擴充功能圖示。',
    'Öffnen Sie eine Unterhaltung auf einer unterstützten Seite und klicken Sie erneut auf das Erweiterungssymbol.',
    '対応サイトで会話を開き、もう一度拡張機能のアイコンをクリックします。',
    '지원되는 사이트에서 대화를 연 다음 확장 프로그램 아이콘을 다시 클릭하세요.',
  ],
  '2. Choose a file': [
    '2. 选择文件格式',
    '2. 選擇檔案格式',
    '2. Datei wählen',
    '2. ファイル形式を選ぶ',
    '2. 파일 형식 선택',
  ],
  'PDF for reading or printing. Markdown for editing. ZIP for an archive with inline source files.': [
    '阅读和打印选 PDF，继续编辑选 Markdown，含内嵌源文件的归档选 ZIP。',
    '閱讀或列印選 PDF，繼續編輯選 Markdown，含內嵌來源檔案的封存選 ZIP。',
    'PDF zum Lesen oder Drucken. Markdown zum Bearbeiten. ZIP für ein Archiv mit eingebetteten Quelldateien.',
    '読む・印刷するには PDF、編集には Markdown、ソースファイル付きのアーカイブには ZIP を選びます。',
    '읽거나 인쇄할 때는 PDF, 편집할 때는 Markdown, 인라인 소스 파일이 포함된 보관용은 ZIP을 선택하세요.',
  ],
  '3. Save and find it': [
    '3. 保存并找到文件',
    '3. 儲存並找到檔案',
    '3. Speichern und finden',
    '3. 保存して確認',
    '3. 저장하고 찾기',
  ],
  'Files go to your browser download folder unless you choose another location in Settings.': [
    '文件保存到浏览器下载文件夹，除非你在“设置”中选择了其他位置。',
    '檔案會存到瀏覽器下載資料夾，除非你在「設定」中選擇了其他位置。',
    'Dateien landen im Download-Ordner des Browsers, sofern Sie in den Einstellungen keinen anderen Ort wählen.',
    'ファイルはブラウザーのダウンロードフォルダーに保存されます。設定で別の場所を選ぶこともできます。',
    '설정에서 다른 위치를 선택하지 않았다면 파일은 브라우저 다운로드 폴더에 저장됩니다.',
  ],
  'Preview lets you select messages or save only the last answer.': [
    '预览中可以选择部分消息，或只保存最后一条回答。',
    '預覽中可以選取部分訊息，或只儲存最後一則回答。',
    'In der Vorschau können Sie Nachrichten auswählen oder nur die letzte Antwort speichern.',
    'プレビューではメッセージを選んだり、最後の回答だけを保存したりできます。',
    '미리보기에서 메시지를 선택하거나 마지막 답변만 저장할 수 있습니다.',
  ],
  'No exporter account. Chats are processed in your browser; preview copies and optional recovery drafts use extension storage. External images may load from their original sites.': [
    '无需注册账号。对话在你的浏览器中处理；预览副本和可选的恢复草稿使用扩展存储。外部图片可能从原网站加载。',
    '無需註冊帳號。對話在你的瀏覽器中處理；預覽副本和可選的復原草稿使用擴充功能儲存空間。外部圖片可能從原網站載入。',
    'Kein Konto nötig. Chats werden in Ihrem Browser verarbeitet; Vorschau-Kopien und optionale Wiederherstellungsentwürfe nutzen den Erweiterungsspeicher. Externe Bilder können von ihren ursprünglichen Seiten geladen werden.',
    'アカウントは不要です。チャットはブラウザー内で処理され、プレビューコピーと任意の復元用下書きは拡張機能のストレージを使います。外部画像は元サイトから読み込まれる場合があります。',
    '계정이 필요 없습니다. 대화는 브라우저에서 처리되며 미리보기 사본과 선택적 복구 초안은 확장 프로그램 저장소를 사용합니다. 외부 이미지는 원래 사이트에서 로드될 수 있습니다.',
  ],

  // Popup-side onboarding/scope copy merged by the lead alongside the guide.
  'Preview & select messages': [
    '预览并选择消息',
    '預覽並選取訊息',
    'Vorschau & Nachrichten auswählen',
    'プレビューとメッセージ選択',
    '미리보기 및 메시지 선택',
  ],
  'PDF for reading or printing.': [
    'PDF 适合阅读或打印。',
    'PDF 適合閱讀或列印。',
    'PDF zum Lesen oder Drucken.',
    'PDF は閲覧や印刷に。',
    'PDF는 읽기나 인쇄에 적합합니다.',
  ],
  'ZIP contains Markdown, a manifest and captured inline files. External files are not downloaded.': [
    'ZIP 包含 Markdown、清单文件和已捕获的内嵌文件；不会下载外部文件。',
    'ZIP 包含 Markdown、清單檔案和已擷取的內嵌檔案；不會下載外部檔案。',
    'ZIP enthält Markdown, ein Manifest und erfasste Inline-Dateien. Externe Dateien werden nicht heruntergeladen.',
    'ZIP には Markdown、マニフェスト、取得したインラインファイルが含まれます。外部ファイルはダウンロードされません。',
    'ZIP에는 Markdown, 매니페스트, 캡처된 인라인 파일이 포함됩니다. 외부 파일은 다운로드되지 않습니다.',
  ],
  'Markdown for editing in a notes app.': [
    'Markdown 适合在笔记应用中编辑。',
    'Markdown 適合在筆記應用中編輯。',
    'Markdown zum Bearbeiten in einer Notiz-App.',
    'Markdown はメモアプリでの編集に。',
    'Markdown은 노트 앱에서 편집하기에 적합합니다.',
  ],
  'Complete history could not be verified. This action saves only content loaded on this page as a labelled snapshot, not a complete archive.': [
    '无法验证完整历史记录。此操作仅将页面已加载的内容保存为带标注的快照，而非完整归档。',
    '無法驗證完整歷史紀錄。此操作僅將頁面已載入的內容儲存為帶標註的快照，而非完整封存。',
    'Der vollständige Verlauf konnte nicht bestätigt werden. Diese Aktion speichert nur den auf dieser Seite geladenen Inhalt als gekennzeichnete Aufnahme, nicht als vollständiges Archiv.',
    '完全な履歴は確認できませんでした。この操作は、このページに読み込まれた内容のみをラベル付きスナップショットとして保存します。完全なアーカイブではありません。',
    '전체 기록을 확인할 수 없습니다. 이 작업은 이 페이지에 로드된 내용만 라벨이 붙은 스냅샷으로 저장하며 완전한 아카이브가 아닙니다.',
  ],
  'Preview page snapshot PDF': [
    '预览页面快照 PDF',
    '預覽頁面快照 PDF',
    'Seitenaufnahme-PDF anzeigen',
    'ページスナップショット PDF をプレビュー',
    '페이지 스냅샷 PDF 미리보기',
  ],
  'Save page snapshot Markdown': [
    '保存页面快照 Markdown',
    '儲存頁面快照 Markdown',
    'Seitenaufnahme-Markdown speichern',
    'ページスナップショット Markdown を保存',
    '페이지 스냅샷 Markdown 저장',
  ],
  'The snapshot filename includes its capture time and is not added to complete-archive history.': [
    '快照文件名包含捕获时间，且不会计入完整归档历史。',
    '快照檔名包含擷取時間，且不會計入完整封存紀錄。',
    'Der Dateiname der Aufnahme enthält den Aufnahmezeitpunkt; sie wird nicht als vollständiges Archiv gezählt.',
    'スナップショットのファイル名には取得日時が含まれ、完全アーカイブの履歴には追加されません。',
    '스냅샷 파일 이름에는 캡처 시간이 포함되며 완전 아카이브 기록에 추가되지 않습니다.',
  ],
  // Pre-download destination label: shown before the export runs, so it
  // describes the destination, not a completed save.
  'Saved to: {0}': [
    '保存位置：{0}',
    '儲存位置：{0}',
    'Zielort: {0}',
    '保存先: {0}',
    '저장 위치: {0}',
  ],
  'Choose a location when saving': [
    '保存时选择位置',
    '儲存時選擇位置',
    'Speicherort beim Speichern wählen',
    '保存時に場所を選択',
    '저장 시 위치 선택',
  ],
  'Change in Settings': [
    '在设置中更改',
    '在設定中更改',
    'In den Einstellungen ändern',
    '設定で変更',
    '설정에서 변경',
  ],
  'Share copy is on. Common credentials are hidden, but review private content before sharing.': [
    '分享副本已开启。常见凭据已隐藏，但分享前请检查私人内容。',
    '分享副本已開啟。常見憑證已隱藏，但分享前請檢查私人內容。',
    'Freigabe-Kopie ist aktiv. Übliche Zugangsdaten werden verborgen, prüfen Sie private Inhalte aber vor dem Teilen.',
    '共有コピーが有効です。一般的な認証情報は隠されますが、共有前に非公開内容を確認してください。',
    '공유 사본이 켜져 있습니다. 일반적인 인증 정보는 가려지지만 공유 전에 비공개 내용을 확인하세요.',
  ],
  'Source structure is verified, not authenticity or all external resources.': [
    '已验证来源结构，不代表真实性或全部外部资源。',
    '已驗證來源結構，不代表真實性或所有外部資源。',
    'Die Quellstruktur ist geprüft, nicht die Echtheit oder alle externen Ressourcen.',
    'ソース構造は検証済みですが、真正性やすべての外部リソースが保証されるわけではありません。',
    '소스 구조는 확인되었지만 진위나 모든 외부 리소스가 보장되지는 않습니다.',
  ],

  // Popup main-flow copy; de/ja/ko previously fell back to English.
  'Export as Markdown': [
    '导出为 Markdown',
    '匯出為 Markdown',
    'Als Markdown exportieren',
    'Markdown でエクスポート',
    'Markdown으로 내보내기',
  ],
  'Export as PDF': [
    '导出为 PDF',
    '匯出為 PDF',
    'Als PDF exportieren',
    'PDF でエクスポート',
    'PDF로 내보내기',
  ],
  'Exporting...': [
    '正在导出...',
    '正在匯出...',
    'Wird exportiert...',
    'エクスポート中...',
    '내보내는 중...',
  ],
  'Export Successful': [
    '导出成功',
    '匯出成功',
    'Export erfolgreich',
    'エクスポート成功',
    '내보내기 성공',
  ],
  'Verified source': [
    '已验证来源',
    '已驗證來源',
    'Geprüfte Quelle',
    '検証済みソース',
    '확인된 소스',
  ],
  '{0} messages': [
    '{0} 条消息',
    '{0} 則訊息',
    '{0} Nachrichten',
    '{0} 件のメッセージ',
    '메시지 {0}개',
  ],
  'No Chat Detected': [
    '未检测到聊天',
    '未偵測到聊天',
    'Kein Chat erkannt',
    'チャットが検出されません',
    '채팅이 감지되지 않음',
  ],
  'Open a conversation on a supported platform to export:': [
    '在受支持的平台上打开一个对话即可导出：',
    '在支援的平台上開啟一個對話即可匯出：',
    'Öffnen Sie eine Unterhaltung auf einer unterstützten Plattform zum Exportieren:',
    '対応プラットフォームで会話を開くとエクスポートできます:',
    '지원되는 플랫폼에서 대화를 열면 내보낼 수 있습니다:',
  ],
  'Quick Export': [
    '快速导出',
    '快速匯出',
    'Schnellexport',
    'クイックエクスポート',
    '빠른 내보내기',
  ],
  'Will download: {0} ({1})': [
    '将下载：{0}（{1}）',
    '將下載：{0}（{1}）',
    'Wird heruntergeladen: {0} ({1})',
    'ダウンロード予定: {0}（{1}）',
    '다운로드 대상: {0} ({1})',
  ],
}

export const ONBOARDING_STRINGS: Record<Locale, Record<string, string>> = {
  en: {},
  'zh-CN': {},
  'zh-TW': {},
  de: {},
  ja: {},
  ko: {},
}

const NON_EN_LOCALES = ['zh-CN', 'zh-TW', 'de', 'ja', 'ko'] as const

for (const [key, translations] of Object.entries(STRINGS_MAP)) {
  ONBOARDING_STRINGS.en[key] = key === 'Saved to: {0}' ? 'Destination: {0}' : key
  NON_EN_LOCALES.forEach((locale, idx) => {
    ONBOARDING_STRINGS[locale][key] = translations[idx]
  })
}
