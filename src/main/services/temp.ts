import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import type { OpportunityGroup, OpportunitySample } from '@shared/types'
import { scanFolder } from './scanner'
import { listDrives } from './drives'

const SAMPLE_LIMIT = 5
const RECYCLE_BIN_DIR = '$Recycle.Bin'

/**
 * 임시 폴더와 휴지통이 차지하는 용량.
 *
 * 여기서는 재보기만 한다. 실제 삭제는 2단계에서 붙인다.
 * 두 곳 모두 다른 사용자 소유 항목이 섞여 있어 접근 거부가 흔한데,
 * 스캐너가 그런 항목을 세면서 넘어가므로 여기서 따로 처리하지 않는다.
 */
export async function measureTempAndTrash(): Promise<OpportunityGroup> {
  const drives = await listDrives()
  // 'C:' 만 넘기면 드라이브 기준 상대 경로가 되어버리므로 구분자까지 붙여 루트로 만든다
  const targets = [tmpdir(), ...drives.map((d) => join(`${d.letter}${sep}`, RECYCLE_BIN_DIR))]

  let count = 0
  let bytes = 0
  const samples: OpportunitySample[] = []

  for (const target of targets) {
    // 임시 폴더 안의 node_modules 같은 건 제외하지 않는다. 전부 지워도 되는 곳이다.
    const scan = await scanFolder(target, { excludedDirNames: [] })

    count += scan.entries.length
    bytes += scan.entries.reduce((sum, e) => sum + e.size, 0)

    samples.push(
      ...scan.entries.map((e) => ({
        path: e.path,
        name: e.name,
        size: e.size,
        mtimeMs: e.mtimeMs
      }))
    )
  }

  return {
    count,
    bytes,
    samples: samples.sort((a, b) => b.size - a.size).slice(0, SAMPLE_LIMIT)
  }
}
