import { randomUUID } from 'node:crypto'
import type {
  AdvisorPreview,
  ExecuteOutcome,
  ExecuteProgress,
  ExecuteRequest,
  OrganizePlan,
  UndoEntry
} from '@shared/types'
import { pathKey } from '../lib/paths'
import type { StructuredCall } from '../lib/structured'
import { assertIdle, beginActivity } from './activity'
import { advisePlan, previewAdvice } from './advisor'
import { createCategorizer } from './categorize'
import { executeMoves, preflight, resolveMoves, type ExecutorIo } from './executor'
import { saveEntry } from './journal'
import { buildRulePlan } from './planner'
import { getLastEntries, getLastScannedAt, markStale } from './scan'
import { getSettings } from './store'
import { listTopLevel, readTopLevelFs } from './topLevel'

/**
 * 정리 계획의 조율.
 *
 * 마지막 계획은 main 에만 남긴다(scan.ts 의 lastEntries 와 같은 방식). renderer 는 항목 id 와
 * 목적지만 돌려보내고, 실행은 반드시 이 원본과 대조한 뒤에만 한다(executeApproved).
 */
let lastPlan: OrganizePlan | null = null

export function getLastPlan(): OrganizePlan | null {
  return lastPlan
}

/** 파일이 움직인 뒤에는 계획이 실제와 어긋난다. 실행·실행취소가 부른다 */
export function clearLastPlan(): void {
  lastPlan = null
}

function requirePlan(): OrganizePlan {
  if (!lastPlan) throw new Error('먼저 정리 계획을 세우세요')
  return lastPlan
}

/** 감시 폴더로 등록된 경로만 계획 대상이 될 수 있다 */
async function assertWatched(root: string): Promise<void> {
  const settings = await getSettings()
  const key = pathKey(root)
  if (!settings.watchedFolders.some((folder) => pathKey(folder) === key)) {
    throw new Error('감시 폴더로 등록된 경로가 아닙니다')
  }
}

/**
 * 확장자 규칙으로 계획을 세운다.
 *
 * @param scannedAt renderer 가 화면에 보여주고 있는 ScanResult.scannedAt.
 *   main 의 목록과 다르면 사용자가 본 적 없는 목록으로 계획을 세우는 것이므로 거부한다.
 */
export async function buildPlan(root: string, scannedAt: number): Promise<OrganizePlan> {
  await assertWatched(root)

  // 스캔 중이면 목록이 아직 없고, 실행·실행취소 중이면 목록이 곧 버려진다
  assertIdle('계획을 세우세요')

  const entries = getLastEntries()
  if (entries.length === 0 || getLastScannedAt() === 0) {
    throw new Error('먼저 스캔을 실행하세요')
  }
  if (scannedAt !== getLastScannedAt()) {
    throw new Error('화면의 스캔 결과가 최신이 아닙니다. 다시 스캔하세요')
  }

  const settings = await getSettings()
  const listing = await listTopLevel(root, entries, readTopLevelFs, {
    excludedDirNames: settings.excludedDirNames,
    // 규칙을 스캔 뒤에 고쳤으면 lastEntries 의 카테고리는 옛 규칙이다. 루트 바로 아래 파일은 여기서
    // 다시 분류하므로 계획은 지금 규칙을 따른다 (집계 카드는 다시 스캔해야 맞는다)
    categorize: createCategorizer(settings.rules)
  })
  const plan = buildRulePlan(root, listing, {
    id: randomUUID(),
    now: Date.now(),
    rules: settings.rules
  })

  lastPlan = plan
  return plan
}

/** AI 에게 보내기 전에 보여줄 요약. 네트워크를 타지 않는다 */
export function previewPlanAdvice(): AdvisorPreview {
  return previewAdvice(requirePlan())
}

/**
 * 마지막 계획을 AI 에게 묻고 추천을 얹는다. 여기가 이 앱에서 네트워크로 나가는 유일한 경로다.
 * 호출자(ipc/handlers.ts)가 키로 만든 StructuredCall 을 넣어준다 — 키는 서비스로 들어오지 않는다.
 */
export async function advise(call: StructuredCall): Promise<OrganizePlan> {
  const advised = await advisePlan(requirePlan(), call)
  lastPlan = advised
  return advised
}

// ---------------------------------------------------------------- 실행

export interface ExecuteDeps {
  /** 쓰기 I/O. ipc/handlers.ts 만 실체를 만든다 */
  io: ExecutorIo
  /** userData/journal.json. 경로도 handlers.ts 가 넘긴다 (서비스는 electron 을 모른다) */
  journalPath: string
  onProgress?: (progress: ExecuteProgress) => void
}

/**
 * 사용자가 판에서 승인한 이동을 실행한다. **이 앱에서 사용자 파일을 움직이는 유일한 진입점.**
 *
 * 순서: 자물쇠(activity.ts — 스캔·실행취소와 겹치지 않게) → lastPlan 과 대조(resolveMoves — 하나라도
 * 어긋나면 전체 거부) → 읽기 전용 사전 점검(preflight — 하나라도 걸리면 아무것도 옮기지 않고 'blocked') →
 * 빈 기록을 저널에 먼저 저장(기록을 남길 수 없으면 실행하지 않는다) → 항목마다 옮기고 기록 갱신 →
 * 계획·스캔 목록을 버린다(다시 스캔해야 한다).
 */
export async function executeApproved(
  requests: readonly ExecuteRequest[],
  deps: ExecuteDeps
): Promise<ExecuteOutcome> {
  const plan = requirePlan()
  // 검사보다 먼저 잠근다 — 아래 await 사이로 다른 호출이 끼어들 수 없게
  const release = beginActivity('execute')
  // 무언가 옮기기 전에 예외·'blocked'·기록 실패로 돌아가면 계획은 그대로 살아 있어
  // 사용자가 걸린 카드를 고쳐 다시 실행할 수 있다
  let started = false
  try {
    // 계획을 세운 뒤 감시 폴더에서 빠졌을 수 있다
    await assertWatched(plan.root)
    const moves = resolveMoves(plan, requests)

    const problems = await preflight(moves, deps.io)
    if (problems.length > 0) return { status: 'blocked', problems }

    const entry: UndoEntry = {
      id: randomUUID(),
      executedAt: Date.now(),
      root: plan.root,
      results: [],
      createdFolders: []
    }
    try {
      await saveEntry(deps.journalPath, entry)
    } catch (err) {
      throw new Error(
        `실행 기록을 남길 수 없어 실행하지 않았습니다 (${err instanceof Error ? err.message : String(err)})`,
        { cause: err }
      )
    }

    started = true
    const report = await executeMoves(moves, deps.io, {
      onProgress: deps.onProgress,
      onResult: async (result, createdFolders) => {
        entry.results.push(result)
        // 만든 폴더도 항목마다 같이 적는다 — 도중에 죽어도 실행취소가 폴더를 치울 수 있게
        entry.createdFolders = [...createdFolders]
        await saveEntry(deps.journalPath, entry)
      }
    })

    // onResult 가 실패해 중단됐으면 남은 실패 항목이 results 에 없다. 마지막 모양을 한 번 더 저장한다.
    // 이것마저 실패하면 저널이 화면의 결과와 달라 실행취소가 마지막 항목을 놓칠 수 있다 — 화면에 알린다
    entry.results = report.results
    entry.createdFolders = report.createdFolders
    try {
      await saveEntry(deps.journalPath, entry)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[plan] 실행 기록 저장 실패:', message)
      return { status: 'done', entry, journalError: message }
    }

    return { status: 'done', entry }
  } finally {
    release()
    if (started) {
      // 무언가 움직였을 수 있다. 계획과 스캔 목록은 더 믿을 수 없다 — 다시 스캔해야 한다
      lastPlan = null
      markStale()
    }
  }
}
