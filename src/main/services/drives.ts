import { access, statfs } from 'node:fs/promises'
import { sep } from 'node:path'
import type { DriveInfo } from '@shared/types'
import { runPowerShellJson, toArray } from '../lib/powershell'

interface RawLogicalDisk {
  DeviceID: string
  VolumeName: string | null
  Size: number | null
  FreeSpace: number | null
}

// DriveType=3 은 '로컬 고정 디스크'. USB/네트워크/광학 드라이브는 정리 대상이 아니라 제외한다.
const PS_LIST_DISKS = `Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID, VolumeName, Size, FreeSpace | ConvertTo-Json -Compress`

/**
 * 로컬 드라이브 목록과 용량.
 *
 * Node에는 드라이브를 열거하는 API가 없어서 PowerShell CIM을 한 번 부른다.
 * 볼륨 라벨까지 같이 얻을 수 있어 호출 한 번으로 끝난다.
 * 어떤 이유로든 실패하면 fs.statfs 로 드라이브 문자를 훑는 방식으로 물러선다.
 */
export async function listDrives(): Promise<DriveInfo[]> {
  const raw = await runPowerShellJson<RawLogicalDisk | RawLogicalDisk[]>(PS_LIST_DISKS)
  const disks = toArray(raw)

  if (disks.length > 0) {
    const drives = disks
      .filter((d) => Boolean(d.DeviceID))
      .map<DriveInfo>((d) => ({
        letter: d.DeviceID,
        label: d.VolumeName ?? '',
        totalBytes: Number(d.Size ?? 0),
        freeBytes: Number(d.FreeSpace ?? 0)
      }))
      .filter((d) => d.totalBytes > 0)

    if (drives.length > 0) return sortByLetter(drives)
  }

  return sortByLetter(await listDrivesViaStatfs())
}

/** PowerShell을 못 쓰는 상황(정책 차단 등)을 위한 대비책 */
async function listDrivesViaStatfs(): Promise<DriveInfo[]> {
  const letters = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))

  const probed = await Promise.all(
    letters.map(async (letter): Promise<DriveInfo | null> => {
      const root = `${letter}:${sep}`
      try {
        await access(root)
        const stats = await statfs(root)
        const blockSize = Number(stats.bsize)
        const totalBytes = Number(stats.blocks) * blockSize
        const freeBytes = Number(stats.bavail) * blockSize

        if (totalBytes <= 0) return null
        return { letter: `${letter}:`, label: '', totalBytes, freeBytes }
      } catch {
        // 없는 드라이브 문자이거나 접근 불가. 조용히 건너뛴다.
        return null
      }
    })
  )

  return probed.filter((d): d is DriveInfo => d !== null)
}

function sortByLetter(drives: DriveInfo[]): DriveInfo[] {
  return [...drives].sort((a, b) => a.letter.localeCompare(b.letter))
}
