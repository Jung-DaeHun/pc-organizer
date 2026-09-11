import { useCallback, useEffect, useRef, useState } from 'react'
import type { AdvisorPreview, OrganizePlan } from '@shared/types'
import { errorMessage } from '@/lib/format'
import {
  addFolder as addFolderTo,
  keepAll as keepAllIn,
  moveItems as moveItemsIn,
  removeFolder as removeFolderFrom,
  renameFolder as renameFolderIn,
  type EditResult
} from '@/lib/planEdit'

export type PlanBusy = 'build' | 'preview' | 'advise' | null

export interface PlanState {
  plan: OrganizePlan | null
  busy: PlanBusy
  error: string | null
  /** 사용자가 판에서 무언가 고쳤는지. AI 추천을 받으면 그 수정이 덮이므로 미리 알린다 */
  edited: boolean
  /** 확장자 규칙으로 계획을 세운다 */
  build: (root: string, scannedAt: number) => Promise<void>
  /** AI 에게 보낼 내용의 요약. 네트워크를 타지 않는다 */
  preview: () => Promise<AdvisorPreview | null>
  /** 실제로 AI 에게 보낸다. preview 를 보고 사용자가 누른 뒤에만 부른다 */
  advise: () => Promise<void>
  /** 판 편집. 폴더 조작은 실패하면 화면에 보여줄 문장을 돌려준다 */
  moveItems: (ids: string[], toFolder: string | null) => void
  addFolder: (name: string) => string | null
  renameFolder: (from: string, to: string) => string | null
  removeFolder: (name: string) => string | null
  keepAll: (folder: string) => void
  clear: () => void
}

/**
 * 정리 계획 상태. useScan 과 같은 모양이다.
 *
 * 계획 원본은 main 이 들고 있고 여기 있는 건 화면용 사본이다. 판에서 카드를 옮기고 폴더를 만들면
 * 사본만 바뀌며, 실행(B 단계)은 이 사본의 {id, toFolder} 만 main 에 보내 원본과 대조한다.
 */
export function usePlan(): PlanState {
  const [plan, setPlan] = useState<OrganizePlan | null>(null)
  const [busy, setBusy] = useState<PlanBusy>(null)
  const [error, setError] = useState<string | null>(null)
  const [edited, setEdited] = useState(false)

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  /**
   * 계획의 진실은 이 ref 하나다. 폴더 조작은 실패할 수 있어 결과를 동기적으로 돌려줘야 하는데
   * setState 의 함수형 갱신 안에서는 값을 밖으로 못 꺼내므로, 모든 쓰기가 commitPlan 을 거쳐
   * ref 와 state 를 같은 순간에 바꾼다. (effect 로 ref 를 늦게 채우면 한 렌더 동안 둘이 어긋난다)
   */
  const planRef = useRef<OrganizePlan | null>(null)
  const commitPlan = useCallback((next: OrganizePlan | null, isEdit: boolean) => {
    planRef.current = next
    setPlan(next)
    setEdited(isEdit)
  }, [])

  const guard = useCallback(
    async <T>(kind: PlanBusy, work: () => Promise<T>, fallback: string): Promise<T | null> => {
      setBusy(kind)
      setError(null)
      try {
        return await work()
      } catch (err) {
        console.error(fallback, err)
        if (mounted.current) setError(errorMessage(err, fallback))
        return null
      } finally {
        if (mounted.current) setBusy(null)
      }
    },
    []
  )

  const build = useCallback(
    async (root: string, scannedAt: number) => {
      const next = await guard('build', () => window.api.buildPlan(root, scannedAt), '계획을 세우지 못했습니다')
      if (next && mounted.current) commitPlan(next, false)
    },
    [guard, commitPlan]
  )

  const preview = useCallback(
    () => guard('preview', () => window.api.previewAdvice(), '요약을 만들지 못했습니다'),
    [guard]
  )

  const advise = useCallback(async () => {
    const next = await guard('advise', () => window.api.advisePlan(), 'AI 추천을 받지 못했습니다')
    if (next && mounted.current) commitPlan(next, false)
  }, [guard, commitPlan])

  // ---------------------------------------------------------------- 판 편집

  /** 편집 하나. 실패하면 화면에 보여줄 문장, 아무것도 안 바뀌면 edited 도 건드리지 않는다 */
  const applyEdit = useCallback(
    (edit: (current: OrganizePlan) => EditResult): string | null => {
      const current = planRef.current
      if (!current) return '계획이 없습니다'
      const result = edit(current)
      if (!result.ok) return result.error
      if (result.plan !== current) commitPlan(result.plan, true)
      return null
    },
    [commitPlan]
  )

  const moveItems = useCallback<PlanState['moveItems']>(
    (ids, toFolder) => {
      applyEdit((current) => ({ ok: true, plan: moveItemsIn(current, ids, toFolder) }))
    },
    [applyEdit]
  )
  const addFolder = useCallback<PlanState['addFolder']>(
    (name) => applyEdit((current) => addFolderTo(current, name)),
    [applyEdit]
  )
  const renameFolder = useCallback<PlanState['renameFolder']>(
    (from, to) => applyEdit((current) => renameFolderIn(current, from, to)),
    [applyEdit]
  )
  const removeFolder = useCallback<PlanState['removeFolder']>(
    (name) => applyEdit((current) => removeFolderFrom(current, name)),
    [applyEdit]
  )
  const keepAll = useCallback<PlanState['keepAll']>(
    (folder) => {
      applyEdit((current) => ({ ok: true, plan: keepAllIn(current, folder) }))
    },
    [applyEdit]
  )

  const clear = useCallback(() => {
    commitPlan(null, false)
    setError(null)
  }, [commitPlan])

  return {
    plan,
    busy,
    error,
    edited,
    build,
    preview,
    advise,
    moveItems,
    addFolder,
    renameFolder,
    removeFolder,
    keepAll,
    clear
  }
}
