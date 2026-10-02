import type { Locale } from './i18n'

/** New snapshot and recovery copy; merged without replacing existing translations. */
export const SNAPSHOT_STRINGS: Record<Locale, Record<string, string>> = {
  en: {
    'Page snapshot': 'Page snapshot', 'Capture page snapshot': 'Capture page snapshot', 'Capturing…': 'Capturing…',
    'Save Markdown': 'Save Markdown', 'Copy Markdown': 'Copy Markdown', 'Copying…': 'Copying…', 'Preview ↗': 'Preview ↗', 'Export PDF ↗': 'Export PDF ↗', 'Recapture': 'Recapture',
    'Local recovery': 'Local recovery', 'Protection on': 'Protection on', 'Paused': 'Paused', 'Stop protection': 'Stop protection', 'Open recovery page': 'Open recovery page',
  },
  'zh-CN': {
    'Page snapshot': '页面快照', 'Capture page snapshot': '捕获页面快照', 'Capturing…': '捕获中…', 'Save Markdown': '保存 Markdown', 'Copy Markdown': '复制 Markdown', 'Copying…': '复制中…', 'Preview ↗': '预览 ↗', 'Export PDF ↗': '导出 PDF ↗', 'Recapture': '重新捕获',
    'Local recovery': '本地恢复', 'Protection on': '保护已开启', 'Paused': '已暂停', 'Stop protection': '停止保护', 'Open recovery page': '打开恢复页面',
  },
  'zh-TW': {
    'Page snapshot': '頁面快照', 'Capture page snapshot': '擷取頁面快照', 'Capturing…': '擷取中…', 'Save Markdown': '儲存 Markdown', 'Copy Markdown': '複製 Markdown', 'Copying…': '複製中…', 'Preview ↗': '預覽 ↗', 'Export PDF ↗': '匯出 PDF ↗', 'Recapture': '重新擷取',
    'Local recovery': '本機復原', 'Protection on': '保護已開啟', 'Paused': '已暫停', 'Stop protection': '停止保護', 'Open recovery page': '開啟復原頁面',
  },
  de: {
    'Page snapshot': 'Seitenaufnahme', 'Capture page snapshot': 'Seite aufnehmen', 'Capturing…': 'Aufnahme läuft…', 'Save Markdown': 'Markdown speichern', 'Copy Markdown': 'Markdown kopieren', 'Copying…': 'Wird kopiert…', 'Preview ↗': 'Vorschau ↗', 'Export PDF ↗': 'PDF exportieren ↗', 'Recapture': 'Erneut aufnehmen',
    'Local recovery': 'Lokale Wiederherstellung', 'Protection on': 'Schutz aktiv', 'Paused': 'Pausiert', 'Stop protection': 'Schutz beenden', 'Open recovery page': 'Wiederherstellung öffnen',
  },
  ja: {
    'Page snapshot': 'ページのスナップショット', 'Capture page snapshot': 'ページを保存', 'Capturing…': '保存中…', 'Save Markdown': 'Markdown を保存', 'Copy Markdown': 'Markdown をコピー', 'Copying…': 'コピー中…', 'Preview ↗': 'プレビュー ↗', 'Export PDF ↗': 'PDF を出力 ↗', 'Recapture': '再取得',
    'Local recovery': 'ローカル復元', 'Protection on': '保護中', 'Paused': '一時停止', 'Stop protection': '保護を停止', 'Open recovery page': '復元ページを開く',
  },
  ko: {
    'Page snapshot': '페이지 스냅샷', 'Capture page snapshot': '페이지 캡처', 'Capturing…': '캡처 중…', 'Save Markdown': 'Markdown 저장', 'Copy Markdown': 'Markdown 복사', 'Copying…': '복사 중…', 'Preview ↗': '미리보기 ↗', 'Export PDF ↗': 'PDF 내보내기 ↗', 'Recapture': '다시 캡처',
    'Local recovery': '로컬 복구', 'Protection on': '보호 켜짐', 'Paused': '일시 중지', 'Stop protection': '보호 중지', 'Open recovery page': '복구 페이지 열기',
  },
}

const ADDITIONAL: Record<string, [string, string, string, string, string]> = {
  'Capture failed. Please retry.': ['捕获失败，请重试。','擷取失敗，請重試。','Aufnahme fehlgeschlagen. Bitte erneut versuchen.','取得に失敗しました。再試行してください。','캡처 실패. 다시 시도하세요.'],
  'Saved {0}': ['已保存 {0}','已儲存 {0}','{0} gespeichert','{0} を保存しました','{0} 저장됨'],
  'Copy failed': ['复制失败','複製失敗','Kopieren fehlgeschlagen','コピーに失敗しました','복사 실패'],
  'Copied Markdown!': ['已复制 Markdown！','已複製 Markdown！','Markdown kopiert!','Markdown をコピーしました！','Markdown 복사 완료!'],
  'Still generating': ['仍在生成','仍在生成','Wird noch generiert','生成中','생성 중'],
  'Generation stopped': ['生成已停止','生成已停止','Generierung beendet','生成停止','생성 중지'],
  'Generation status unknown': ['生成状态未知','生成狀態不明','Generierungsstatus unbekannt','生成状態不明','생성 상태 알 수 없음'],
  'Captured: {0}': ['捕获时间：{0}','擷取時間：{0}','Aufgenommen: {0}','取得日時: {0}','캡처: {0}'],
  'Last saved: {0}': ['上次保存：{0}','上次儲存：{0}','Zuletzt gespeichert: {0}','最終保存: {0}','마지막 저장: {0}'],
  'Save failed': ['保存失败','儲存失敗','Speichern fehlgeschlagen','保存に失敗','저장 실패'],
  'Save failed: {0}': ['保存失败：{0}','儲存失敗：{0}','Speichern fehlgeschlagen: {0}','保存失敗: {0}','저장 실패: {0}'],
  'Preparing preview…': ['正在准备预览…','正在準備預覽…','Vorschau wird vorbereitet…','プレビューを準備中…','미리보기 준비 중…'],
  'Working…': ['处理中…','處理中…','Wird verarbeitet…','処理中…','처리 중…'],
  'Download Markdown': ['下载 Markdown','下載 Markdown','Markdown herunterladen','Markdown をダウンロード','Markdown 다운로드'],
  'Download PDF': ['下载 PDF','下載 PDF','PDF herunterladen','PDF をダウンロード','PDF 다운로드'],
  'Cancel download': ['取消下载','取消下載','Download abbrechen','ダウンロードを中止','다운로드 취소'],
  'Delete temporary snapshot': ['删除临时快照','刪除暫存快照','Temporäre Aufnahme löschen','一時スナップショットを削除','임시 스냅샷 삭제'],
  'Local recovery drafts': ['本地恢复草稿','本機復原草稿','Lokale Wiederherstellungsentwürfe','ローカル復元の下書き','로컬 복구 초안'],
  'No recovery drafts available.': ['没有可用的恢复草稿。','沒有可用的復原草稿。','Keine Wiederherstellungsentwürfe vorhanden.','復元できる下書きはありません。','복구할 초안이 없습니다.'],
  'Loading recovery drafts…': ['正在加载恢复草稿…','正在載入復原草稿…','Wiederherstellungsentwürfe werden geladen…','復元用の下書きを読み込み中…','복구 초안 불러오는 중…'],
  'Delete all drafts': ['删除全部草稿','刪除所有草稿','Alle Entwürfe löschen','すべての下書きを削除','모든 초안 삭제'],
  'Delete permanently': ['永久删除','永久刪除','Endgültig löschen','完全に削除','영구 삭제'],
  'Confirm deletion': ['确认删除','確認刪除','Löschen bestätigen','削除を確認','삭제 확인'],
  'Untitled conversation': ['未命名对话','未命名對話','Unterhaltung ohne Titel','無題の会話','제목 없는 대화'],
  'Captured {0}': ['捕获于 {0}','擷取於 {0}','Aufgenommen {0}','取得日時 {0}','캡처 {0}'],
  'Last saved {0}': ['上次保存于 {0}','上次儲存於 {0}','Zuletzt gespeichert {0}','最終保存 {0}','마지막 저장 {0}'],
  'The answer was still generating at capture time.': ['捕获时回答仍在生成。','擷取時回答仍在生成。','Die Antwort wurde zum Aufnahmezeitpunkt noch generiert.','取得時点で回答は生成中でした。','캡처 당시 답변이 생성 중이었습니다.'],
  'Generation status at capture time is unknown.': ['捕获时的生成状态未知。','擷取時的生成狀態不明。','Der Generierungsstatus zum Aufnahmezeitpunkt ist unbekannt.','取得時点の生成状態は不明です。','캡처 당시 생성 상태를 알 수 없습니다.'],

  'Snapshot output could not be prepared under the current settings.': ['当前设置无法准备快照输出。', '目前設定無法準備快照輸出。', 'Die Aufnahme kann mit diesen Einstellungen nicht ausgegeben werden.', '現在の設定ではスナップショットを出力できません。', '현재 설정으로 스냅샷을 출력할 수 없습니다.'],
  'Page snapshot is unavailable for preview': ['页面快照无法预览', '頁面快照無法預覽', 'Seitenaufnahme kann nicht angezeigt werden', 'ページのスナップショットを表示できません', '페이지 스냅샷을 미리 볼 수 없습니다'],
  'Recovery draft is missing or invalid': ['恢复草稿丢失或无效', '復原草稿遺失或無效', 'Wiederherstellungsentwurf fehlt oder ist ungültig', '復元用の下書きが見つからないか無効です', '복구 초안이 없거나 올바르지 않습니다'],
  'Delete': ['删除', '刪除', 'Löschen', '削除', '삭제'],
  'Cancel': ['取消', '取消', 'Abbrechen', 'キャンセル', '취소'],
  'The source tab was closed before the capture finished. Please retry.': ['捕获完成前源标签页已关闭，请重试。', '擷取完成前來源分頁已關閉，請重試。', 'Der Quelltab wurde vor Abschluss der Aufnahme geschlossen. Bitte erneut versuchen.', '取得完了前に元のタブが閉じられました。再試行してください。', '캡처 완료 전에 원본 탭이 닫혔습니다. 다시 시도하세요.'],
  'Open a supported conversation tab to capture a snapshot.': ['打开受支持的对话标签页以捕获快照。', '開啟支援的對話分頁以擷取快照。', 'Öffnen Sie einen unterstützten Unterhaltungstab für eine Aufnahme.', '対応する会話のタブを開いて取得してください。', '지원되는 대화 탭을 열어 캡처하세요.'],
  'Download cancelled. Nothing was saved.': ['下载已取消，没有保存文件。', '下載已取消，未儲存檔案。', 'Download abgebrochen. Es wurde nichts gespeichert.', 'ダウンロードを中止しました。保存されていません。', '다운로드 취소됨. 저장된 파일이 없습니다.'],
  'Preview is unavailable right now.': ['目前无法预览。', '目前無法預覽。', 'Vorschau ist derzeit nicht verfügbar.', '現在プレビューを表示できません。', '지금 미리보기를 사용할 수 없습니다.'],
  'Protection could not be enabled. Please retry.': ['无法启用保护，请重试。', '無法啟用保護，請重試。', 'Schutz konnte nicht aktiviert werden. Bitte erneut versuchen.', '保護を有効にできませんでした。再試行してください。', '보호를 켤 수 없습니다. 다시 시도하세요.'],
  'Protection could not be stopped. Please retry.': ['无法停止保护，请重试。', '無法停止保護，請重試。', 'Schutz konnte nicht beendet werden. Bitte erneut versuchen.', '保護を停止できませんでした。再試行してください。', '보호를 중지할 수 없습니다. 다시 시도하세요.'],
  'Save the conversation content currently loaded and readable on this page. The full history is not verified.': ['保存当前页面已加载且可读取的对话内容。完整历史记录未经验证。', '儲存目前頁面已載入且可讀取的對話內容。完整歷史紀錄未經驗證。', 'Speichert nur den derzeit geladenen und lesbaren Gesprächsinhalt. Der gesamte Verlauf ist nicht geprüft.', '現在ページに読み込まれ、読み取れる会話のみ保存します。全履歴は検証されていません。', '현재 페이지에 로드되어 읽을 수 있는 대화만 저장합니다. 전체 기록은 확인되지 않았습니다.'],
  'Scope: content observed on this page (DOM only)': ['范围：此页面上观察到的内容（仅 DOM）', '範圍：此頁面上觀察到的內容（僅 DOM）', 'Umfang: auf dieser Seite sichtbarer Inhalt (nur DOM)', '対象: このページで確認した内容（DOM のみ）', '범위: 이 페이지에서 확인된 콘텐츠(DOM만)'],
  'The source tab was closed. This captured snapshot can still be exported.': ['源标签页已关闭。仍可导出已捕获的快照。', '來源分頁已關閉。仍可匯出已擷取的快照。', 'Der Quelltab wurde geschlossen. Die Aufnahme kann weiterhin exportiert werden.', '元のタブは閉じられました。取得済みの内容は出力できます。', '원본 탭이 닫혔습니다. 캡처된 스냅샷은 계속 내보낼 수 있습니다.'],
  'PDF opens in the preview page; keep that tab open until the download finishes.': ['PDF 在预览页中打开；下载完成前请保持该标签页打开。', 'PDF 會在預覽頁開啟；下載完成前請保持該分頁開啟。', 'PDF öffnet sich in der Vorschau. Lassen Sie den Tab bis zum Ende des Downloads geöffnet.', 'PDF はプレビューページで開きます。ダウンロード完了までタブを閉じないでください。', 'PDF는 미리보기 페이지에서 열립니다. 다운로드가 끝날 때까지 탭을 유지하세요.'],
  'Markdown and PDF only — no ZIP archives, raw provider data, or tool records. Output follows your current privacy settings.': ['仅支持 Markdown 和 PDF；不含 ZIP、平台原始数据或工具记录。输出遵循当前隐私设置。', '僅支援 Markdown 和 PDF；不含 ZIP、平台原始資料或工具紀錄。輸出遵循目前隱私設定。', 'Nur Markdown und PDF – keine ZIP-Archive, Anbieterrohdaten oder Werkzeugprotokolle. Es gelten Ihre Datenschutzeinstellungen.', 'Markdown と PDF のみです。ZIP、プロバイダーの生データ、ツール記録は含みません。現在のプライバシー設定が適用されます。', 'Markdown과 PDF만 지원합니다. ZIP, 제공자 원본 데이터, 도구 기록은 제외하며 현재 개인정보 설정을 따릅니다.'],
  'Local protection is on for this conversation.': ['此对话的本地保护已开启。', '此對話的本機保護已開啟。', 'Lokaler Schutz für diese Unterhaltung ist aktiv.', 'この会話のローカル保護は有効です。', '이 대화의 로컬 보호가 켜졌습니다.'],
  'Local protection is paused for this conversation.': ['此对话的本地保护已暂停。', '此對話的本機保護已暫停。', 'Lokaler Schutz für diese Unterhaltung ist pausiert.', 'この会話のローカル保護は一時停止中です。', '이 대화의 로컬 보호가 일시 중지되었습니다.'],
  'Drafts can be viewed and cleared on the recovery page.': ['可在恢复页面查看和清除草稿。', '可在復原頁面檢視和清除草稿。', 'Entwürfe können auf der Wiederherstellungsseite angesehen und gelöscht werden.', '復元ページで下書きを表示・削除できます。', '복구 페이지에서 초안을 확인하고 삭제할 수 있습니다.'],
  'Enable local protection for this conversation': ['为此对话启用本地保护', '為此對話啟用本機保護', 'Lokalen Schutz für diese Unterhaltung aktivieren', 'この会話のローカル保護を有効にする', '이 대화의 로컬 보호 켜기'],
  'PDF export does not start automatically. Choose Download PDF below when you are ready.': ['PDF 不会自动导出。准备好后请选择下方的“下载 PDF”。', 'PDF 不會自動匯出。準備好後請選擇下方的「下載 PDF」。', 'Der PDF-Export startet nicht automatisch. Wählen Sie unten „PDF herunterladen“.', 'PDF の出力は自動で始まりません。準備ができたら下の「PDF をダウンロード」を選んでください。', 'PDF 내보내기는 자동으로 시작되지 않습니다. 준비되면 아래 PDF 다운로드를 선택하세요.'],
  'Copy and download are disabled. Adjust the output settings and reopen the preview to export this capture.': ['复制和下载已禁用。调整输出设置并重新打开预览以导出此次捕获。', '複製和下載已停用。調整輸出設定並重新開啟預覽以匯出此次擷取。', 'Kopieren und Herunterladen sind deaktiviert. Passen Sie die Ausgabeeinstellungen an und öffnen Sie die Vorschau erneut.', 'コピーとダウンロードは無効です。出力設定を変更してプレビューを開き直してください。', '복사와 다운로드가 비활성화되었습니다. 출력 설정을 바꾸고 미리보기를 다시 여세요.'],
  'Saved checkpoints contain only observed page content, not complete verified history. They cannot restore a conversation to its provider.': ['已保存检查点仅包含页面上观察到的内容，不是经过验证的完整历史记录；无法将对话恢复到平台。', '已儲存檢查點僅包含頁面上觀察到的內容，不是經過驗證的完整歷史紀錄；無法將對話復原至平台。', 'Gespeicherte Stände enthalten nur sichtbaren Seiteninhalt, keinen geprüften vollständigen Verlauf. Sie können Gespräche nicht beim Anbieter wiederherstellen.', '保存した時点の内容はページで確認できた部分のみで、検証済みの全履歴ではありません。プロバイダーの会話は復元できません。', '저장된 체크포인트는 페이지에서 확인된 내용만 포함하며 검증된 전체 기록이 아닙니다. 제공자 대화를 복원할 수 없습니다.'],
  'Drafts stay only in this browser — retained for up to 7 days and limited to 4 MiB.': ['草稿仅保存在此浏览器，最多保留 7 天，总量上限 4 MiB。', '草稿僅保存在此瀏覽器，最多保留 7 天，總量上限 4 MiB。', 'Entwürfe bleiben nur in diesem Browser, höchstens 7 Tage und insgesamt 4 MiB.', '下書きはこのブラウザーだけに保存され、保持は最大7日間、合計4 MiBまでです。', '초안은 이 브라우저에만 최대 7일 동안 총 4 MiB까지 저장됩니다.'],
  'Open fixed snapshot preview (copy / Markdown / PDF)': ['打开固定快照预览（复制 / Markdown / PDF）', '開啟固定快照預覽（複製 / Markdown / PDF）', 'Feste Aufnahme öffnen (Kopieren / Markdown / PDF)', '固定スナップショットを開く（コピー / Markdown / PDF）', '고정 스냅샷 미리보기 열기(복사 / Markdown / PDF)'],
  'Heuristic safe-share: {0} redactions; review for remaining sensitive information.': ['启发式安全分享：已遮盖 {0} 处；请检查是否仍有敏感信息。', '啟發式安全分享：已遮蓋 {0} 處；請檢查是否仍有敏感資訊。', 'Heuristische Freigabe: {0} Stellen maskiert; prüfen Sie verbleibende vertrauliche Daten.', '共有用の推定処理で {0} 件を伏せました。残る機密情報を確認してください。', '휴리스틱 공유 처리로 {0}건 가렸습니다. 남은 민감 정보를 확인하세요.'],
}
const LONG_COPY: Record<string, [string, string, string, string, string]> = {
  'Optional and off by default. When enabled, the visible content of this conversation is kept as a recovery draft that stays only in this browser — retained for up to 7 days and limited to 4 MiB. Nothing is uploaded or synced, and protection does not restart by itself after the browser restarts.': ['默认关闭，可自行开启。开启后，此对话的可见内容作为恢复草稿仅保存在此浏览器，最多保留 7 天，总量上限 4 MiB。不上传或同步；浏览器重启后保护不会自动恢复。', '預設關閉，可自行開啟。開啟後，此對話的可見內容作為復原草稿僅保存在此瀏覽器，最多保留 7 天，總量上限 4 MiB。不上傳或同步；瀏覽器重新啟動後保護不會自動恢復。', 'Optional und standardmäßig aus. Bei Aktivierung bleibt der sichtbare Gesprächsinhalt als Entwurf nur in diesem Browser, höchstens 7 Tage und insgesamt 4 MiB. Keine Übertragung oder Synchronisierung; nach einem Browserneustart beginnt der Schutz nicht automatisch erneut.', '任意機能で初期設定はオフです。有効にすると、この会話で見える内容を復元用の下書きとしてこのブラウザーだけに最大7日間、合計4 MiBまで保存します。アップロードや同期はせず、ブラウザー再起動後に保護は自動再開しません。', '선택 기능이며 기본적으로 꺼져 있습니다. 켜면 이 대화의 보이는 내용이 복구 초안으로 이 브라우저에만 최대 7일, 총 4 MiB까지 저장됩니다. 업로드나 동기화는 없으며 브라우저를 다시 시작해도 보호가 자동 재개되지 않습니다.'],
  "Stopping protection does not delete saved drafts. Deleting a draft also stops that draft's protection, and protection does not resume by itself.": ['停止保护不会删除已保存的草稿。删除草稿也会停止相应的保护，且不会自行恢复。', '停止保護不會刪除已儲存的草稿。刪除草稿也會停止對應的保護，且不會自行恢復。', 'Das Beenden des Schutzes löscht keine Entwürfe. Das Löschen eines Entwurfs beendet auch dessen Schutz; er startet nicht selbst erneut.', '保護を停止しても保存済みの下書きは削除されません。下書きを削除するとその保護も止まり、自動再開しません。', '보호를 중지해도 저장된 초안은 삭제되지 않습니다. 초안을 삭제하면 해당 보호도 중지되며 자동 재개되지 않습니다.'],
  'Permanently delete all local recovery drafts? This cannot be undone. Any draft still under protection loses that protection and it does not resume by itself.': ['永久删除所有本地恢复草稿？此操作无法撤销。仍受保护的草稿也会停止保护且不会自动恢复。', '永久刪除所有本機復原草稿？此操作無法復原。仍受保護的草稿也會停止保護且不會自動恢復。', 'Alle lokalen Entwürfe endgültig löschen? Dies kann nicht rückgängig gemacht werden. Aktiver Schutz endet und startet nicht automatisch erneut.', 'すべてのローカル復元用下書きを完全に削除しますか？元に戻せません。保護中の下書きの保護も終了し、自動再開しません。', '모든 로컬 복구 초안을 영구 삭제할까요? 되돌릴 수 없습니다. 보호 중인 초안도 보호가 중지되고 자동 재개되지 않습니다.'],
  'Permanently delete this local recovery draft? This cannot be undone. If this draft is still protected, protection stops and does not resume by itself.': ['永久删除此本地恢复草稿？此操作无法撤销。若仍受保护，保护会停止且不会自动恢复。', '永久刪除此本機復原草稿？此操作無法復原。若仍受保護，保護會停止且不會自動恢復。', 'Diesen lokalen Entwurf endgültig löschen? Dies kann nicht rückgängig gemacht werden. Sein Schutz endet und startet nicht automatisch erneut.', 'このローカル復元用下書きを完全に削除しますか？元に戻せません。保護中なら保護も終了し、自動再開しません。', '이 로컬 복구 초안을 영구 삭제할까요? 되돌릴 수 없습니다. 보호 중이면 보호가 중지되고 자동 재개되지 않습니다.'],
  'Page snapshot · captured at {0}. Includes only conversation content loaded and readable on this page at capture time; complete history has not been verified. Unloaded messages and external attachment contents may be absent.': ['页面快照 · 捕获于 {0}。仅包含捕获时此页面已加载且可读取的对话内容；完整历史记录未经验证。未加载的消息及外部附件内容可能缺失。', '頁面快照 · 擷取於 {0}。僅包含擷取時此頁面已載入且可讀取的對話內容；完整歷史紀錄未經驗證。未載入的訊息及外部附件內容可能缺失。', 'Seitenaufnahme · {0}. Enthält nur beim Aufnehmen geladene und lesbare Gesprächsinhalte; der gesamte Verlauf wurde nicht geprüft. Ungeladene Nachrichten und externe Anhänge können fehlen.', 'ページのスナップショット · {0} に取得。取得時に読み込まれ読み取れた会話のみ含み、全履歴は検証されていません。未読込のメッセージや外部添付ファイルの内容は欠ける場合があります。', '페이지 스냅샷 · {0}에 캡처. 캡처 당시 로드되어 읽을 수 있던 대화만 포함하며 전체 기록은 검증되지 않았습니다. 로드되지 않은 메시지와 외부 첨부 내용은 빠질 수 있습니다.'],
}
Object.assign(ADDITIONAL, LONG_COPY, {
  'External image content may be unavailable.': ['外部图片内容可能无法显示。', '外部圖片內容可能無法顯示。', 'Externe Bildinhalte sind möglicherweise nicht verfügbar.', '外部画像の内容を表示できない場合があります。', '외부 이미지 콘텐츠를 사용할 수 없을 수 있습니다.'],
  'Recovery request failed. Please retry.': ['恢复请求失败，请重试。', '復原要求失敗，請重試。', 'Wiederherstellungsanfrage fehlgeschlagen. Bitte erneut versuchen.', '復元リクエストに失敗しました。再試行してください。', '복구 요청 실패. 다시 시도하세요.'],
  'Invalid recovery list': ['恢复列表无效', '復原清單無效', 'Ungültige Wiederherstellungsliste', '復元一覧が無効です', '복구 목록이 올바르지 않습니다'],
  'Recovery list unavailable': ['恢复列表不可用', '復原清單無法使用', 'Wiederherstellungsliste nicht verfügbar', '復元一覧を取得できません', '복구 목록을 사용할 수 없습니다'],
  'Recovery draft unavailable': ['恢复草稿不可用', '復原草稿無法使用', 'Wiederherstellungsentwurf nicht verfügbar', '復元用の下書きを取得できません', '복구 초안을 사용할 수 없습니다'],
  'Preview could not be opened': ['无法打开预览', '無法開啟預覽', 'Vorschau konnte nicht geöffnet werden', 'プレビューを開けませんでした', '미리보기를 열 수 없습니다'],
  'The recovery drafts could not be deleted. Saved content was retained; please retry.': ['无法删除恢复草稿；已保留保存的内容，请重试。', '無法刪除復原草稿；已保留儲存的內容，請重試。', 'Entwürfe konnten nicht gelöscht werden. Gespeicherte Inhalte bleiben erhalten; bitte erneut versuchen.', '下書きを削除できませんでした。保存済みの内容は保持されています。再試行してください。', '복구 초안을 삭제할 수 없습니다. 저장된 내용은 유지됩니다. 다시 시도하세요.'],
  'The recovery draft could not be deleted. Saved content was retained; please retry.': ['无法删除恢复草稿；已保留保存的内容，请重试。', '無法刪除復原草稿；已保留儲存的內容，請重試。', 'Der Entwurf konnte nicht gelöscht werden. Gespeicherter Inhalt bleibt erhalten; bitte erneut versuchen.', '下書きを削除できませんでした。保存済みの内容は保持されています。再試行してください。', '복구 초안을 삭제할 수 없습니다. 저장된 내용은 유지됩니다. 다시 시도하세요.'],
})
for (const [key, values] of Object.entries(ADDITIONAL)) {
  SNAPSHOT_STRINGS.en[key] = key
  ;(['zh-CN', 'zh-TW', 'de', 'ja', 'ko'] as const).forEach((locale, index) => { SNAPSHOT_STRINGS[locale][key] = values[index] })
}
