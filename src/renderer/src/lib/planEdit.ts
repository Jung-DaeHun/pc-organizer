import type {
  ExecuteRequest,
  OrganizeItem,
  OrganizePlan,
  PlanItem,
  ProposedFolder,
  SkipReason
} from '@shared/types'
import { folderKey, sanitizeFolderName } from '@shared/folderName'

/**
 * 칸반 보드가 계획(화면 사본)을 고칠 때 쓰는 순수 함수들.
 *
 * 전부 `OrganizePlan → OrganizePlan` 이고 입력을 바꾸지 않는다. 경로는 어디에도 없다 —
 * 계획은 목적지를 폴더 이름으로만 말하고, 실제 경로는 실행 단계에서 main 이 만든다.
 * 컴포넌트 테스트가 없는 프로젝트라, 판의 규칙은 여기에 모아 Vitest 로 검증한다.
 *
 * main 의 규칙(planner · advisor)과 같은 불변 조건을 지킨다 — **목적지로 쓰이는 폴더는 옮기지
 * 않는다.** 열과 같은 이름의 폴더 카드는 그 열 자체라 자기 자신으로도 다른 열로도 갈 수 없고,
 * 반대로 이미 다른 열로 보낸 폴더 카드의 이름으로는 열을 만들 수 없다. 둘 중 하나라도 뚫리면
 * 판이 보여주는 것과 실행 결과가 달라진다.
 */

export interface KanbanColumn {
  folder: ProposedFolder
  items: PlanItem[]
}

export interface KanbanGroups {
  /** 그대로 두는 항목 (toFolder === null) */
  keep: PlanItem[]
  /** plan.folders 순서 그대로. AI → 규칙 → 사용자 추가 순은 main 과 addFolder 가 그렇게 쌓는다 */
  columns: KanbanColumn[]
}

export interface PlanSummary {
  moving: number
  movingBytes: number
  staying: number
  skipped: number
  newFolders: number
}

export type EditResult = { ok: true; plan: OrganizePlan } | { ok: false; error: string }

/** 크기 큰 순. 같으면 이름순으로 안정적으로 */
const bySizeDesc = (a: PlanItem, b: PlanItem): number =>
  b.item.size - a.item.size || a.item.name.localeCompare(b.item.name, 'ko')

function findFolder(plan: OrganizePlan, name: string): ProposedFolder | undefined {
  const key = folderKey(name)
  return plan.folders.find((f) => folderKey(f.name) === key)
}

/**
 * 이 폴더 카드가 판의 어느 열과 같은 이름인가. 그러면 카드는 그 열 자체다 — 옮기면 열이 사라지거나
 * 자기 안으로 들어가므로 그대로 두기 말고는 갈 곳이 없다. 카드 UI 도 이걸로 드래그를 막는다.
 */
export function isDestinationDir(item: OrganizeItem, folders: readonly ProposedFolder[]): boolean {
  if (item.kind !== 'dir') return false
  const key = folderKey(item.name)
  return folders.some((f) => folderKey(f.name) === key)
}

/** 열과 카드로 묶는다. 카드는 열 안에서 크기 큰 순 */
export function groupByFolder(plan: OrganizePlan): KanbanGroups {
  const buckets = new Map<string, PlanItem[]>()
  for (const folder of plan.folders) buckets.set(folderKey(folder.name), [])

  const keep: PlanItem[] = []
  for (const planItem of plan.items) {
    if (planItem.toFolder === null) {
      keep.push(planItem)
      continue
    }
    const bucket = buckets.get(folderKey(planItem.toFolder))
    // 폴더 목록에 없는 이름을 가리키면 그대로 두기로 취급한다 (있어서는 안 되는 상태지만 카드를 잃지 않는다)
    if (bucket) bucket.push(planItem)
    else keep.push(planItem)
  }

  return {
    keep: keep.sort(bySizeDesc),
    columns: plan.folders.map((folder) => ({
      folder,
      items: (buckets.get(folderKey(folder.name)) ?? []).sort(bySizeDesc)
    }))
  }
}

/**
 * 항목들을 폴더로(또는 null = 그대로 두기) 옮긴다. 사용자가 직접 정한 것이므로 origin 은 'user'.
 * 모르는 폴더 이름이거나 실제로 바뀐 항목이 없으면 입력을 그대로 돌려준다.
 */
export function moveItems(
  plan: OrganizePlan,
  ids: readonly string[],
  toFolder: string | null
): OrganizePlan {
  const target = toFolder === null ? null : findFolder(plan, toFolder)
  if (toFolder !== null && !target) return plan

  const idSet = new Set(ids)
  const nextName = target ? target.name : null
  let changed = false
  const items = plan.items.map((p) => {
    if (!idSet.has(p.item.id) || p.toFolder === nextName) return p
    // 열과 같은 이름의 폴더 카드는 그 열 자체다. 자기 자신으로도 다른 열로도 보내지 않는다
    // (그대로 두기로 되돌리는 것만 된다). main 이 이런 항목을 skipped 로 빼는 것과 같은 규칙
    if (nextName !== null && isDestinationDir(p.item, plan.folders)) return p
    changed = true
    return {
      ...p,
      toFolder: nextName,
      // 폴더 이름은 넣지 않는다 — 나중에 폴더 이름을 바꿔도 이유가 낡지 않게
      reason: nextName ? '직접 옮김' : '직접 그대로 두기로 정함',
      origin: 'user' as const
    }
  })
  return changed ? { ...plan, items } : plan
}

/** skipped 중 폴더인 것. 실제로 있는 폴더라 그 이름의 열은 '기존 폴더'다 */
const DIR_SKIP_REASONS: ReadonlySet<SkipReason> = new Set<SkipReason>([
  'destination',
  'has-cloud-only',
  'excluded-dir'
])

/** 루트에 실제로 있는 폴더 이름인가 (카드로 있든, 목적지·제외 등으로 skipped 에 갔든) */
function isExistingDirName(plan: OrganizePlan, key: string): boolean {
  return (
    plan.items.some((p) => p.item.kind === 'dir' && folderKey(p.item.name) === key) ||
    plan.skipped.some((s) => DIR_SKIP_REASONS.has(s.reason) && folderKey(s.name) === key)
  )
}

/**
 * 이 이름으로 열을 만들 수 없는 이유. 없으면 null.
 * 같은 이름의 파일·링크·바로가기가 루트에 있으면 실행 단계의 mkdir 이 EEXIST 로 터지고,
 * 이미 다른 열로 보낸 폴더 카드의 이름이면 그 폴더가 열이자 카드가 되어 버린다.
 */
function nameClash(plan: OrganizePlan, key: string): string | null {
  const file = plan.items.find((p) => p.item.kind === 'file' && folderKey(p.item.name) === key)
  if (file) return `'${file.item.name}' 이라는 파일이 있어 같은 이름의 폴더를 만들 수 없습니다`

  const skipped = plan.skipped.find(
    (s) => !DIR_SKIP_REASONS.has(s.reason) && folderKey(s.name) === key
  )
  if (skipped) return `'${skipped.name}' 이(가) 이미 있어 같은 이름의 폴더를 만들 수 없습니다 (${skipped.why})`

  const moved = plan.items.find(
    (p) => p.item.kind === 'dir' && p.toFolder !== null && folderKey(p.item.name) === key
  )
  if (moved) {
    return `'${moved.item.name}' 폴더를 옮기기로 해서 그 이름의 폴더는 만들 수 없습니다. 먼저 그대로 두기로 돌려놓으세요`
  }
  return null
}

type NameCheck =
  | { ok: true; name: string; existing: boolean }
  | { ok: false; error: string }

/** 이름을 검증하고 이미 있는 폴더·항목과 겹치지 않는지 본다. 실패 이유는 화면에 그대로 보여줄 문장 */
function checkNewName(plan: OrganizePlan, raw: string, except?: string): NameCheck {
  const name = sanitizeFolderName(raw)
  if (!name) {
    return { ok: false, error: '폴더 이름으로 쓸 수 없습니다 (\\ / : * ? " < > | 와 예약어, 끝의 점 금지)' }
  }
  const key = folderKey(name)
  const dup = findFolder(plan, name)
  if (dup && (!except || folderKey(dup.name) !== folderKey(except))) {
    return { ok: false, error: `'${dup.name}' 폴더가 이미 있습니다` }
  }
  const clash = nameClash(plan, key)
  if (clash) return { ok: false, error: clash }
  // 같은 이름의 폴더가 루트에 있으면 그건 '기존 폴더'다 — 실행해도 새로 만들지 않는다
  return { ok: true, name, existing: isExistingDirName(plan, key) }
}

/** 사용자가 직접 폴더 열을 만든다. 맨 뒤에 붙는다 */
export function addFolder(plan: OrganizePlan, raw: string): EditResult {
  const checked = checkNewName(plan, raw)
  if (!checked.ok) return checked
  const folder: ProposedFolder = {
    name: checked.name,
    description: '',
    existing: checked.existing,
    origin: 'user'
  }
  return { ok: true, plan: { ...plan, folders: [...plan.folders, folder] } }
}

/**
 * 새 폴더의 이름을 바꾼다. 기존 폴더(실제로 있는 폴더)는 못 바꾼다.
 * 루트에 있는 폴더의 이름으로 바꾸면 addFolder 와 같은 뜻이 되어 그 열은 '기존 폴더'가 된다.
 */
export function renameFolder(plan: OrganizePlan, from: string, raw: string): EditResult {
  const folder = findFolder(plan, from)
  if (!folder) return { ok: false, error: '없는 폴더입니다' }
  if (folder.existing) return { ok: false, error: '이미 있는 폴더의 이름은 여기서 바꿀 수 없습니다' }

  const checked = checkNewName(plan, raw, folder.name)
  if (!checked.ok) return checked
  if (checked.name === folder.name) return { ok: true, plan }

  const fromKey = folderKey(folder.name)
  return {
    ok: true,
    plan: {
      ...plan,
      folders: plan.folders.map((f) =>
        folderKey(f.name) === fromKey ? { ...f, name: checked.name, existing: checked.existing } : f
      ),
      items: plan.items.map((p) =>
        p.toFolder !== null && folderKey(p.toFolder) === fromKey
          ? { ...p, toFolder: checked.name }
          : p
      )
    }
  }
}

/** 빈 열만 지울 수 있다. 카드가 남아 있으면 거부 */
export function removeFolder(plan: OrganizePlan, name: string): EditResult {
  const folder = findFolder(plan, name)
  if (!folder) return { ok: false, error: '없는 폴더입니다' }
  const key = folderKey(folder.name)
  if (plan.items.some((p) => p.toFolder !== null && folderKey(p.toFolder) === key)) {
    return { ok: false, error: '카드가 남아 있는 폴더는 지울 수 없습니다. 먼저 카드를 옮기세요' }
  }
  return {
    ok: true,
    plan: { ...plan, folders: plan.folders.filter((f) => folderKey(f.name) !== key) }
  }
}

/** 이 폴더로 가기로 한 항목을 전부 그대로 두기로 */
export function keepAll(plan: OrganizePlan, name: string): OrganizePlan {
  const key = folderKey(name)
  const ids = plan.items
    .filter((p) => p.toFolder !== null && folderKey(p.toFolder) === key)
    .map((p) => p.item.id)
  return moveItems(plan, ids, null)
}

export function summarize(plan: OrganizePlan): PlanSummary {
  const moving = plan.items.filter((p) => p.toFolder !== null)
  const usedKeys = new Set(moving.map((p) => folderKey(p.toFolder as string)))
  return {
    moving: moving.length,
    movingBytes: moving.reduce((sum, p) => sum + p.item.size, 0),
    staying: plan.items.length - moving.length,
    skipped: plan.skipped.length,
    // 카드가 하나도 안 가는 새 폴더는 실행해도 만들어지지 않으니 세지 않는다
    newFolders: plan.folders.filter((f) => !f.existing && usedKeys.has(folderKey(f.name))).length
  }
}

/**
 * 판의 결정을 main 에 보낼 요청으로 바꾼다. 카드가 있는 열이 곧 결정이라 toFolder 가 있는 항목만
 * 들어가고, 경로는 없다 — main 이 자기 계획(lastPlan)과 id 로 대조해 경로를 만든다.
 * 폴더 목록에 없는 이름을 가리키는 항목은 groupByFolder 와 같은 이유로 그대로 두기로 본다.
 */
export function toExecuteRequests(plan: OrganizePlan): ExecuteRequest[] {
  const known = new Set(plan.folders.map((f) => folderKey(f.name)))
  const requests: ExecuteRequest[] = []
  for (const p of plan.items) {
    if (p.toFolder === null || !known.has(folderKey(p.toFolder))) continue
    requests.push({ id: p.item.id, toFolder: p.toFolder })
  }
  return requests
}
