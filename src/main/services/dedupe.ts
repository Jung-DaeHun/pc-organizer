import { randomUUID } from 'node:crypto'
import type {
  FileEntry,
  TrashEntry,
  TrashGroup,
  TrashItem,
  TrashOutcome,
  TrashPlan,
  TrashProgress,
  TrashRequest
} from '@shared/types'
import type { HashIo } from '../lib/hash'
import type { RecycleBinLookup } from '../lib/recycleBin'
import { assertIdle, beginActivity } from './activity'
import { executeTrash, preflightTrash, resolveTrash, type ExecutorIo } from './executor'
import { saveEntry } from './journal'
import { lastTouchedMs } from './opportunities'
import { clearLastPlan } from './plan'
import { getLastDuplicateGroups, getLastScannedAt, markStale } from './scan'

/**
 * 중복 후보 → 휴지통 계획의 조율. 이동 계획(plan.ts)과 같은 구조다.
 *
 * 마지막 계획은 main 에만 남긴다. renderer 는 그룹 id 와 남길 파일 id 만 돌려보내고, 실행은 반드시
 * 이 원본과 대조한 뒤에만 한다. AI 는 관여하지 않는다 — 여기 오는 그룹은 스캔의 규칙(크기 + 앞 4KB)이
 * 만든 것뿐이다.
 *
 * 계획은 파일을 읽지 않는다. 그룹은 스캔이 이미 계산해 두었고(scan.ts `lastDuplicateGroups`), 여기서는
 * 남길 파일을 고르고 모양만 바꾼다. 파일을 읽는 건 실행 직전의 전체 해시 비교(executor.preflightTrash)뿐이다.
 */
let lastTrashPlan: TrashPlan | null = null

export function getLastTrashPlan(): TrashPlan | null {
  return lastTrashPlan
}

function requireTrashPlan(): TrashPlan {
  if (!lastTrashPlan) throw new Error('먼저 중복 정리 목록을 만드세요')
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

// ---------------------------------------------------------------- 실행

export interface TrashDeps {
  /** 쓰기 I/O (trashItem). ipc/handlers.ts 만 실체를 만든다 */
  io: ExecutorIo
  /** 읽기 I/O (lstat · open). 전체 해시 비교에 쓴다 */
  hashIo: HashIo
  /** 볼륨의 휴지통 설정 조회 (읽기 전용). 한도 이상인 파일은 trashItem 이 영구 삭제하므로 보내기 전에 본다 */
  recycleBin: RecycleBinLookup
  /** userData/journal.json. 경로도 handlers.ts 가 넘긴다 (서비스는 electron 을 모른다) */
  journalPath: string
  onProgress?: (progress: TrashProgress) => void
}

/**
 * 사용자가 화면에서 확인한 그룹을 휴지통으로 보낸다. **이 앱에서 사용자 파일을 휴지통으로 보내는 유일한 진입점.**
 *
 * 순서: 자물쇠(activity.ts — 스캔·실행·실행취소와 겹치지 않게) → 계획이 화면이 본 스캔의 것인지(scannedAt —
 * 파일이 움직였으면 markStale 로 어긋나 있다) → lastTrashPlan 과 대조(resolveTrash — 하나라도 어긋나면 전체
 * 거부) → 읽기 전용 사전 점검(preflightTrash — 휴지통 설정·lstat·전체 해시, 하나라도 걸리면 아무것도 보내지
 * 않고 'blocked') → 빈 기록을 저널에 먼저 저장(기록을 남길 수 없으면 보내지 않는다) → 파일마다 보내고 기록 갱신 →
 * 계획·스캔 목록을 버린다(다시 스캔해야 한다).
 */
export async function executeTrashApproved(
  requests: readonly TrashRequest[],
  deps: TrashDeps
): Promise<TrashOutcome> {
  const plan = requireTrashPlan()
  // 검사보다 먼저 잠근다 — 아래 await 사이로 다른 호출이 끼어들 수 없게
  const release = beginActivity('trash')
  // 무언가 보내기 전에 예외·'blocked'·기록 실패로 돌아가면 계획은 그대로 살아 있어
  // 사용자가 걸린 그룹을 빼고 다시 실행할 수 있다
  let started = false
  try {
    if (plan.scannedAt !== getLastScannedAt()) {
      throw new Error('스캔 결과가 낡았습니다 (파일이 움직였습니다). 다시 스캔하세요')
    }
    const jobs = resolveTrash(plan, requests)

    const problems = await preflightTrash(jobs, deps.hashIo, deps.recycleBin, deps.onProgress)
    if (problems.length > 0) return { status: 'blocked', problems }

    // 남긴 파일은 실제로 보낸 그룹의 것만 센다 — 보내는 도중 남길 파일이 사라진 그룹은 하나도 보내지 않았고
    // 남긴 것도 없다. 계획 시점에 채워 두면 화면의 "N개 남김"이 실제보다 많아진다
    const keeperOf = new Map(jobs.flatMap((job) => job.targets.map((t) => [t.id, job.keeper.path])))
    const entry: TrashEntry = {
      kind: 'trash',
      id: randomUUID(),
      executedAt: Date.now(),
      results: [],
      keptPaths: []
    }
    try {
      await saveEntry(deps.journalPath, entry)
    } catch (err) {
      throw new Error(
        `실행 기록을 남길 수 없어 보내지 않았습니다 (${err instanceof Error ? err.message : String(err)})`,
        { cause: err }
      )
    }

    started = true
    const results = await executeTrash(jobs, deps.io, deps.hashIo, {
      onProgress: deps.onProgress,
      onResult: async (result) => {
        entry.results.push(result)
        const kept = result.ok ? keeperOf.get(result.id) : undefined
        if (kept && !entry.keptPaths.includes(kept)) entry.keptPaths.push(kept)
        await saveEntry(deps.journalPath, entry)
      }
    })

    // onResult 가 실패해 중단됐으면 남은 실패 항목이 results 에 없다. 마지막 모양을 한 번 더 저장한다
    entry.results = results
    try {
      await saveEntry(deps.journalPath, entry)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[dedupe] 실행 기록 저장 실패:', message)
      return { status: 'done', entry, journalError: message }
    }

    return { status: 'done', entry }
  } finally {
    release()
    if (started) {
      // 무언가 휴지통으로 갔을 수 있다. 계획과 스캔 목록은 더 믿을 수 없다 — 다시 스캔해야 한다
      lastTrashPlan = null
      clearLastPlan()
      markStale()
    }
  }
}
