import type { AppsInfo, InstalledApp, StartupItem } from '@shared/types'
import { runPowerShellJson, toArray } from '../lib/powershell'

/**
 * 윈도우 설정의 '앱 > 설치된 앱' 페이지. 제거 안내는 여기를 열어 주는 것까지다.
 *
 * 이 앱은 프로그램을 제거하지 않는다 — 레지스트리의 UninstallString 을 실행하면 임의 프로그램을 돌리는
 * 것이고, 그 프로그램이 무엇을 지울지는 앱이 알 수 없다. 여는 URI 는 여기 고정돼 있고 renderer 에서 오는
 * 인자는 없다(handlers.ts 가 shell.openExternal 에 이 값만 넘긴다).
 */
export const WINDOWS_APPS_SETTINGS_URI = 'ms-settings:appsfeatures'

interface RawInstalledApp {
  DisplayName: string | null
  DisplayVersion: string | null
  Publisher: string | null
  /** 레지스트리에는 KB 단위로 들어있다 */
  EstimatedSize: number | null
  InstallDate: string | null
  InstallLocation: string | null
}

interface RawStartupItem {
  Name: string | null
  Command: string | null
  Source: string | null
}

/**
 * 설치된 프로그램 목록.
 *
 * '프로그램 추가/제거'가 읽는 것과 같은 레지스트리 키 세 곳을 훑는다.
 * 32비트 앱은 WOW6432Node 아래에, 사용자 전용 설치는 HKCU 아래에 따로 들어간다.
 * 조회만 하며 어떤 값도 쓰지 않는다.
 */
const PS_INSTALLED_APPS = String.raw`
$paths = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
Get-ItemProperty -Path $paths -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -and -not $_.SystemComponent -and -not $_.ParentKeyName } |
  Select-Object DisplayName, DisplayVersion, Publisher, EstimatedSize, InstallDate, InstallLocation |
  ConvertTo-Json -Compress
`

/**
 * 부팅할 때 자동 실행되는 항목.
 *
 * Run 레지스트리 키와 시작프로그램 폴더 두 갈래를 본다.
 * 작업 스케줄러로 등록된 것은 여기 잡히지 않는데, 그쪽은 시스템 작업이 대부분이라 일부러 뺐다.
 */
const PS_STARTUP_ITEMS = String.raw`
$items = New-Object System.Collections.ArrayList

$runKeys = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run',
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run'
)
foreach ($key in $runKeys) {
  if (Test-Path $key) {
    $props = Get-ItemProperty -Path $key
    foreach ($prop in $props.PSObject.Properties) {
      if ($prop.Name -notlike 'PS*') {
        [void]$items.Add([pscustomobject]@{
          Name = $prop.Name
          Command = [string]$prop.Value
          Source = 'registry'
        })
      }
    }
  }
}

$startupFolders = @(
  [Environment]::GetFolderPath('Startup'),
  [Environment]::GetFolderPath('CommonStartup')
)
foreach ($folder in $startupFolders) {
  if ($folder -and (Test-Path $folder)) {
    Get-ChildItem -Path $folder -File -ErrorAction SilentlyContinue | ForEach-Object {
      [void]$items.Add([pscustomobject]@{
        Name = $_.BaseName
        Command = $_.FullName
        Source = 'folder'
      })
    }
  }
}

$items | ConvertTo-Json -Compress
`

export async function listApps(): Promise<AppsInfo> {
  // 두 조회는 서로 무관하므로 동시에 돌린다
  const [rawApps, rawStartup] = await Promise.all([
    runPowerShellJson<RawInstalledApp | RawInstalledApp[]>(PS_INSTALLED_APPS),
    runPowerShellJson<RawStartupItem | RawStartupItem[]>(PS_STARTUP_ITEMS)
  ])

  return {
    apps: normalizeApps(toArray(rawApps)),
    startup: normalizeStartup(toArray(rawStartup))
  }
}

function normalizeApps(raw: RawInstalledApp[]): InstalledApp[] {
  const seen = new Set<string>()

  return raw
    .filter((app): app is RawInstalledApp & { DisplayName: string } => Boolean(app.DisplayName))
    .map<InstalledApp>((app) => ({
      name: app.DisplayName.trim(),
      version: app.DisplayVersion?.trim() ?? '',
      publisher: app.Publisher?.trim() ?? '',
      // EstimatedSize는 KB 단위다
      sizeBytes: Math.max(0, Number(app.EstimatedSize ?? 0)) * 1024,
      installDate: app.InstallDate?.trim() ?? '',
      installLocation: app.InstallLocation?.trim() ?? ''
    }))
    .filter((app) => {
      // 같은 앱이 32/64비트 키에 중복으로 잡히는 경우가 있다
      const key = `${app.name}@${app.version}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => b.sizeBytes - a.sizeBytes || a.name.localeCompare(b.name, 'ko'))
}

function normalizeStartup(raw: RawStartupItem[]): StartupItem[] {
  return raw
    .filter((item): item is RawStartupItem & { Name: string } => Boolean(item.Name))
    .map<StartupItem>((item) => ({
      name: item.Name.trim(),
      command: item.Command?.trim() ?? '',
      source: item.Source === 'folder' ? 'folder' : 'registry'
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
}
