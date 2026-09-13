import type { TrashGroup, TrashPlan, TrashRequest } from '@shared/types'

/**
 * 휴지통 계획 화면의 편집 규칙. 순수 함수 — 부수효과가 없어 그대로 단위 테스트한다(tests/trashEdit.test.ts).
 *
 * 화면이 바꿀 수 있는 건 둘뿐이다: 그룹마다 **남길 파일 하나**(keepId)와 **이번에 포함할지**(included).
 * 항목을 더하거나 빼거나 경로를 만드는 일은 없다. 실행 요청(B3 3번 커밋)은 그룹 id 와 남길 파일 id 만
 * 보내고, main 이 자기 계획과 대조해 나머지를 휴지통 대상으로 삼는다 — "그룹을 통째로 지우는 요청"은
 * 모양 자체가 없다.
 */

function updateGroup(
  plan: TrashPlan,
  groupId: string,
  update: (group: TrashGroup) => TrashGroup
): TrashPlan {
  let changed = false
  const groups = plan.groups.map((g) => {
    if (g.id !== groupId) return g
    const next = update(g)
    if (next !== g) changed = true
    return next
  })
  return changed ? { ...plan, groups } : plan
}

/** 그룹에서 남길 파일을 바꾼다. 그룹에 없는 id 면 아무것도 하지 않는다 */
export function setKeeper(plan: TrashPlan, groupId: string, itemId: string): TrashPlan {
  return updateGroup(plan, groupId, (g) => {
    if (g.keepId === itemId || !g.items.some((it) => it.id === itemId)) return g
    return { ...g, keepId: itemId }
  })
}

/** 그룹을 이번 정리에 넣거나 뺀다 */
export function setIncluded(plan: TrashPlan, groupId: string, included: boolean): TrashPlan {
  return updateGroup(plan, groupId, (g) => (g.included === included ? g : { ...g, included }))
}

/** 전부 넣거나 전부 뺀다 */
export function setAllIncluded(plan: TrashPlan, included: boolean): TrashPlan {
  if (plan.groups.every((g) => g.included === included)) return plan
  return { ...plan, groups: plan.groups.map((g) => (g.included === included ? g : { ...g, included })) }
}

export interface TrashSummary {
  /** 전체 그룹 수 */
  groups: number
  /** 이번에 포함한 그룹 수 */
  includedGroups: number
  /** 포함한 그룹에서 휴지통으로 갈 파일 수 (남길 것 제외) */
  files: number
  /** 그 용량 */
  bytes: number
  /** 포함 여부와 무관한 전체 '지울 수 있는 양' — 헤더의 안내 수치 */
  reclaimableBytes: number
}

/** 헤더·하단 바에 보여줄 수치 */
export function summarize(plan: TrashPlan): TrashSummary {
  let includedGroups = 0
  let files = 0
  let bytes = 0
  let reclaimableBytes = 0
  for (const g of plan.groups) {
    const extras = g.items.length - 1
    reclaimableBytes += g.size * extras
    if (!g.included) continue
    includedGroups += 1
    files += extras
    bytes += g.size * extras
  }
  return { groups: plan.groups.length, includedGroups, files, bytes, reclaimableBytes }
}

/** 그룹에서 휴지통으로 갈 항목 — 남길 것을 뺀 나머지 */
export function trashItemsOf(group: TrashGroup): TrashGroup['items'] {
  return group.items.filter((it) => it.id !== group.keepId)
}

/**
 * main 에 보낼 요청. 포함한 그룹마다 **남길 파일 id** 하나 — 경로는 없고, 보낼 파일 목록도 없다.
 * main 이 자기 계획에서 나머지를 찾는다. 뺀 그룹은 요청에 들어가지 않는다.
 */
export function toTrashRequests(plan: TrashPlan): TrashRequest[] {
  return plan.groups
    .filter((g) => g.included && g.items.length > 1)
    .map((g) => ({ groupId: g.id, keepId: g.keepId }))
}
