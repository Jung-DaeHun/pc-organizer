import { runPowerShellJson } from './powershell'

/**
 * 볼륨의 윈도우 휴지통 설정 — **휴지통으로 보내기 전에 반드시 봐야 하는 값**이다.
 *
 * `shell.trashItem`(Electron 44, Windows)은 `IFileOperation` 을 `FOF_NO_UI` 로 돌린다. 휴지통이 없는
 * 볼륨(네트워크·subst)은 중단되지만, **휴지통 최대 크기(MaxCapacity)보다 큰 파일은 "너무 커서 휴지통에
 * 넣을 수 없음, 영구 삭제?" 에 자동으로 '예'가 되어 오류 없이 영구 삭제된다** (2026-09-13 실측: 한도
 * 49685MiB 인 볼륨에서 49685MiB 는 휴지통행, 49685MiB + 1B 는 영구 삭제). '휴지통을 쓰지 않음'
 * (NukeOnDelete·NoRecycleFiles 정책)이면 모든 삭제가 영구 삭제다. 그래서 이 값을 읽지 못하거나 한도를 넘는
 * 파일은 executor.preflightTrash 가 막는다.
 *
 * 전부 레지스트리·CIM **조회**뿐이다. 실패하면 null — 호출부는 null 을 "모른다 = 보내지 않는다"로 다룬다.
 */
export interface RecycleBinPolicy {
  /**
   * 휴지통이 받아주는 파일 하나의 최대 크기(바이트). 이 값 **이상**이면 보내지 않는다 — 실측으로는 같을 때
   * 휴지통에 들어갔지만, 경계에서 1바이트 보수적으로 잡는다
   */
  maxFileBytes: number
  /** '파일을 휴지통으로 이동하지 않음' — 이 볼륨의 삭제는 전부 영구 삭제 */
  bypassed: boolean
}

/** 볼륨 루트(`C:\`)의 휴지통 설정. 모르면 null. executor 는 이 함수를 주입받아 네트워크·레지스트리를 모른다 */
export type RecycleBinLookup = (root: string) => Promise<RecycleBinPolicy | null>

/** PowerShell 이 돌려주는 모양. 없는 값은 null (키가 없거나 정책이 없다) */
export interface RawRecycleBinPolicy {
  /** 볼륨 크기(바이트). 정책이 퍼센트로 잡혀 있을 때 한도를 계산한다 */
  Capacity: number | null
  /** HKCU\...\Explorer\BitBucket\Volume\{guid}\MaxCapacity — MiB */
  MaxCapacity: number | null
  /** 같은 키의 NukeOnDelete — 1 이면 휴지통을 거치지 않는다 */
  NukeOnDelete: number | null
  /** 그룹 정책 '삭제한 파일을 휴지통으로 이동하지 않음' (사용자·컴퓨터) */
  NoRecycleFilesUser: number | null
  NoRecycleFilesMachine: number | null
  /** 그룹 정책 '휴지통 최대 크기' — 볼륨의 퍼센트 (사용자·컴퓨터) */
  RecycleBinSizeUser: number | null
  RecycleBinSizeMachine: number | null
}

const MIB = 1024 * 1024

const asNumber = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/**
 * 조회 결과를 해석한다. 순수 함수 — 테스트는 여기를 본다.
 *
 * - 휴지통을 쓰지 않는 설정이 하나라도 있으면 bypassed
 * - 한도는 볼륨 키의 MaxCapacity(MiB). 그룹 정책이 퍼센트로 잡혀 있으면 그것과 **작은 쪽**
 * - 볼륨 키가 없으면(한 번도 휴지통을 쓴 적 없는 볼륨) 한도를 모르므로 null
 */
export function parseRecycleBinPolicy(raw: RawRecycleBinPolicy | null): RecycleBinPolicy | null {
  if (!raw || typeof raw !== 'object') return null

  const bypassed =
    asNumber(raw.NukeOnDelete) === 1 ||
    asNumber(raw.NoRecycleFilesUser) === 1 ||
    asNumber(raw.NoRecycleFilesMachine) === 1

  const maxCapacityMib = asNumber(raw.MaxCapacity)
  if (maxCapacityMib === null || maxCapacityMib < 0) return bypassed ? { maxFileBytes: 0, bypassed } : null
  let maxFileBytes = maxCapacityMib * MIB

  const capacity = asNumber(raw.Capacity)
  for (const percent of [raw.RecycleBinSizeUser, raw.RecycleBinSizeMachine]) {
    const p = asNumber(percent)
    if (p === null || capacity === null) continue
    maxFileBytes = Math.min(maxFileBytes, Math.floor((capacity * Math.max(0, p)) / 100))
  }

  return { maxFileBytes, bypassed }
}

/** `C:\` → `C`. 드라이브 문자 루트가 아니면(UNC 등) null — 그런 볼륨의 휴지통은 모른다 */
export function driveLetterOf(root: string): string | null {
  const m = /^([A-Za-z]):[\\/]?$/.exec(root)
  return m ? (m[1] as string).toUpperCase() : null
}

/** 드라이브 문자 하나만 스크립트에 끼워 넣는다 (driveLetterOf 가 검증한 뒤) */
const psQuery = (letter: string): string => String.raw`
$vol = Get-CimInstance Win32_Volume -Filter "DriveLetter='${letter}:'" | Select-Object -First 1
if (-not $vol) { exit }
$guid = [regex]::Match($vol.DeviceID, '\{[0-9a-fA-F-]+\}').Value
$bucket = $null
if ($guid) { $bucket = Get-ItemProperty -Path ("HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\BitBucket\Volume\" + $guid) -ErrorAction SilentlyContinue }
$polU = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer' -ErrorAction SilentlyContinue
$polM = Get-ItemProperty -Path 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer' -ErrorAction SilentlyContinue
[pscustomobject]@{
  Capacity = $vol.Capacity
  MaxCapacity = $bucket.MaxCapacity
  NukeOnDelete = $bucket.NukeOnDelete
  NoRecycleFilesUser = $polU.NoRecycleFiles
  NoRecycleFilesMachine = $polM.NoRecycleFiles
  RecycleBinSizeUser = $polU.RecycleBinSize
  RecycleBinSizeMachine = $polM.RecycleBinSize
} | ConvertTo-Json -Compress
`

/** 실제 조회. 레지스트리는 읽기만 한다 (Get-ItemProperty · Get-CimInstance) */
export const lookupRecycleBinPolicy: RecycleBinLookup = async (root) => {
  const letter = driveLetterOf(root)
  if (!letter) return null
  return parseRecycleBinPolicy(await runPowerShellJson<RawRecycleBinPolicy>(psQuery(letter)))
}
