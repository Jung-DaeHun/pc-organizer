/**
 * main <-> renderer 사이에서 쓰는 IPC 채널 이름.
 * 문자열을 양쪽에서 따로 적으면 오타가 런타임에야 드러나므로 여기 한 곳에서만 정의한다.
 */
export const CH = {
  /** 연결 확인용 왕복 */
  ping: 'app:ping',

  /** 드라이브 목록 + 용량 */
  drivesList: 'drives:list',

  /** 설정 읽기 / 쓰기 */
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',

  /** 폴더 선택 대화상자 */
  foldersPick: 'folders:pick',

  /** 스캔 실행 (invoke) 과 진행률 (main -> renderer) */
  scanRun: 'scan:run',
  scanProgress: 'scan:progress',

  /** 설치된 앱 + 시작 프로그램 */
  appsList: 'apps:list',

  /** 정리 계획 (조회 전용 — 파일은 건드리지 않는다) */
  planBuild: 'plan:build',
  /** AI 추천: preview 는 보낼 내용 요약(네트워크 없음), advise 가 실제 호출 */
  planAdvisePreview: 'plan:advise-preview',
  planAdvise: 'plan:advise',

  /** API 키. 키 값이 renderer 로 돌아오는 채널은 없다 */
  secretsSetApiKey: 'secrets:set-api-key',
  secretsHasApiKey: 'secrets:has-api-key',
  secretsClearApiKey: 'secrets:clear-api-key'
} as const

export type Channel = (typeof CH)[keyof typeof CH]
