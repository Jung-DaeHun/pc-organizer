/**
 * main 프로세스와 renderer가 함께 쓰는 타입.
 * IPC를 건너다니는 값은 structured clone 가능해야 하므로 전부 순수 데이터로 둔다.
 */

// ---------------------------------------------------------------- 드라이브

export interface DriveInfo {
  /** 'C:' 형태 */
  letter: string
  /** 볼륨 라벨. 없으면 빈 문자열 */
  label: string
  totalBytes: number
  freeBytes: number
}

// ---------------------------------------------------------------- 파일

export const FILE_CATEGORIES = [
  'document',
  'image',
  'video',
  'audio',
  'archive',
  'installer',
  'code',
  'other'
] as const

export type FileCategory = (typeof FILE_CATEGORIES)[number]

/** 화면에 보여줄 한글 이름 */
export const CATEGORY_LABELS: Record<FileCategory, string> = {
  document: '문서',
  image: '이미지',
  video: '영상',
  audio: '음악',
  archive: '압축',
  installer: '설치파일',
  code: '코드',
  other: '기타'
}

export interface FileEntry {
  path: string
  name: string
  /** 소문자, 점 포함 ('.pdf'). 확장자가 없으면 빈 문자열 */
  ext: string
  size: number
  mtimeMs: number
  atimeMs: number
  category: FileCategory
  /**
   * OneDrive 등에서 클라우드에만 있고 로컬에 실체가 없는 파일.
   * 내용을 읽으면 자동 다운로드가 걸리므로 해시 계산에서 제외한다.
   */
  isCloudOnly: boolean
}

// ---------------------------------------------------------------- 스캔

export interface ScanProgress {
  /** 지금까지 확인한 파일 수 */
  filesSeen: number
  /** 현재 훑고 있는 디렉터리 */
  currentDir: string
}

export interface CategoryBreakdown {
  category: FileCategory
  count: number
  bytes: number
}

export interface FolderSummary {
  path: string
  fileCount: number
  totalBytes: number
  /** 접근 권한 등으로 건너뛴 항목 수 */
  skippedCount: number
  byCategory: CategoryBreakdown[]
}

export interface ScanResult {
  scannedAt: number
  /** 스캔에 걸린 시간(ms) */
  durationMs: number
  folders: FolderSummary[]
  totalFiles: number
  totalBytes: number
  totalSkipped: number
  byCategory: CategoryBreakdown[]
  opportunities: Opportunities
}

// ---------------------------------------------------------------- 정리 기회

/** 정리 기회 카드 한 칸에 들어가는 요약 수치 */
export interface OpportunityGroup {
  count: number
  bytes: number
  /** 화면에 미리보기로 보여줄 상위 항목 */
  samples: OpportunitySample[]
}

export interface OpportunitySample {
  path: string
  name: string
  size: number
  mtimeMs: number
}

export interface Opportunities {
  /** 크기 + 앞부분 해시가 같은 '후보'. 확정 중복이 아님에 유의 */
  duplicates: OpportunityGroup
  /** 100MB 이상 */
  large: OpportunityGroup
  /** 180일 넘게 손대지 않은 파일 */
  old: OpportunityGroup
  /** %TEMP% + 휴지통. 스캔 폴더와 무관하게 별도 계산 */
  temp: OpportunityGroup

  /**
   * 판단 없이 바로 비울 수 있는 용량 (중복 후보 + 임시파일·휴지통).
   *
   * 대용량과 오래된 파일은 여기 넣지 않는다. 큰 파일이라고 지워도 되는 게 아니고,
   * 오래된 파일도 그냥 안 쓴 것일 뿐이라 사람이 봐야 한다.
   */
  reclaimableBytes: number

  /**
   * 사람이 훑어볼 대상의 용량 (대용량 ∪ 오래된 파일).
   * 두 조건에 모두 걸리는 파일이 흔해서 단순 합이 아니라 합집합으로 센다.
   */
  reviewBytes: number
}

// ---------------------------------------------------------------- 설치된 앱

export interface InstalledApp {
  name: string
  version: string
  publisher: string
  /** 레지스트리의 EstimatedSize 기반. 값이 없으면 0 */
  sizeBytes: number
  /** YYYYMMDD 형태의 원본 문자열. 없으면 빈 문자열 */
  installDate: string
  installLocation: string
}

export interface StartupItem {
  name: string
  command: string
  /** 'registry' = Run 키, 'folder' = 시작프로그램 폴더 */
  source: 'registry' | 'folder'
}

export interface AppsInfo {
  apps: InstalledApp[]
  startup: StartupItem[]
}

// ---------------------------------------------------------------- 설정

export interface Settings {
  /** 스캔 대상으로 등록한 폴더 */
  watchedFolders: string[]
  /** 이 이름의 디렉터리는 건너뛴다 */
  excludedDirNames: string[]
  /** 이 크기 이상이면 '대용량' */
  largeFileBytes: number
  /** 이 일수 넘게 안 쓰면 '오래된 파일' */
  oldFileDays: number
}

// ---------------------------------------------------------------- 2단계 예약

/**
 * 아래 세 타입은 아직 쓰이지 않는다.
 * 2단계(실제 파일 이동)의 '계획 -> 승인 -> 실행 -> 되돌리기' 흐름을 위해
 * 자리만 잡아둔 것으로, 1단계에서는 어떤 코드도 이 값을 만들지 않는다.
 */
export interface PlannedAction {
  kind: 'move' | 'trash'
  from: string
  /** kind === 'move' 일 때만 */
  to?: string
  reason: string
}

export interface ExecutionResult {
  action: PlannedAction
  ok: boolean
  error?: string
}

export interface UndoEntry {
  id: string
  executedAt: number
  results: ExecutionResult[]
}
