import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathKey } from './paths'
import { runPowerShellJson } from './powershell'

/**
 * 볼륨의 윈도우 휴지통 설정과 현재 사용량 — **휴지통으로 보내기 전에 반드시 봐야 하는 값**이다.
 *
 * `shell.trashItem`(Electron 44, Windows)은 `IFileOperation` 을 `FOF_NO_UI` 로 돌린다. 휴지통이 없는
 * 볼륨(네트워크·subst)은 중단되지만, 아래 두 경우는 **오류 없이 영구 삭제**된다 (2026-09-13 실측 2건):
 *
 * 1. **휴지통 최대 크기(MaxCapacity)보다 큰 파일** — "너무 커서 휴지통에 넣을 수 없음, 영구 삭제?" 에
 *    자동으로 '예'. 한도 49685MiB 인 볼륨에서 49685MiB 는 휴지통행, 49685MiB + 1B 는 영구 삭제.
 * 2. **개별로는 한도 미만인데 들어 있는 것과의 합계가 한도를 넘는 경우** — 30GiB 4개(한도 48.5GiB)를
 *    보내면 넷 다 `resolved` 이고 직후에는 넷 다 휴지통에 있다. 그러나 잠시 뒤 탐색기가 **오래된 것부터
 *    한도 아래로 들어갈 때까지 묻지 않고 영구 삭제**한다(가장 나중 것 하나만 남았다). 앱이 "보냈습니다,
 *    복원 가능"이라고 보고한 뒤에 사라지므로, 넣은 직후 확인해도 잡히지 않는다.
 *
 * '휴지통을 쓰지 않음'(NukeOnDelete·NoRecycleFiles 정책)이면 모든 삭제가 영구 삭제다. 그래서 executor 의
 * preflightTrash 가 (1) 파일 하나가 한도 이상, (2) 현재 사용량 + 보낼 합계가 한도 이상, (3) 휴지통 안 씀,
 * (4) 값을 모름 — 넷 중 하나면 막는다.
 *
 * 휴지통은 **볼륨마다** 따로다(`$Recycle.Bin` 도, BitBucket 의 한도 키도). 드라이브 문자 없이 폴더에 마운트된
 * 볼륨(`C:\Data` 에 붙은 별도 디스크)의 파일은 경로만 보면 `C:\` 같지만 휴지통은 `C:\Data\$Recycle.Bin` 이고
 * 한도도 그 볼륨의 것이다 — `C:\` 의 설정으로 판정하면 한도와 사용량이 둘 다 틀린다. 그래서 마운트 폴더
 * 목록(`Win32_MountPoint`)을 같이 읽어 그 아래 경로는 "모른다"로 둔다(mountPointOf). 스캐너가 마운트 포인트
 * (정션과 같은 reparse 태그)를 내려가지 않아 보통 닿지 않지만, 스캔 루트를 그 안으로 잡으면 닿는다.
 *
 * 전부 **조회**뿐이다: 레지스트리·CIM 은 PowerShell 로 읽고, 사용량은 `<root>$Recycle.Bin\<SID>` 를 fs 로
 * 읽는다. 실패하면 null — 호출부는 null 을 "모른다 = 보내지 않는다"로 다룬다.
 */
export interface RecycleBinPolicy {
  /**
   * 휴지통 한도(바이트). 파일 하나가 이 값 **이상**이면 쉘이 영구 삭제하고, 들어 있는 것과 보낼 것의
   * 합계가 이 값 이상이면 탐색기가 나중에 오래된 것부터 영구 삭제한다. 실측으로는 같을 때 휴지통에
   * 들어갔지만, 경계에서 1바이트 보수적으로 잡는다
   */
  maxBytes: number
  /** '파일을 휴지통으로 이동하지 않음' — 이 볼륨의 삭제는 전부 영구 삭제 */
  bypassed: boolean
  /** 현재 사용자의 휴지통에 지금 들어 있는 양(바이트). `$R` 항목의 크기 합 */
  usedBytes: number
  /**
   * 이 루트 아래에 **다른 볼륨**이 마운트된 폴더들(끝 구분자 없음, 예 `C:\Data`). 그 아래 경로의 휴지통은
   * 이 볼륨의 것이 아니므로 위 값들이 맞지 않는다 — 호출부는 mountPointOf 로 걸러 "모른다"로 다룬다
   */
  mountPoints: string[]
}

/** 볼륨 루트(`C:\`)의 휴지통 설정. 모르면 null. executor 는 이 함수를 주입받아 PowerShell·fs 를 모른다 */
export type RecycleBinLookup = (root: string) => Promise<RecycleBinPolicy | null>

/** 레지스트리·CIM 에서 읽은 한도 쪽 (사용량 제외). parseRecycleBinPolicy 의 결과 */
export type RecycleBinLimits = Pick<RecycleBinPolicy, 'maxBytes' | 'bypassed'>

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
  /** 현재 사용자의 SID. 휴지통은 사용자마다 `<root>$Recycle.Bin\<SID>` 로 나뉜다 */
  Sid: string | null
  /**
   * 이 머신의 모든 마운트 폴더(`Win32_MountPoint` 의 Directory, 드라이브 루트 `C:\` 포함). 조회에 실패하면
   * null — 어디에 무엇이 마운트돼 있는지 모르면 어느 경로의 휴지통도 확신할 수 없다. 하나뿐이어도 배열이지만
   * ConvertTo-Json 의 버릇을 믿지 않고 문자열 하나도 받는다
   */
  MountPoints: string[] | string | null
}

const MIB = 1024 * 1024

const asNumber = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/**
 * 조회 결과의 한도 쪽을 해석한다. 순수 함수 — 테스트는 여기를 본다.
 *
 * - 휴지통을 쓰지 않는 설정이 하나라도 있으면 bypassed
 * - 한도는 볼륨 키의 MaxCapacity(MiB). 그룹 정책이 퍼센트로 잡혀 있으면 그것과 **작은 쪽**
 * - 볼륨 키가 없으면(한 번도 휴지통을 쓴 적 없는 볼륨) 한도를 모르므로 null
 */
export function parseRecycleBinPolicy(raw: RawRecycleBinPolicy | null): RecycleBinLimits | null {
  if (!raw || typeof raw !== 'object') return null

  const bypassed =
    asNumber(raw.NukeOnDelete) === 1 ||
    asNumber(raw.NoRecycleFilesUser) === 1 ||
    asNumber(raw.NoRecycleFilesMachine) === 1

  const maxCapacityMib = asNumber(raw.MaxCapacity)
  if (maxCapacityMib === null || maxCapacityMib < 0) return bypassed ? { maxBytes: 0, bypassed } : null
  let maxBytes = maxCapacityMib * MIB

  const capacity = asNumber(raw.Capacity)
  for (const percent of [raw.RecycleBinSizeUser, raw.RecycleBinSizeMachine]) {
    const p = asNumber(percent)
    if (p === null || capacity === null) continue
    maxBytes = Math.min(maxBytes, Math.floor((capacity * Math.max(0, p)) / 100))
  }

  return { maxBytes, bypassed }
}

/** `C:\` → `C`. 드라이브 문자 루트가 아니면(UNC 등) null — 그런 볼륨의 휴지통은 모른다 */
export function driveLetterOf(root: string): string | null {
  const m = /^([A-Za-z]):[\\/]?$/.exec(root)
  return m ? (m[1] as string).toUpperCase() : null
}

/** SID 모양(`S-1-5-21-…`)만 경로에 끼워 넣는다. 조회 결과가 이상하면 사용량을 잴 수 없다 = 모른다 */
const isSid = (v: unknown): v is string => typeof v === 'string' && /^S-1-[0-9-]+$/.test(v)

/** 드라이브 문자 하나만 스크립트에 끼워 넣는다 (driveLetterOf 가 검증한 뒤) */
const psQuery = (letter: string): string => String.raw`
$vol = Get-CimInstance Win32_Volume -Filter "DriveLetter='${letter}:'" | Select-Object -First 1
if (-not $vol) { exit }
$guid = [regex]::Match($vol.DeviceID, '\{[0-9a-fA-F-]+\}').Value
$bucket = $null
if ($guid) { $bucket = Get-ItemProperty -Path ("HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\BitBucket\Volume\" + $guid) -ErrorAction SilentlyContinue }
$polU = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer' -ErrorAction SilentlyContinue
$polM = Get-ItemProperty -Path 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer' -ErrorAction SilentlyContinue
$mp = $null
try { $mp = @(Get-CimInstance Win32_MountPoint -ErrorAction Stop | ForEach-Object { $_.Directory.Name }) } catch { $mp = $null }
[pscustomobject]@{
  Capacity = $vol.Capacity
  MaxCapacity = $bucket.MaxCapacity
  NukeOnDelete = $bucket.NukeOnDelete
  NoRecycleFilesUser = $polU.NoRecycleFiles
  NoRecycleFilesMachine = $polM.NoRecycleFiles
  RecycleBinSizeUser = $polU.RecycleBinSize
  RecycleBinSizeMachine = $polM.RecycleBinSize
  Sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  MountPoints = $mp
} | ConvertTo-Json -Compress
`

// ---------------------------------------------------------------- 마운트 포인트

/** 구분자를 `\` 로 맞추고 끝의 것을 뗀 뒤 비교용으로 접는다 (`C:\Data\`·`c:/data` 가 같은 폴더) */
const folderKeyOf = (path: string): string => pathKey(path.replace(/\//g, '\\').replace(/\\+$/, ''))

/**
 * 마운트 폴더 목록에서 `root`(드라이브 루트) **아래**에 있는 것만 골라 끝 구분자 없이 돌려준다. 순수 함수.
 * 루트 자신(`C:\` 도 Win32_MountPoint 에 나온다)과 다른 드라이브의 것은 뺀다. 문자열이 아닌 항목이 섞여
 * 있으면 null — 목록을 믿을 수 없으면 모른다
 */
export function mountPointsUnder(root: string, all: unknown): string[] | null {
  const list = typeof all === 'string' ? [all] : all
  if (!Array.isArray(list)) return null
  const rootKey = folderKeyOf(root)
  const out: string[] = []
  for (const entry of list) {
    if (typeof entry !== 'string') return null
    const trimmed = entry.replace(/[\\/]+$/, '')
    const key = folderKeyOf(trimmed)
    if (key === rootKey || !isUnder(key, rootKey)) continue
    out.push(trimmed)
  }
  return out
}

/** `key` 가 `folderKey` 안(자신 제외)에 있는가. 둘 다 folderKeyOf 로 접힌 값 */
const isUnder = (key: string, folderKey: string): boolean => key.startsWith(`${folderKey}\\`)

/**
 * `path` 가 마운트 폴더 중 하나(또는 그 안)에 있으면 그 폴더, 아니면 null. 순수 함수 — executor 가 파일마다
 * 부른다. 여러 개가 겹치면(`C:\Data` 와 `C:\Data\Deep`) 어느 것이든 "이 볼륨이 아니다"라는 답은 같다
 */
export function mountPointOf(path: string, mountPoints: readonly string[]): string | null {
  const key = folderKeyOf(path)
  for (const mount of mountPoints) {
    const mountKey = folderKeyOf(mount)
    if (key === mountKey || isUnder(key, mountKey)) return mount
  }
  return null
}

// ---------------------------------------------------------------- 사용량

/** readdir 결과 중 사용량 계산이 보는 것. node:fs 의 Dirent 가 그대로 맞는다 */
export interface RecycleBinDirent {
  name: string
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

/** lstat 결과 중 사용량 계산이 보는 것. node:fs 의 Stats 가 그대로 맞는다 */
export interface RecycleBinStat {
  size: number
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

/** 사용량 계산이 쓰는 파일시스템. 읽기뿐이다. 테스트는 가짜를 넣는다 */
export interface RecycleBinFsIo {
  readdir(path: string): Promise<RecycleBinDirent[]>
  /** 링크를 따라가지 않아야 한다 (stat 이 아니라 lstat) */
  lstat(path: string): Promise<RecycleBinStat>
}

export const NODE_RECYCLE_BIN_FS: RecycleBinFsIo = {
  readdir: (path) => readdir(path, { withFileTypes: true }),
  lstat
}

const isEnoent = (err: unknown): boolean => (err as NodeJS.ErrnoException | null)?.code === 'ENOENT'

/**
 * 현재 사용자의 휴지통(`<root>$Recycle.Bin\<SID>`)에 들어 있는 양(바이트). 읽기만 한다.
 *
 * 탐색기가 한도와 비교하는 것은 원래 크기(`$I` 메타의 값)지만, 영구 삭제된 항목의 `$I` 가 고아로 남는 일이
 * 흔해(실측: `$I` 10개에 `$R` 2개) 그걸 세면 늘 과대계산된다. 그래서 실제로 남아 있는 **`$R` 항목**의 크기를
 * 더한다 — 파일은 `lstat` 크기(sparse 도 논리 크기, 탐색기 표시와 같다), 폴더째 지운 것(`$R` 디렉터리)은
 * 안을 내려가며 더한다. 링크·정션은 따라가지 않고 0 으로 센다(스캐너와 같은 규칙, 명시적 스택).
 *
 * 폴더가 아직 없으면(이 볼륨에서 휴지통을 쓴 적이 없음) 0. 그 밖의 읽기 실패는 null — 잴 수 없으면 모른다.
 */
export async function measureRecycleBinUsage(binDir: string, io: RecycleBinFsIo): Promise<number | null> {
  let top: RecycleBinDirent[]
  try {
    top = await io.readdir(binDir)
  } catch (err) {
    return isEnoent(err) ? 0 : null
  }

  let total = 0
  // [디렉터리 경로, 그 안의 항목들]. 맨 위는 $R 로 시작하는 것만 — $I 메타와 desktop.ini 는 세지 않는다
  const stack: Array<{ dir: string; entries: RecycleBinDirent[] }> = [
    { dir: binDir, entries: top.filter((d) => d.name.startsWith('$R')) }
  ]

  try {
    while (stack.length > 0) {
      const { dir, entries } = stack.pop()!
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue
        const path = join(dir, entry.name)
        if (entry.isDirectory()) {
          stack.push({ dir: path, entries: await io.readdir(path) })
          continue
        }
        const st = await io.lstat(path)
        if (st.isFile()) total += st.size
      }
    }
  } catch {
    return null
  }
  return total
}

/** 실제 조회를 조립한다. 한도는 PowerShell(조회만), 사용량은 fs(읽기만). 어느 쪽이든 모르면 null */
export function createRecycleBinLookup(
  fs: RecycleBinFsIo = NODE_RECYCLE_BIN_FS,
  query: (script: string) => Promise<RawRecycleBinPolicy | null> = (script) =>
    runPowerShellJson<RawRecycleBinPolicy>(script)
): RecycleBinLookup {
  return async (root) => {
    const letter = driveLetterOf(root)
    if (!letter) return null
    const raw = await query(psQuery(letter))
    if (raw === null) return null
    const limits = parseRecycleBinPolicy(raw)
    if (limits === null) return null
    // 마운트 목록을 못 읽었으면 이 루트 아래 어느 경로가 다른 볼륨인지 모른다 = 전부 모른다
    const mountPoints = mountPointsUnder(root, raw.MountPoints)
    if (mountPoints === null) return null
    // 휴지통을 안 쓰는 볼륨은 사용량과 무관하게 막히므로 재지 않는다
    if (limits.bypassed) return { ...limits, usedBytes: 0, mountPoints }
    if (!isSid(raw.Sid)) return null
    const usedBytes = await measureRecycleBinUsage(join(root, '$Recycle.Bin', raw.Sid), fs)
    if (usedBytes === null) return null
    return { ...limits, usedBytes, mountPoints }
  }
}

/** 실제 조회. handlers.ts 가 주입한다 */
export const lookupRecycleBinPolicy: RecycleBinLookup = createRecycleBinLookup()
