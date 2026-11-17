import type { MessageKey } from './en'

// Partial locale: keys without an entry here fall back to English (see ../index.ts).

/** Export options, diagnostics, share copy, ZIP package and bulk-selection rules */
export const exportOptions = {
  'Export diagnostics': '내보내기 진단',
  unresolved_references: '해결되지 않은 참조',
  duplicate_message_ids: '중복 메시지 ID',
  tool_calls_without_observed_result: '결과가 확인되지 않은 도구 호출',
  'Failed: {0}': '실패: {0}',
  'Conversation ID': '대화 ID',
  'Keep this page open for PDF or Save As exports. Use the full workspace for long runs.':
    'PDF 또는 다른 이름으로 저장 시 페이지를 열어 두세요. 긴 작업에는 전체 작업 페이지를 사용하세요.',
  'Open full export workspace': '전체 내보내기 작업 페이지 열기',
  'Resume remaining': '남은 항목 계속',
  Interrupted: '중단됨',
  Finished: '종료됨',
  Running: '실행 중',
  'Background export': '백그라운드 내보내기',
  'Redacts common credentials. Review private content before sharing.':
    '패키징 전 일반적인 비밀번호, API 키, 토큰을 자동으로 가립니다. 공유하기 전에 민감한 개인 정보를 수동으로 다시 확인하세요.',
  'Create share copy': '공유 가능한 마스킹 사본 생성',
  'Tool arguments and results may contain private data. Only provider-exposed events are available.':
    '대화 중 AI가 호출한 도구(검색, 코드 실행 등)를 기록합니다. 참고: 도구 인수 및 결과에 개인 정보가 포함될 수 있습니다.',
  'Include tool trace': '도구 기록 포함',
  'Include raw provider data': '플랫폼 원시 데이터 포함',
  'Packs the original platform response (gzip) into the archive for long-term preservation or re-parsing. Larger file; stays only in your download.':
    '플랫폼의 원본 응답을 gzip으로 압축해 아카이브에 포함하여 장기 보관하거나 다시 분석할 수 있습니다. 파일이 커지며 다운로드 위치에만 저장됩니다.',
  'Progress drafts merged': '병합된 진행 중 초안',
  'Includes Markdown, hashes and inline artifacts. External attachments are not downloaded.':
    'Markdown, 해시 및 내장 산출물을 포함합니다. 외부 첨부 파일은 다운로드하지 않습니다.',
  'Download ZIP with manifest': 'ZIP 패키지 파일 다운로드',
  'Archive bundle': '패키지 다운로드(ZIP)',
  'When enabled, downloads a .zip containing Markdown, a manifest of references, and checksums. When disabled, downloads a single .md file.':
    '활성화 시 Markdown 본문, 참조 목록, 체크섬이 포함된 .zip을 다운로드하며, 비활성화 시 단일 .md 파일을 직접 다운로드합니다.',
  'Changes here apply to this session. Save explicitly to change defaults.':
    '변경 사항은 이번 세션에만 적용됩니다. 기본값을 바꾸려면 저장하세요.',
  'Save as defaults': '기본값으로 저장',
  'Reset to defaults': '기본값 복원',
  'Selected {0} · Will export {1} · Skip {2}': '선택 {0} · 내보낼 항목 {1} · 제외 {2}',
  'Quick selection': '빠른 선택',
  'Up to {0}': '최대 {0}개',
  'Skip archived': '보관된 대화 제외',
  'Apply these rules to select conversations. Manual selections can exceed this limit.':
    '조건을 적용해 대화를 선택합니다. 수동 선택은 한도를 초과할 수 있습니다.'
} satisfies Partial<Record<MessageKey, string>>

/** Popup */
export const popup = {
  'AI Chat Exporter': 'AI 채팅 내보내기',
  'Open Settings': '설정 열기',
  'Toggle Theme': '테마 전환',
  'Current Chat': '현재 채팅',
  'Bulk Export': '일괄 내보내기',
  'No Chat Detected': '채팅이 감지되지 않음',
  'Open a conversation on a supported platform to export:':
    '지원되는 플랫폼에서 대화를 열면 내보낼 수 있습니다:',
  '{0} messages': '메시지 {0}개',
  Unknown: '알 수 없음',
  'Quick Export': '빠른 내보내기',
  'Advanced Export Options': '고급 내보내기 옵션',
  'Include Metadata': '메타데이터 포함',
  'Add date, title, and platform at the top of exports': '내보내기 상단에 날짜, 제목, 플랫폼 추가',
  'Include Code Blocks': '코드 블록 포함',
  'Export code blocks in messages': '메시지의 코드 블록 내보내기',
  'Include Images': '이미지 포함',
  'Export images embedded in conversations': '대화에 포함된 이미지 내보내기',
  'Include Uploaded Files': '업로드한 파일 포함',
  'Preserve references to files you uploaded to chat': '채팅에 업로드한 파일의 참조 유지',
  'Source References': '인용 출처',
  'Control citation titles and private connector links':
    'AI 답변에서 인용한 웹페이지 및 파일입니다. 내보낼 링크 정보 수준을 설정합니다.',
  'Do not export references': '인용 내보내지 않음',
  'Titles only (recommended)': '제목만 (권장)',
  'Public links': '공개 링크도 포함',
  'All sanitized links': '모든 링크 (마스킹됨)',
  'Verified source': '확인된 소스',
  'Export Content': '내보낼 콘텐츠',
  PDF: 'PDF',
  'PDF Appearance': 'PDF 모양',
  'Use a centered, neutral reading layout': '가운데 정렬된 간결한 읽기 레이아웃 사용',
  'Minimal centered (recommended)': '간결한 가운데 정렬 (권장)',
  'Classic conversation cards': '기존 대화 카드',
  'Searchable Text': '검색 가능한 텍스트',
  'Add a searchable and copyable text layer to PDF pages':
    'PDF 페이지에 검색 및 복사 가능한 텍스트 레이어 추가',
  'Assistant Label': '어시스턴트 표시 이름',
  'Use provider or model name when available': '가능한 경우 플랫폼 또는 모델 이름 사용',
  'Message Timestamps': '메시지 시간',
  'Show input and answer times when available': '가능한 경우 입력 및 답변 시간 표시',
  'Auto (provider/model)': '자동 (플랫폼/모델)',
  Structure: '구성',
  'Export Artifacts': '산출물 내보내기',
  'Isolate code artifacts and documents': '코드 산출물과 문서를 별도로 출력',
  Refresh: '새로고침',
  'conversations found': '개의 대화',
  selected: '선택됨',
  'Search by title...': '제목으로 검색...',
  'Clear search': '검색 지우기',
  'Select all visible': '보이는 항목 모두 선택',
  'Deselect visible': '보이는 항목 선택 해제',
  'Select all visible conversations': '보이는 모든 대화 선택'
} satisfies Partial<Record<MessageKey, string>>

/** Format selector and buttons */
export const formatSelector = {
  'PDF Document': 'PDF 문서',
  Download: '다운로드',
  Export: '내보내기',
  Copy: '복사',
  'Export as PDF': 'PDF로 내보내기',
  'Export as Markdown': 'Markdown으로 내보내기',
  'Export as ZIP archive': 'ZIP 아카이브로 내보내기',
  'Will download: {0} ({1})': '다운로드 대상: {0} ({1})',
  'Pure Markdown document': '순수 Markdown 문서',
  'Markdown + references + tool records bundle': 'Markdown + 인용 + 도구 기록 패키지',
  'PDF document': 'PDF 문서',
  'Exporting...': '내보내는 중...',
  'Export Successful': '내보내기 성공'
} satisfies Partial<Record<MessageKey, string>>

/** Options page */
export const options = {
  'Extension Settings': '확장 프로그램 설정',
  'General & Appearance': '일반 및 모양',
  'Default Format': '기본 형식',
  'Primary format used for one-click exports': '원클릭 내보내기에 사용할 기본 형식',
  'UI Theme': 'UI 테마',
  'Select color theme for extension popup and options':
    '확장 프로그램과 설정 화면의 색상 테마 선택',
  'Light Mode': '라이트 모드',
  'Dark Mode': '다크 모드',
  English: '영어',
  简体中文: '중국어 간체',
  繁體中文: '중국어 번체',
  'Export Content Configuration': '내보내기 콘텐츠',
  'Filename Pattern': '파일 이름 패턴',
  Filename: '파일 이름',
  'Preview: {0}': '미리 보기: {0}',
  'Edit Pattern': '패턴 편집',
  Variables: '변수',
  Reset: '초기화',
  'Edit filename pattern': '파일 이름 패턴 편집',
  'Close filename editor': '파일 이름 편집기 닫기',
  'Insert {0}': '{0} 삽입',
  Preview: '미리 보기',
  'Download Folder Strategy': '다운로드 폴더',
  'Organize downloaded exports into subfolders': '내보내기를 하위 폴더에 정리',
  'Default Downloads Folder': '기본 다운로드 폴더',
  'Organize By Platform': '플랫폼별로 정리',
  'Use Custom Subfolder': '사용자 지정 하위 폴더 사용',
  'Custom Subfolder Name': '하위 폴더 이름',
  'Exports will be placed inside: Downloads/[folder name]': '저장 위치: Downloads/[폴더 이름]',
  'Where files can go': '저장 가능한 위치',
  'Choose Downloads root, a platform subfolder, or your own Downloads subfolder. Browser extensions cannot write directly to an arbitrary absolute path.':
    '다운로드 폴더의 최상위 위치, 플랫폼별 하위 폴더 또는 직접 지정한 하위 폴더를 선택하세요. 브라우저 확장 프로그램은 임의의 절대 경로에 직접 저장할 수 없습니다.',
  'Open Downloads Folder': '다운로드 폴더 열기',
  'Ask where to save interactive exports': '대화형 내보내기 시 저장 위치 묻기',
  'Opens the browser Save As chooser so you can select any local folder. This prompts once per file and is not used by scheduled export.':
    '브라우저의 다른 이름으로 저장 창에서 로컬 폴더를 선택합니다. 파일마다 확인하며 예약 내보내기에는 적용되지 않습니다.',
  'Write your own pattern or insert variables. {date} is the first day of this conversation; {end_date} is the export day.':
    '패턴을 직접 입력하거나 변수를 삽입하세요. {date}는 대화 시작일이고 {end_date}는 내보내는 날짜입니다.',
  '{last_message_datetime} uses device-local time with an offset (for example +0900 for JST). Missing times show unknown. This is the latest exported-message timestamp, not export time or a guarantee of the last content edit.':
    '{last_message_datetime}은 기기의 현지 시간과 시간대 오프셋(예: JST는 +0900)을 사용합니다. 시간이 없으면 unknown으로 표시합니다. 내보낸 메시지의 가장 최근 타임스탬프이며, 내보내기 시간이나 마지막 내용 수정 시간을 보장하지 않습니다.',
  'Last visible message date (local)': '마지막 표시 메시지 날짜(현지 시간)',
  'Last visible message date & time (local, with offset)':
    '마지막 표시 메시지 날짜 및 시간(현지 시간, 오프셋 포함)',
  'Conversation Date (start)': '대화 날짜(시작)',
  'Conversation Date & Time (start)': '대화 날짜 및 시간(시작)',
  'Export Date (YYYY-MM-DD)': '내보내기 날짜(YYYY-MM-DD)',
  'Conversation Date (start, alias)': '대화 날짜(시작, 별칭)',
  'Conversation Date & Time (start, alias)': '대화 날짜 및 시간(시작, 별칭)',
  'Conversation Title': '대화 제목',
  'Number (for bulk)': '번호(일괄 내보내기용)',
  'Message Count': '메시지 수',
  'Overwrite same-name scheduled files': '같은 이름의 예약 내보내기 파일 덮어쓰기',
  'Replaces an existing file only when the full download path matches. Use {platform}-{full_id} for one stable file per chat. Old differently named files are not removed. Manual exports are unchanged.':
    '전체 다운로드 경로가 같을 때만 기존 파일을 덮어씁니다. {platform}-{full_id}로 대화별 고정 이름을 사용할 수 있습니다. 이름이 다른 기존 파일은 삭제하지 않으며 수동 내보내기는 변경하지 않습니다.',
  'Conversation ID (full)': '전체 대화 ID',
  'Scheduled Auto-Export': '예약 자동 내보내기',
  'Silently export new chats automatically from platforms when extension is running in background. Files are saved in Markdown.':
    '확장 프로그램이 백그라운드에서 실행되는 동안 새 채팅을 자동으로 Markdown으로 저장합니다.',
  'Enable Scheduled Export': '예약 내보내기 사용',
  'Enables automated background scans and continuous backup':
    '자동 백그라운드 검사와 지속적인 백업을 사용합니다',
  'Request Rate Limit Delay': '요청 제한 대기 시간',
  'Max Conversations Per Run': '실행당 최대 대화 수',
  'Close Tab After Export': '내보낸 후 탭 닫기',
  'Platform Schedule Details': '플랫폼별 일정 설정',
  Frequency: '빈도',
  'Per-platform max': '플랫폼별 최대값',
  'Conversation concurrency': '동시 대화 처리 수',
  '{0} concurrent reads': '동시 읽기 {0}개',
  'Platforms in Parallel': '동시 실행 플랫폼',
  'Background Task Status': '백그라운드 작업 상태',
  'Trigger Run Now': '지금 실행',
  'Clear Logs & History': '로그 및 기록 지우기',
  About: '확장 프로그램 정보',
  'Settings saved successfully!': '설정을 저장했습니다!',
  'Settings could not be saved.': '설정을 저장하지 못했습니다.',
  'Settings could not be saved. Please retry.': '설정을 저장하지 못했습니다. 다시 시도하세요.'
} satisfies Partial<Record<MessageKey, string>>

/** Preview page */
export const preview = {
  'Format:': '형식:',
  Selected: '선택됨',
  'View GitHub Repository': 'GitHub 저장소 열기',
  'Select all conversations': '모든 대화 선택',
  'Select all': '모두 선택',
  'Deselect all': '모두 선택 해제',
  'Conversation library': '대화 목록',
  Schedule: '일정',
  On: '켜짐',
  Off: '꺼짐',
  'Export interval': '내보내기 간격',
  'Runs every {0} minutes for enabled platforms. You can override an individual platform below.':
    '활성화된 플랫폼에서 {0}분마다 실행됩니다. 아래에서 플랫폼별로 변경할 수 있습니다.',
  'Scheduled export interval (minutes)': '예약 내보내기 간격(분)',
  min: '분',
  'Custom interval': '사용자 지정 간격',
  'Interval (minutes)': '간격(분)',
  Collapse: '접기',
  Expand: '펼치기',
  Output: '출력',
  'Saved to': '저장 위치',
  'Scheduled exports are Markdown only — the background worker cannot render PDF. PDF remains available from manual Current Chat and Bulk Export.':
    '예약 내보내기는 Markdown만 지원합니다. 백그라운드 작업자는 PDF를 만들 수 없습니다. PDF는 현재 채팅과 일괄 내보내기에서 계속 사용할 수 있습니다.',
  'Runs while Chrome and the extension are alive. Changing the interval above applies that rolling schedule to every enabled platform; individual platform settings can override it. A set time means at or shortly after it — never to the exact second.':
    'Chrome과 확장 프로그램이 실행 중일 때 동작합니다. 위의 간격은 모든 활성화 플랫폼에 적용되며, 개별 플랫폼 설정으로 덮어쓸 수 있습니다. 지정 시각 직후에 실행되며 초 단위로 정확하지는 않습니다.',
  'Time (local)': '시간(현지)',
  Day: '요일'
} satisfies Partial<Record<MessageKey, string>>

/** Generated Markdown/PDF documents */
export const exportedDocument = {
  Language: '언어',
  Platform: '플랫폼',
  'Image unavailable': '이미지를 사용할 수 없음',
  'Image attachment': '이미지 첨부',
  'image omitted': '이미지 생략됨',
  'external image content is not embedded': '외부 이미지 콘텐츠는 포함되지 않음',
  'image unavailable': '이미지를 사용할 수 없음'
} satisfies Partial<Record<MessageKey, string>>

/** Selection export and fidelity warnings */
export const exportScope = {
  'Heuristic credential redaction only. Review names, private content and unrecognized secrets before sharing.':
    '일반적인 인증 정보만 추정하여 가립니다. 공유 전에 이름, 비공개 내용과 감지되지 않은 비밀 정보를 확인하세요.',
  'Export scope': '내보내기 범위',
  'All messages': '모든 메시지',
  'Select messages': '메시지 선택',
  'Last answer': '마지막 답변',
  '{0} of {1} selected': '{0}/{1}개 선택됨',
  'Select message {0}': '메시지 {0} 선택',
  'Partial export: only the selected messages are included. This is not a complete archive.':
    '부분 내보내기: 선택한 메시지만 포함되며 전체 아카이브가 아닙니다.',
  'Partial export: {0} of {1} messages. This is not a complete conversation archive.':
    '부분 내보내기: 전체 {1}개 중 {0}개 메시지. 완전한 대화 아카이브가 아닙니다.',
  'Archive bundles are unavailable for partial exports; download uses Markdown.':
    '부분 내보내기에는 아카이브 번들을 사용할 수 없으며 Markdown으로 다운로드됩니다.',
  'No assistant answer is available to export.': '내보낼 어시스턴트 답변이 없습니다.',
  'Select at least one message to copy or download.':
    '복사하거나 다운로드할 메시지를 하나 이상 선택하세요.',
  'Select at least one message to export': '내보낼 메시지를 하나 이상 선택하세요',
  'What this export includes': '이 내보내기에 포함된 내용',
  '{0} messages · {1} source references · {2} attachment labels · {3} artifact bodies':
    '메시지 {0}개 · 출처 참조 {1}개 · 첨부 라벨 {2}개 · 아티팩트 본문 {3}개',
  '{0} artifacts have no captured body. Only their available labels or links are included.':
    '아티팩트 {0}개의 본문이 캡처되지 않았습니다. 사용 가능한 라벨 또는 링크만 포함됩니다.',
  '{0} images have no available URL. Their labels remain in the export.':
    '이미지 {0}개의 URL을 사용할 수 없습니다. 라벨은 내보내기에 유지됩니다.',
  'External files are not downloaded. Remote images may expire. Interactive apps, Canvas documents and artifact versions are not guaranteed to be captured.':
    '외부 파일은 다운로드되지 않습니다. 원격 이미지는 만료될 수 있습니다. 대화형 앱, Canvas 문서 및 아티팩트 버전은 캡처가 보장되지 않습니다.',
  'The ZIP preserves captured inline artifact text. It does not replay interactive apps or include their server data.':
    'ZIP 파일은 캡처된 인라인 아티팩트 텍스트만 보존합니다. 대화형 앱을 다시 실행하거나 서버 데이터를 포함하지 않습니다.'
} satisfies Partial<Record<MessageKey, string>>

/** Export results, workspace handoff and preset copy */
export const exportFlow = {
  'Exported: {0}': '내보내기 완료: {0}',
  'Open download folder': '다운로드 폴더 열기',
  'Could not open the download folder.': '다운로드 폴더를 열 수 없습니다.',
  Cancelled: '취소됨',
  'Recapture failed: {0}': '다시 캡처 실패: {0}',
  'Showing the previous capture from {0}.': '{0}의 이전 캡처 내용을 표시하고 있습니다.',
  'This workspace handoff belongs to a different tab. Defaults were restored; please reselect conversations.':
    '이 워크스페이스 전달 데이터는 다른 탭에 속해 있습니다. 기본값으로 복원되었으니 대화를 다시 선택하세요.',
  'The workspace handoff expired or was already used. Defaults were restored; please reselect conversations.':
    '워크스페이스 전달 데이터가 만료되었거나 이미 사용되었습니다. 기본값으로 복원되었으니 대화를 다시 선택하세요.',
  '{0} restored selection(s) are not in the refreshed list and were skipped.':
    '복원된 선택 항목 중 {0}개가 새로고침된 목록에 없어 건너뛰었습니다.',
  'Per-platform subfolders': '플랫폼별 하위 폴더',
  'Browser default download folder': '브라우저 기본 다운로드 폴더',
  'Scope: {0} selected conversations · {1} · saved to {2}':
    '범위: 선택한 대화 {0}개 · {1} · 저장 위치: {2}',
  'Workspace opened without your current selection: session storage is unavailable.':
    '현재 선택 항목을 유지하지 못한 채 워크스페이스를 열었습니다. 세션 저장소를 사용할 수 없습니다.',
  'Reading PDF': '열람용 PDF',
  'Editable Markdown': '편집 가능한 Markdown',
  'Archive ZIP': '아카이브 ZIP',
  'Your current selection could not be carried over: session storage is unavailable. The workspace was not opened.':
    '현재 선택 항목을 유지할 수 없습니다. 세션 저장소를 사용할 수 없어 워크스페이스를 열지 않았습니다.',
  'Open workspace without selection': '선택 항목 없이 워크스페이스 열기'
} satisfies Partial<Record<MessageKey, string>>

/** Page snapshot and local recovery */
export const snapshot = {
  'Page snapshot': '페이지 스냅샷',
  'Capture page snapshot': '페이지 캡처',
  'Capturing…': '캡처 중…',
  'Save Markdown': 'Markdown 저장',
  'Copy Markdown': 'Markdown 복사',
  'Copying…': '복사 중…',
  'Preview ↗': '미리보기 ↗',
  'Export PDF ↗': 'PDF 내보내기 ↗',
  Recapture: '다시 캡처',
  'Local recovery': '로컬 복구',
  'Protection on': '보호 켜짐',
  Paused: '일시 중지',
  'Stop protection': '보호 중지',
  'Open recovery page': '복구 페이지 열기',
  'Capture failed. Please retry.': '캡처 실패. 다시 시도하세요.',
  'The page changed while capturing. Please retry.':
    '캡처하는 동안 페이지가 변경되었습니다. 다시 시도하세요.',
  'Saved {0}': '{0} 저장됨',
  'This chat could not be verified as complete, so a page snapshot was saved instead: {0}. It contains what the page has loaded.':
    '이 대화가 완전한지 확인할 수 없어 대신 페이지 스냅샷을 저장했습니다: {0}. 페이지에 로드된 내용만 포함됩니다.',
  'A page snapshot could not be saved either: {0}': '페이지 스냅샷도 저장하지 못했습니다: {0}',
  'Copy failed': '복사 실패',
  'You can still save what this page shows with “Capture page snapshot” below.':
    '아래 “페이지 캡처”로 이 페이지에 표시된 내용은 저장할 수 있습니다.',
  'Copied Markdown!': 'Markdown 복사 완료!',
  'Still generating': '생성 중',
  'Generation stopped': '생성 중지',
  'Generation status unknown': '생성 상태 알 수 없음',
  'Captured: {0}': '캡처: {0}',
  'Last saved: {0}': '마지막 저장: {0}',
  'Save failed': '저장 실패',
  'Save failed: {0}': '저장 실패: {0}',
  'Preparing preview…': '미리보기 준비 중…',
  'Working…': '처리 중…',
  'Download Markdown': 'Markdown 다운로드',
  'Download PDF': 'PDF 다운로드',
  'Cancel download': '다운로드 취소',
  'Delete temporary snapshot': '임시 스냅샷 삭제',
  'Download cancelled': '다운로드가 취소되었습니다',
  'Could not delete temporary snapshot': '임시 스냅샷을 삭제할 수 없습니다',
  'Local recovery drafts': '로컬 복구 초안',
  'No recovery drafts available.': '복구할 초안이 없습니다.',
  'Loading recovery drafts…': '복구 초안 불러오는 중…',
  'Delete all drafts': '모든 초안 삭제',
  'Delete permanently': '영구 삭제',
  'Confirm deletion': '삭제 확인',
  'Untitled conversation': '제목 없는 대화',
  'Captured {0}': '캡처 {0}',
  'Last saved {0}': '마지막 저장 {0}',
  'The answer was still generating at capture time.': '캡처 당시 답변이 생성 중이었습니다.',
  'Generation status at capture time is unknown.': '캡처 당시 생성 상태를 알 수 없습니다.',
  'Snapshot output could not be prepared under the current settings.':
    '현재 설정으로 스냅샷을 출력할 수 없습니다.',
  'Page snapshot is unavailable for preview': '페이지 스냅샷을 미리 볼 수 없습니다',
  'Recovery draft is missing or invalid': '복구 초안이 없거나 올바르지 않습니다',
  Delete: '삭제',
  Cancel: '취소',
  'The source tab was closed before the capture finished. Please retry.':
    '캡처 완료 전에 원본 탭이 닫혔습니다. 다시 시도하세요.',
  'Open a supported conversation tab to capture a snapshot.': '지원되는 대화 탭을 열어 캡처하세요.',
  'Download cancelled. Nothing was saved.': '다운로드 취소됨. 저장된 파일이 없습니다.',
  'Preview is unavailable right now.': '지금 미리보기를 사용할 수 없습니다.',
  'Protection could not be enabled. Please retry.': '보호를 켤 수 없습니다. 다시 시도하세요.',
  'Protection could not be stopped. Please retry.': '보호를 중지할 수 없습니다. 다시 시도하세요.',
  'Save the conversation content currently loaded and readable on this page. The full history is not verified.':
    '현재 페이지에 로드되어 읽을 수 있는 대화만 저장합니다. 전체 기록은 확인되지 않았습니다.',
  'Scope: content observed on this page (DOM only)': '범위: 이 페이지에서 확인된 콘텐츠(DOM만)',
  'The source tab was closed. This captured snapshot can still be exported.':
    '원본 탭이 닫혔습니다. 캡처된 스냅샷은 계속 내보낼 수 있습니다.',
  'PDF opens in the preview page; keep that tab open until the download finishes.':
    'PDF는 미리보기 페이지에서 열립니다. 다운로드가 끝날 때까지 탭을 유지하세요.',
  'Markdown and PDF only — no ZIP archives, raw provider data, or tool records. Output follows your current privacy settings.':
    'Markdown과 PDF만 지원합니다. ZIP, 제공자 원본 데이터, 도구 기록은 제외하며 현재 개인정보 설정을 따릅니다.',
  'Local protection is on for this conversation.': '이 대화의 로컬 보호가 켜졌습니다.',
  'Local protection is paused for this conversation.': '이 대화의 로컬 보호가 일시 중지되었습니다.',
  'Drafts can be viewed and cleared on the recovery page.':
    '복구 페이지에서 초안을 확인하고 삭제할 수 있습니다.',
  'Enable local protection for this conversation': '이 대화의 로컬 보호 켜기',
  'PDF export does not start automatically. Choose Download PDF below when you are ready.':
    'PDF 내보내기는 자동으로 시작되지 않습니다. 준비되면 아래 PDF 다운로드를 선택하세요.',
  'Copy and download are disabled. Adjust the output settings and reopen the preview to export this capture.':
    '복사와 다운로드가 비활성화되었습니다. 출력 설정을 바꾸고 미리보기를 다시 여세요.',
  'Saved checkpoints contain only observed page content, not complete verified history. They cannot restore a conversation to its provider.':
    '저장된 체크포인트는 페이지에서 확인된 내용만 포함하며 검증된 전체 기록이 아닙니다. 제공자 대화를 복원할 수 없습니다.',
  'Drafts stay only in this browser — retained for up to 7 days and limited to 4 MiB.':
    '초안은 이 브라우저에만 최대 7일 동안 총 4 MiB까지 저장됩니다.',
  'Drafts stay only in this browser and are limited to 4 MiB in total.':
    '초안은 이 브라우저에만 총 4 MiB까지 저장됩니다.',
  'Optional and off by default. When enabled, the visible content of this conversation is kept as a recovery draft that stays only in this browser, for 7 days unless you choose a longer time on the recovery page, up to 4 MiB in total. Nothing is uploaded or synced, and protection does not restart by itself after the browser restarts.':
    '선택 기능이며 기본적으로 꺼져 있습니다. 켜면 이 대화의 보이는 내용이 복구 초안으로 이 브라우저에만 저장되며, 보관 기간은 기본 7일(복구 페이지에서 늘릴 수 있음), 총 4 MiB까지입니다. 업로드나 동기화는 없으며 브라우저를 다시 시작해도 보호가 자동 재개되지 않습니다.',
  'Enable expanded local storage': '확장 로컬 저장소 사용',
  'Use default storage limits': '기본 저장 한도 사용',
  'Expanded storage is on: no fixed draft byte limit. Browser and disk limits still apply; at most 20 drafts.':
    '확장 저장소 사용 중: 고정 용량 제한은 없지만 브라우저와 디스크 제한이 적용됩니다. 초안은 최대 20개입니다.',
  'Default storage: 1 MiB per draft, 4 MiB total, at most 20 drafts. Existing drafts are not evicted to make room.':
    '기본: 초안당 1 MiB, 총 4 MiB, 최대 20개. 공간 확보를 위해 기존 초안을 삭제하지 않습니다.',
  'Expanded storage needs browser permission. It does not upload or sync drafts. Returning to default limits keeps existing drafts but may pause new saves.':
    '확장 저장소에는 브라우저 권한이 필요하며 업로드나 동기화는 하지 않습니다. 기본 한도로 돌아가도 기존 초안은 유지되지만 새 저장이 일시 중지될 수 있습니다.',
  'Storage permission was not granted. Existing drafts were retained.':
    '저장 권한이 허용되지 않았습니다. 기존 초안은 유지됩니다.',
  'Storage setting could not be saved. Please retry.':
    '저장 설정을 저장하지 못했습니다. 다시 시도하세요.',
  'Save Markdown directly': 'Markdown 직접 저장',
  'Direct Markdown saving does not use the 1 MiB temporary preview cache.':
    'Markdown 직접 저장은 1 MiB 임시 미리보기 캐시를 사용하지 않습니다.',
  'Markdown saved.': 'Markdown이 저장되었습니다.',
  'Download failed or was cancelled. Please retry.':
    '다운로드가 실패하거나 취소되었습니다. 다시 시도하세요.',
  'Local recovery is off by default and stays only in this browser. Default limits are 7 days and 4 MiB total. Change retention or enable expanded storage on the recovery page. Nothing is uploaded or synced; protection does not resume after a browser restart.':
    '로컬 복구는 기본적으로 꺼져 있으며 이 브라우저에만 저장됩니다. 기본은 7일, 총 4 MiB입니다. 복구 페이지에서 보관 기간을 바꾸거나 확장 저장소를 켤 수 있습니다. 업로드나 동기화는 없으며 브라우저 재시작 후 자동 재개되지 않습니다.',
  'Keep drafts for': '초안 보관 기간',
  '{0} days': '{0}일',
  'Until I delete them': '직접 삭제할 때까지',
  'Retention could not be saved. Please retry.':
    '보관 기간을 저장하지 못했습니다. 다시 시도하세요.',
  'Open fixed snapshot preview (copy / Markdown / PDF)':
    '고정 스냅샷 미리보기 열기(복사 / Markdown / PDF)',
  'Heuristic safe-share: {0} redactions; review for remaining sensitive information.':
    '휴리스틱 공유 처리로 {0}건 가렸습니다. 남은 민감 정보를 확인하세요.',
  'Optional and off by default. When enabled, the visible content of this conversation is kept as a recovery draft that stays only in this browser — retained for up to 7 days and limited to 4 MiB. Nothing is uploaded or synced, and protection does not restart by itself after the browser restarts.':
    '선택 기능이며 기본적으로 꺼져 있습니다. 켜면 이 대화의 보이는 내용이 복구 초안으로 이 브라우저에만 최대 7일, 총 4 MiB까지 저장됩니다. 업로드나 동기화는 없으며 브라우저를 다시 시작해도 보호가 자동 재개되지 않습니다.',
  "Stopping protection does not delete saved drafts. Deleting a draft also stops that draft's protection, and protection does not resume by itself.":
    '보호를 중지해도 저장된 초안은 삭제되지 않습니다. 초안을 삭제하면 해당 보호도 중지되며 자동 재개되지 않습니다.',
  'Permanently delete all local recovery drafts? This cannot be undone. Any draft still under protection loses that protection and it does not resume by itself.':
    '모든 로컬 복구 초안을 영구 삭제할까요? 되돌릴 수 없습니다. 보호 중인 초안도 보호가 중지되고 자동 재개되지 않습니다.',
  'Permanently delete this local recovery draft? This cannot be undone. If this draft is still protected, protection stops and does not resume by itself.':
    '이 로컬 복구 초안을 영구 삭제할까요? 되돌릴 수 없습니다. 보호 중이면 보호가 중지되고 자동 재개되지 않습니다.',
  'Page snapshot · captured at {0}. Includes only conversation content loaded and readable on this page at capture time; complete history has not been verified. Unloaded messages and external attachment contents may be absent.':
    '페이지 스냅샷 · {0}에 캡처. 캡처 당시 로드되어 읽을 수 있던 대화만 포함하며 전체 기록은 검증되지 않았습니다. 로드되지 않은 메시지와 외부 첨부 내용은 빠질 수 있습니다.',
  'External image content may be unavailable.': '외부 이미지 콘텐츠를 사용할 수 없을 수 있습니다.',
  'Recovery request failed. Please retry.': '복구 요청 실패. 다시 시도하세요.',
  'Invalid recovery list': '복구 목록이 올바르지 않습니다',
  'Recovery list unavailable': '복구 목록을 사용할 수 없습니다',
  'Recovery draft unavailable': '복구 초안을 사용할 수 없습니다',
  'Preview could not be opened': '미리보기를 열 수 없습니다',
  'The recovery drafts could not be deleted. Saved content was retained; please retry.':
    '복구 초안을 삭제할 수 없습니다. 저장된 내용은 유지됩니다. 다시 시도하세요.',
  'The recovery draft could not be deleted. Saved content was retained; please retry.':
    '복구 초안을 삭제할 수 없습니다. 저장된 내용은 유지됩니다. 다시 시도하세요.'
} satisfies Partial<Record<MessageKey, string>>

/** Quick start, onboarding and popup main flow */
export const onboarding = {
  'Download ZIP': 'ZIP 다운로드',
  'Capture without downloading': '다운로드 없이 캡처',
  'Capture first to inspect or copy the page before saving. The main save button above captures and downloads in one step.':
    '먼저 캡처하면 저장 전에 확인하거나 복사할 수 있습니다. 위의 저장 버튼은 캡처와 다운로드를 한 번에 수행합니다.',
  'Quick start': '빠른 시작',
  '1. Open your chat': '1. 대화 열기',
  'Open a conversation on a supported site, then click the extension icon again.':
    '지원되는 사이트에서 대화를 연 다음 확장 프로그램 아이콘을 다시 클릭하세요.',
  '2. Choose a file': '2. 파일 형식 선택',
  'PDF for reading or printing. Markdown for editing. ZIP for an archive with inline source files.':
    '읽거나 인쇄할 때는 PDF, 편집할 때는 Markdown, 인라인 소스 파일이 포함된 보관용은 ZIP을 선택하세요.',
  '3. Save and find it': '3. 저장하고 찾기',
  'Files go to your browser download folder unless you choose another location in Settings.':
    '설정에서 다른 위치를 선택하지 않았다면 파일은 브라우저 다운로드 폴더에 저장됩니다.',
  'Preview lets you select messages or save only the last answer.':
    '미리보기에서 메시지를 선택하거나 마지막 답변만 저장할 수 있습니다.',
  'No exporter account. Chats are processed in your browser; preview copies and optional recovery drafts use extension storage. External images may load from their original sites.':
    '계정이 필요 없습니다. 대화는 브라우저에서 처리되며 미리보기 사본과 선택적 복구 초안은 확장 프로그램 저장소를 사용합니다. 외부 이미지는 원래 사이트에서 로드될 수 있습니다.',
  'Preview & select messages': '미리보기 및 메시지 선택',
  'PDF for reading or printing.': 'PDF는 읽기나 인쇄에 적합합니다.',
  'ZIP contains Markdown, a manifest and captured inline files. External files are not downloaded.':
    'ZIP에는 Markdown, 매니페스트, 캡처된 인라인 파일이 포함됩니다. 외부 파일은 다운로드되지 않습니다.',
  'Markdown for editing in a notes app.': 'Markdown은 노트 앱에서 편집하기에 적합합니다.',
  'Complete history could not be verified. This action saves only content loaded on this page as a labelled snapshot, not a complete archive.':
    '전체 기록을 확인할 수 없습니다. 이 작업은 이 페이지에 로드된 내용만 라벨이 붙은 스냅샷으로 저장하며 완전한 아카이브가 아닙니다.',
  'Preview page snapshot PDF': '페이지 스냅샷 PDF 미리보기',
  'Save page snapshot Markdown': '페이지 스냅샷 Markdown 저장',
  'The snapshot filename includes its capture time and is not added to complete-archive history.':
    '스냅샷 파일 이름에는 캡처 시간이 포함되며 완전 아카이브 기록에 추가되지 않습니다.',
  'Saved to: {0}': '저장 위치: {0}',
  'Choose a location when saving': '저장 시 위치 선택',
  'Change in Settings': '설정에서 변경',
  'Share copy is on. Common credentials are hidden, but review private content before sharing.':
    '공유 사본이 켜져 있습니다. 일반적인 인증 정보는 가려지지만 공유 전에 비공개 내용을 확인하세요.',
  'Source structure is verified, not authenticity or all external resources.':
    '소스 구조는 확인되었지만 진위나 모든 외부 리소스가 보장되지는 않습니다.'
} satisfies Partial<Record<MessageKey, string>>

/** Provider error messages */
export const providerErrors = {
  'No conversation open': '열린 대화가 없습니다',
  'Open a conversation for current-chat export, or use Bulk Export to load account history.':
    '현재 대화를 내보내려면 대화를 여세요. 일괄 내보내기로 계정 기록을 불러올 수도 있습니다.',
  '{0} could not verify the complete conversation. Reload the provider page and retry.':
    '{0} 대화의 완전성을 확인하지 못했습니다. 사이트를 새로고침한 후 다시 시도하세요.',
  'Sign in to the provider, then refresh the conversation list.':
    '해당 사이트에 로그인한 후 대화 목록을 새로고침하세요.',
  'History loading timed out. Showing only visible sidebar conversations; refresh to retry.':
    '기록 로딩 시간이 초과되었습니다. 사이드바에 보이는 대화만 표시되며 전체 기록이 아닙니다. 새로고침하세요.',
  'History could not be loaded. Reload the provider page and refresh the list.':
    '대화 기록을 불러오지 못했습니다. 사이트를 새로고침한 후 목록을 갱신하세요.',
  'Provider read timed out. Refresh to retry.':
    '사이트 읽기 시간이 초과되었습니다. 새로고침하세요.',
  'The operation failed. Reload the provider page and retry.':
    '작업에 실패했습니다. 사이트를 새로고침한 후 다시 시도하세요.'
} satisfies Partial<Record<MessageKey, string>>

export const ko: Partial<Record<MessageKey, string>> = {
  ...exportOptions,
  ...popup,
  ...formatSelector,
  ...options,
  ...preview,
  ...exportedDocument,
  ...exportScope,
  ...exportFlow,
  ...snapshot,
  ...onboarding,
  ...providerErrors
}
