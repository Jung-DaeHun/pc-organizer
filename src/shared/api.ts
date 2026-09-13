import type {
  AdvisorPreview,
  AppsInfo,
  DriveInfo,
  ExecuteOutcome,
  ExecuteProgress,
  ExecuteRequest,
  JournalEntry,
  OrganizePlan,
  ScanProgress,
  ScanResult,
  Settings,
  TrashOutcome,
  TrashPlan,
  TrashProgress,
  TrashRequest,
  UndoOutcome
} from './types'

/**
 * preload가 renderer에 노출하는 API의 계약.
 *
 * 이 인터페이스를 preload(구현)와 renderer(사용) 양쪽이 함께 참조하므로,
 * 한쪽만 바뀌면 타입 검사에서 걸린다.
 *
 * 계획 세우기까지는 조회 전용이다. 파일을 움직이는 채널은 executePlan 과 runUndo(둘 다 rename 만),
 * 그리고 executeTrash(윈도우 휴지통으로 — 영구 삭제 아님) 셋뿐이다.
 */
export interface RendererApi {
  /** main 프로세스가 살아있는지 확인하는 왕복 */
  ping(): Promise<string>

  /** 로컬 드라이브 목록과 용량 */
  listDrives(): Promise<DriveInfo[]>

  /** 저장된 설정 (감시 폴더, 임계값 등) */
  getSettings(): Promise<Settings>
  updateSettings(patch: Partial<Settings>): Promise<Settings>

  /** 폴더 선택 대화상자를 띄운다. 취소하면 null */
  pickFolder(): Promise<string | null>

  /** 등록된 폴더를 전부 훑고 집계 결과를 돌려준다 */
  runScan(): Promise<ScanResult>

  /** 스캔 진행률 구독. 반환된 함수를 부르면 구독이 끊긴다 */
  onScanProgress(callback: (progress: ScanProgress) => void): () => void

  /** 설치된 앱과 시작 프로그램 */
  listApps(): Promise<AppsInfo>

  /**
   * 윈도우 설정의 '앱 > 설치된 앱'을 연다. 제거는 거기서 사용자가 한다 — 이 앱은 프로그램을 제거하지도,
   * 제거 프로그램을 실행하지도 않는다. 인자가 없다 (여는 URI 는 main 에 고정)
   */
  openAppsSettings(): Promise<void>

  /**
   * 감시 폴더 하나의 정리 계획을 확장자 규칙으로 세운다. 스캔이 먼저 있어야 한다.
   * 계획을 세우기만 하고 파일은 건드리지 않는다.
   *
   * @param scannedAt 화면에 보이는 ScanResult.scannedAt — main 의 목록이 같은 스캔인지 확인한다
   */
  buildPlan(root: string, scannedAt: number): Promise<OrganizePlan>

  /** AI 에게 보낼 내용의 요약. 네트워크를 타지 않는다 — 사용자가 이걸 보고 동의한다 */
  previewAdvice(): Promise<AdvisorPreview>

  /**
   * 마지막 계획을 AI 에게 보내 추천을 얹는다. 이 앱에서 네트워크로 나가는 유일한 호출이며,
   * 사용자가 previewAdvice 내용을 보고 누른 뒤에만 부른다.
   */
  advisePlan(): Promise<OrganizePlan>

  /**
   * 판에서 승인한 이동을 실행한다. **사용자 파일을 움직이는 유일한 호출.**
   * main 은 요청을 자기 계획(lastPlan)과 대조하고, 사전 점검에서 하나라도 걸리면 아무것도 옮기지 않는다.
   * 실행 뒤에는 스캔 결과가 낡으므로 다시 스캔해야 계획을 세울 수 있다.
   */
  executePlan(requests: ExecuteRequest[]): Promise<ExecuteOutcome>

  /** 실행 진행률 구독. 반환된 함수를 부르면 구독이 끊긴다 */
  onExecuteProgress(callback: (progress: ExecuteProgress) => void): () => void

  /** 실행 기록(이동·휴지통). 최근 것이 앞 */
  listUndo(): Promise<JournalEntry[]>

  /** 실행 기록 하나를 되돌린다 (ok 였던 이동을 역순으로 to → from). 한 기록은 한 번만 */
  runUndo(id: string): Promise<UndoOutcome>

  /**
   * 마지막 스캔의 중복 후보로 휴지통 계획을 세운다. 스캔이 이미 계산한 그룹을 쓰므로 파일을 읽지 않고,
   * 계획을 세우기만 하고 파일은 건드리지 않는다.
   *
   * @param scannedAt 화면에 보이는 ScanResult.scannedAt — main 의 그룹이 같은 스캔인지 확인한다
   */
  buildTrashPlan(scannedAt: number): Promise<TrashPlan>

  /**
   * 화면에서 확인한 그룹의 나머지 사본을 휴지통으로 보낸다. **사용자 파일을 휴지통으로 보내는 유일한 호출.**
   * 요청은 그룹마다 남길 파일 id 뿐이고, main 은 자기 계획(lastTrashPlan)과 대조한 뒤 전체 해시로 다시
   * 비교해 하나라도 다르면 아무것도 보내지 않는다. 보낸 뒤에는 스캔 결과가 낡으므로 다시 스캔해야 한다.
   * 되돌리기는 없다 — 윈도우 휴지통에서 복원한다.
   */
  executeTrash(requests: TrashRequest[]): Promise<TrashOutcome>

  /** 휴지통 보내기 진행률(전체 해시 비교 → 보내는 중) 구독. 반환된 함수를 부르면 구독이 끊긴다 */
  onTrashProgress(callback: (progress: TrashProgress) => void): () => void

  /**
   * Anthropic API 키. 저장은 main 이 암호화해서 하고, 돌려받는 건 '있다/없다' 뿐이다.
   * 키 값을 renderer 로 되돌려주는 함수는 의도적으로 없다.
   */
  setApiKey(key: string): Promise<void>
  hasApiKey(): Promise<boolean>
  clearApiKey(): Promise<void>
}
