import type { AppsInfo, DriveInfo, ScanProgress, ScanResult, Settings } from './types'

/**
 * preload가 renderer에 노출하는 API의 계약.
 *
 * 이 인터페이스를 preload(구현)와 renderer(사용) 양쪽이 함께 참조하므로,
 * 한쪽만 바뀌면 타입 검사에서 걸린다.
 *
 * 1단계에서는 조회 전용이다. 파일을 옮기거나 지우는 채널은 하나도 없다.
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
}
