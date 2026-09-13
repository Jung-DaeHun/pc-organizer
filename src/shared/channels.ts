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

  /**
   * 실행 (B 단계) — 이 앱에서 사용자 파일을 움직이는 유일한 채널. 저널에 남기고 실행취소로 되돌린다.
   * execute 는 invoke, progress 는 main -> renderer
   */
  planExecute: 'plan:execute',
  planExecuteProgress: 'plan:execute-progress',
  /** 실행 기록 조회와 되돌리기 */
  undoList: 'undo:list',
  undoRun: 'undo:run',

  /**
   * 중복 후보 → 휴지통 (B3). build 는 조회 전용 — 스캔이 계산해 둔 그룹을 계획 모양으로 바꿀 뿐
   * 파일을 읽지도 건드리지도 않는다. execute 가 이 앱에서 사용자 파일을 휴지통으로 보내는 유일한 채널이다
   * (영구 삭제 아님). 전체 해시로 다시 비교한 뒤에만 보내고, 저널에 남긴다. progress 는 main -> renderer
   */
  trashBuild: 'trash:build',
  trashExecute: 'trash:execute',
  trashExecuteProgress: 'trash:execute-progress',

  /** API 키. 키 값이 renderer 로 돌아오는 채널은 없다 */
  secretsSetApiKey: 'secrets:set-api-key',
  secretsHasApiKey: 'secrets:has-api-key',
  secretsClearApiKey: 'secrets:clear-api-key'
} as const

export type Channel = (typeof CH)[keyof typeof CH]
