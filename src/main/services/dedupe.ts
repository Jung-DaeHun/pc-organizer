import { randomUUID } from 'node:crypto'
import type { FileEntry, TrashGroup, TrashItem, TrashPlan } from '@shared/types'
import { assertIdle } from './activity'
import { lastTouchedMs } from './opportunities'
import { getLastDuplicateGroups, getLastScannedAt } from './scan'

/**
 * 중복 후보 → 휴지통 계획의 조율. 이동 계획(plan.ts)과 같은 구조다.
 *
 * 마지막 계획은 main 에만 남긴다. renderer 는 그룹 id 와 남길 파일 id 만 돌려보내고, 실행은 반드시
 * 이 원본과 대조한 뒤에만 한다. AI 는 관여하지 않는다 — 여기 오는 그룹은 스캔의 규칙(크기 + 앞 4KB)이
 * 만든 것뿐이다.
 *
 * 계획은 파일을 읽지 않는다. 그룹은 스캔이 이미 계산해 두었고(scan.ts `lastDuplicateGroups`), 여기서는
 * 남길 파일을 고르고 모양만 바꾼다.
 */
let lastTrashPlan: TrashPlan | null = null

export function getLastTrashPlan(): TrashPlan | null {
  return lastTrashPlan
}

/**
 * 그룹에서 남길 파일을 고른다.
 *
 * 가장 최근에 손댄 것(`lastTouchedMs` — atime 은 믿을 수 없어 mtime 과 큰 쪽)을 남긴다. 지금도 쓰는
 * 사본이 남아야 한다. 같으면 경로가 짧은 것 — 더 위 폴더에 있는 쪽이 원본에 가깝다. 그래도 같으면
 * 입력 순서상 앞의 것. 사용자가 화면에서 바꿀 수 있는 기본값일 뿐이다.
 */
export function chooseKeeper(items: readonly TrashItem[]): TrashItem {
  if (items.length === 0) throw new Error('빈 그룹에서는 남길 파일을 고를 수 없습니다')
  let keeper = items[0] as TrashItem
  for (const item of items.slice(1)) {
    if (item.lastTouchedMs > keeper.lastTouchedMs) keeper = item
    else if (item.lastTouchedMs === keeper.lastTouchedMs && item.path.length < keeper.path.length) {
      keeper = item
    }
  }
  return keeper
}

function toTrashItem(entry: FileEntry, id: string): TrashItem {
  return {
    id,
    path: entry.path,
    name: entry.name,
    size: entry.size,
    mtimeMs: entry.mtimeMs,
    lastTouchedMs: lastTouchedMs(entry)
  }
}

/** 그룹에서 지울 수 있는 용량 — 하나는 남기므로 (n - 1) × 크기 */
export const reclaimableOf = (group: Pick<TrashGroup, 'size' | 'items'>): number =>
  group.size * (group.items.length - 1)

/**
 * 스캔의 중복 후보 그룹을 계획으로. 순수 함수 — 테스트는 여기를 본다.
 * 둘 미만인 그룹은 버린다(지울 것이 없다). 지울 수 있는 용량이 큰 그룹이 앞이다.
 */
export function toTrashPlan(
  groups: readonly (readonly FileEntry[])[],
  meta: { id: string; now: number; scannedAt: number }
): TrashPlan {
  const built: TrashGroup[] = []
  for (const group of groups) {
    if (group.length < 2) continue
    const groupId = String(built.length)
    const items = group.map((entry, i) => toTrashItem(entry, `${groupId}.${i}`))
    built.push({
      id: groupId,
      size: group[0]?.size ?? 0,
      items,
      keepId: chooseKeeper(items).id,
      included: true
    })
  }
  built.sort((a, b) => reclaimableOf(b) - reclaimableOf(a))

  return { id: meta.id, createdAt: meta.now, scannedAt: meta.scannedAt, groups: built }
}

/**
 * 마지막 스캔의 중복 후보로 계획을 세운다. 파일을 읽지 않는다.
 *
 * @param scannedAt renderer 가 화면에 보여주고 있는 ScanResult.scannedAt.
 *   main 의 그룹과 다르면 사용자가 본 적 없는 목록으로 계획을 세우는 것이므로 거부한다 (buildPlan 과 같다)
 */
export function buildTrashPlan(scannedAt: number): TrashPlan {
  // 스캔 중이면 그룹이 아직 없고, 실행·실행취소 중이면 곧 버려진다
  assertIdle('중복 정리 목록을 만드세요')

  if (getLastScannedAt() === 0) throw new Error('먼저 스캔을 실행하세요')
  if (scannedAt !== getLastScannedAt()) {
    throw new Error('화면의 스캔 결과가 최신이 아닙니다. 다시 스캔하세요')
  }

  const plan = toTrashPlan(getLastDuplicateGroups(), {
    id: randomUUID(),
    now: Date.now(),
    scannedAt
  })
  lastTrashPlan = plan
  return plan
}
