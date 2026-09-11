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
  let samples: OpportunitySample[] = []

  for (const target of targets) {
    // 임시 폴더 안의 node_modules 같은 건 제외하지 않는다. 전부 지워도 되는 곳이다.
    const scan = await scanFolder(target, { excludedDirNames: [] })

    count += scan.entries.length
    bytes += scan.entries.reduce((sum, e) => sum + e.size, 0)

    // `push(...entries)` 는 항목 수만큼을 호출 인자로 펼쳐 15만 개쯤부터 콜 스택이 넘친다.
    // 휴지통에 node_modules 하나만 들어 있어도 그 규모다. 폴더마다 상위 몇 개만 남겨 합친다.
    samples = topBySize([...samples, ...topBySize(scan.entries, SAMPLE_LIMIT)], SAMPLE_LIMIT)
  }

  return { count, bytes, samples }
}

/** 크기 상위 n 개, 큰 순서. 전체를 정렬하지 않고 한 번 훑는다 */
export function topBySize(
  entries: readonly Pick<OpportunitySample, 'path' | 'name' | 'size' | 'mtimeMs'>[],
  n: number
): OpportunitySample[] {
  const top: OpportunitySample[] = []
  for (const e of entries) {
    if (top.length === n && e.size <= (top[n - 1] as OpportunitySample).size) continue
    top.push({ path: e.path, name: e.name, size: e.size, mtimeMs: e.mtimeMs })
    top.sort((a, b) => b.size - a.size)
    if (top.length > n) top.pop()
  }
  return top
}
