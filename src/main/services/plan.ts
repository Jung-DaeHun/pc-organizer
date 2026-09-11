import { randomUUID } from 'node:crypto'
import type { AdvisorPreview, OrganizePlan } from '@shared/types'
import { pathKey } from '../lib/paths'
import type { StructuredCall } from '../lib/structured'
import { advisePlan, previewAdvice } from './advisor'
import { buildRulePlan } from './planner'
import { getLastEntries, getLastScannedAt, isScanning } from './scan'
import { getSettings } from './store'
import { listTopLevel, readTopLevelFs } from './topLevel'

/**
 * 정리 계획의 조율.
 *
 * 마지막 계획은 main 에만 남긴다(scan.ts 의 lastEntries 와 같은 방식). renderer 는 항목 id 와
 * 목적지만 돌려보내고, 실행(B 단계)은 반드시 이 원본과 대조한 뒤에만 한다.
 */
let lastPlan: OrganizePlan | null = null

export function getLastPlan(): OrganizePlan | null {
  return lastPlan
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

  if (isScanning()) throw new Error('스캔이 끝난 뒤에 계획을 세우세요')

  const entries = getLastEntries()
  if (entries.length === 0 || getLastScannedAt() === 0) {
    throw new Error('먼저 스캔을 실행하세요')
  }
  if (scannedAt !== getLastScannedAt()) {
    throw new Error('화면의 스캔 결과가 최신이 아닙니다. 다시 스캔하세요')
  }

  const settings = await getSettings()
  const listing = await listTopLevel(root, entries, readTopLevelFs, {
    excludedDirNames: settings.excludedDirNames
  })
  const plan = buildRulePlan(root, listing, { id: randomUUID(), now: Date.now() })

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
