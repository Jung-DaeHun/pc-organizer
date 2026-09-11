import type {
  AdvisorPreview,
  AppsInfo,
  DriveInfo,
  OrganizePlan,
  ScanProgress,
  ScanResult,
  Settings
} from './types'

/**
 * preload가 renderer에 노출하는 API의 계약.
 *
 * 이 인터페이스를 preload(구현)와 renderer(사용) 양쪽이 함께 참조하므로,
 * 한쪽만 바뀌면 타입 검사에서 걸린다.
 *
 * 계획 세우기까지는 조회 전용이다. 파일을 옮기거나 지우는 채널은 아직 하나도 없다.
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
   * Anthropic API 키. 저장은 main 이 암호화해서 하고, 돌려받는 건 '있다/없다' 뿐이다.
   * 키 값을 renderer 로 되돌려주는 함수는 의도적으로 없다.
   */
  setApiKey(key: string): Promise<void>
  hasApiKey(): Promise<boolean>
  clearApiKey(): Promise<void>
}
