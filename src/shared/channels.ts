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
  appsList: 'apps:list'
} as const

export type Channel = (typeof CH)[keyof typeof CH]
