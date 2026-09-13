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

// ---------------------------------------------------------------- 정리 계획 (2단계)

export type ItemKind = 'file' | 'dir'

/**
 * 감시 폴더 바로 아래에 있는 항목 하나.
 *
 * 정리는 이 단위로만 한다. 폴더는 안을 들여다보지 않고 통째로 하나의 항목이며,
 * 이미 하위 폴더 안에 있는 파일은 정리된 것으로 보고 건드리지 않는다.
 */
export interface OrganizeItem {
  /** 계획 안에서 항목을 가리키는 짧은 식별자. renderer와 AI 응답이 이 값으로 항목을 지칭한다 */
  id: string
  path: string
  name: string
  kind: ItemKind
  /** 소문자, 점 포함. 폴더면 빈 문자열 */
  ext: string
  /** 폴더면 아래 파일들의 합 */
  size: number
  mtimeMs: number
  /** 폴더는 항상 'other' */
  category: FileCategory
  /** 폴더일 때 아래 파일 수 */
  fileCount?: number
}

/** 정리 대상에서 뺀 이유. 화면 문구는 SKIP_REASON_LABELS 에서 고른다 */
export type SkipReason =
  | 'link'
  | 'not-file-or-dir'
  | 'system'
  | 'not-in-scan'
  | 'cloud-only'
  | 'has-cloud-only'
  | 'excluded-dir'
  | 'destination'

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  link: '링크·정션은 따라가지 않는다',
  'not-file-or-dir': '파일도 폴더도 아님',
  system: '시스템 파일',
  'not-in-scan': '스캔 결과에 없음 (다시 스캔 필요)',
  'cloud-only': '클라우드 전용 파일 (내려받기 전에는 옮기지 않는다)',
  'has-cloud-only': '클라우드 전용 파일이 들어 있는 폴더',
  'excluded-dir': '스캔에서 제외한 폴더 (용량을 알 수 없다)',
  destination: '정리 폴더(목적지)라 옮기지 않는다'
}

/** 정리 대상에서 뺀 항목과 그 이유. 화면에 그대로 보여준다 */
export interface SkippedItem {
  path: string
  name: string
  reason: SkipReason
  /** SKIP_REASON_LABELS[reason]. renderer 가 표를 찾지 않아도 되게 같이 보낸다 */
  why: string
}

/** 누가 이 폴더/배정을 제안했는지 */
export type PlanOrigin = 'rule' | 'ai' | 'user'

/**
 * 계획이 제안하는 목적지 폴더. 감시 폴더 바로 아래에 만들어진다.
 *
 * 경로는 없다 — 계획은 목적지를 **폴더 이름**으로만 말한다. 실제 경로는 실행 단계에서 main 이
 * `join(root, name, item.name)` 으로 만든다. renderer 는 경로를 한 번도 조립하지 않는다.
 */
export interface ProposedFolder {
  name: string
  description: string
  /** 이미 감시 폴더 안에 있는 폴더인지 (이름을 바꿀 수 없다) */
  existing: boolean
  origin: PlanOrigin
}

export interface PlanItem {
  item: OrganizeItem
  /**
   * 옮겨 넣을 폴더 이름 (계획의 root 바로 아래). null 이면 그대로 둔다.
   * 파일 이름은 바뀌지 않는다 — 실제 목적지는 join(root, toFolder, item.name).
   */
  toFolder: string | null
  reason: string
  origin: PlanOrigin
}

export interface OrganizePlan {
  id: string
  createdAt: number
  /** 감시 폴더. 모든 목적지(toFolder)는 이 바로 아래다 */
  root: string
  folders: ProposedFolder[]
  items: PlanItem[]
  skipped: SkippedItem[]
}

// ---------------------------------------------------------------- AI 추천

/**
 * AI에게 보내는 항목 하나. **여기 적힌 필드 외에는 아무것도 네트워크로 나가지 않는다.**
 * 절대 경로·사용자 이름·파일 내용은 없다. tests/advisor.test.ts 가 이를 못 박는다.
 */
export interface AdvisorItem {
  id: string
  name: string
  kind: ItemKind
  ext: string
  size: number
  /** YYYY-MM-DD. 시각까지는 보내지 않는다 */
  mtime: string
  category: FileCategory
  fileCount?: number
}

export interface AdvisorRequest {
  /** 감시 폴더의 마지막 이름만 ('Downloads'). 전체 경로는 보내지 않는다 */
  rootName: string
  /** 이미 있는 하위 폴더 이름. AI가 새 폴더 대신 골라 쓸 수 있다 */
  existingFolders: string[]
  items: AdvisorItem[]
}

/** 보내기 전에 사용자에게 보여주는 요약 */
export interface AdvisorPreview {
  itemCount: number
  chunkCount: number
  sampleNames: string[]
  approxInputTokens: number
}

// ---------------------------------------------------------------- 실행 · 실행취소 (B 단계)

/**
 * renderer 가 돌려보내는 결정 하나. main 은 이 값을 lastPlan 과 대조한 뒤에만 움직인다.
 * 그대로 두는 항목은 요청에 넣지 않는다 — 요청에 있는 것만 옮긴다.
 */
export interface ExecuteRequest {
  id: string
  /** 폴더 이름 (경로 아님). 실제 목적지는 main 이 join(root, toFolder, item.name) 으로 만든다 */
  toFolder: string
}

/** 이동 하나가 실패한 이유. 화면 문구는 EXEC_ERROR_LABELS 에서 고른다 */
export type ExecErrorCode =
  | 'missing'
  | 'link'
  | 'kind-changed'
  | 'dest-not-dir'
  | 'exists'
  | 'exdev'
  | 'io'

export const EXEC_ERROR_LABELS: Record<ExecErrorCode, string> = {
  missing: '원본이 없습니다 (스캔 뒤에 지워졌거나 옮겨졌습니다)',
  link: '원본이 링크·정션입니다',
  'kind-changed': '파일이 폴더로(또는 폴더가 파일로) 바뀌었습니다',
  'dest-not-dir': '목적지 폴더 자리에 파일이나 링크가 있습니다',
  exists: '목적지에 같은 이름이 이미 있습니다 (덮어쓰지 않습니다)',
  exdev: '다른 드라이브로는 옮기지 않습니다 (복사하지 않습니다)',
  io: '파일시스템 오류'
}

/** 이동(또는 되돌리기) 하나의 결과. from → to 는 실제로 시도한 방향이다 */
export interface ExecutionResult {
  id: string
  name: string
  kind: ItemKind
  from: string
  to: string
  ok: boolean
  code?: ExecErrorCode
  /** EXEC_ERROR_LABELS[code] 에 원인을 덧붙인 문장. 화면에 그대로 보여준다 */
  error?: string
}

/** 실행 한 번의 기록. userData/journal.json 에 남고 실행취소가 이걸 읽는다 */
export interface UndoEntry {
  id: string
  executedAt: number
  /** 감시 폴더. 모든 from 은 이 바로 아래, 모든 to 는 이 아래 폴더 안이다 */
  root: string
  results: ExecutionResult[]
  /** 실행하면서 새로 만든 폴더 이름. 실행취소가 이 중 비어 있는 것만 치운다 */
  createdFolders: string[]
  /** 실행취소를 한 시각. 있으면 다시 되돌릴 수 없다 */
  undoneAt?: number
  /** 되돌린 결과 (to → from). 일부가 실패했으면 어느 것이 제자리로 못 갔는지 여기 남는다 */
  undoResults?: ExecutionResult[]
  /** 실행취소가 지운 폴더 (createdFolders 중 비어 있던 것) */
  removedFolders?: string[]
  /**
   * 실행취소가 남긴 폴더 — 비어 있지 않거나 폴더가 아니게 된 것. createdFolders 에서 removedFolders 를
   * 뺀 값이 아니다: 사용자가 이미 지운 폴더는 어느 쪽에도 없다
   */
  keptFolders?: string[]
}

export interface ExecuteProgress {
  done: number
  total: number
  /** 지금 옮기는 항목 이름. 끝나면 빈 문자열 */
  current: string
}

/**
 * 실행 결과. 'blocked' 는 사전 점검(읽기 전용)에서 하나라도 걸려 **아무것도 옮기지 않은** 것이다 —
 * 사용자가 걸린 카드를 그대로 두기로 옮기고 다시 실행한다.
 */
export type ExecuteOutcome =
  | { status: 'blocked'; problems: ExecutionResult[] }
  | {
      status: 'done'
      entry: UndoEntry
      /**
       * 옮긴 뒤 마지막 기록 저장이 실패했을 때 그 이유. entry 는 정확하지만 저널(userData)은 뒤처져
       * 실행취소가 마지막 항목을 놓칠 수 있다 — 화면이 이걸 보여준다
       */
      journalError?: string
    }

export interface UndoOutcome {
  entry: UndoEntry
  /** ok 였던 이동을 역순으로 되돌린 결과 (to → from) */
  results: ExecutionResult[]
  /** 실행이 만든 폴더 중 비어 있어 지운 것 */
  removedFolders: string[]
  /** 실행이 만든 폴더 중 남긴 것 (비어 있지 않음) */
  keptFolders: string[]
}

// ---------------------------------------------------------------- 중복 후보 → 휴지통 (B3)

/**
 * 휴지통 후보 하나. `PlanItem` 과 **다른 타입**이다 — 휴지통으로 가는 항목은 규칙(중복 후보)에서만
 * 나오고 AI 경로(`OrganizePlan`)와는 타입 수준에서 분리한다.
 *
 * 경로는 renderer 에 보낸다 — 어느 사본을 남길지 고르려면 어디에 있는지 봐야 한다. 이 값은 화면에만 가고
 * 네트워크로는 나가지 않는다(AI 페이로드는 `AdvisorItem` 뿐).
 */
export interface TrashItem {
  /** 계획 안에서 항목을 가리키는 식별자. renderer 는 이 값으로만 항목을 지칭한다 */
  id: string
  path: string
  name: string
  size: number
  mtimeMs: number
  /** max(atimeMs, mtimeMs). 남길 파일 기본값을 고르는 기준 (윈도우의 atime 은 믿을 수 없다) */
  lastTouchedMs: number
}

/** 크기와 앞 4KB 가 같은 파일 묶음. 하나는 반드시 남긴다 */
export interface TrashGroup {
  id: string
  /** 그룹 안 파일의 크기. 전부 같다 */
  size: number
  /** 둘 이상 */
  items: TrashItem[]
  /** 남길 파일의 id. 항상 items 중 하나. 기본값은 가장 최근 손댄 것, 같으면 경로가 짧은 것 */
  keepId: string
  /** 이번 정리에 포함할지. 화면에서 끌 수 있다 */
  included: boolean
}

/**
 * 중복 후보 정리 계획. 스캔이 이미 계산한 그룹에서 출발하며 만드는 데 파일을 읽지 않는다.
 * 앞 4KB 만 비교한 후보라, 휴지통으로 보내기 직전에 전체 해시로 다시 확인한다.
 */
export interface TrashPlan {
  id: string
  createdAt: number
  /** 이 계획이 출발한 스캔. ScanResult.scannedAt 과 같다 — 파일이 움직이면(markStale) 어긋나 못 쓴다 */
  scannedAt: number
  /** 지울 수 있는 용량이 큰 그룹이 앞 */
  groups: TrashGroup[]
}
