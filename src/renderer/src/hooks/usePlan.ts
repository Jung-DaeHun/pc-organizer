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
      if (next && mounted.current) {
        setPlan(next)
        setEdited(false)
      }
    },
    [guard]
  )

  const preview = useCallback(
    () => guard('preview', () => window.api.previewAdvice(), '요약을 만들지 못했습니다'),
    [guard]
  )

  const advise = useCallback(async () => {
    const next = await guard('advise', () => window.api.advisePlan(), 'AI 추천을 받지 못했습니다')
    if (next && mounted.current) {
      setPlan(next)
      setEdited(false)
    }
  }, [guard])

  // ---------------------------------------------------------------- 판 편집

  const moveItems = useCallback<PlanState['moveItems']>((ids, toFolder) => {
    setPlan((current) => (current ? moveItemsIn(current, ids, toFolder) : current))
    setEdited(true)
  }, [])

  /**
   * 폴더 조작은 실패할 수 있어 결과를 동기적으로 돌려줘야 한다.
   * setState 의 함수형 갱신 안에서는 값을 밖으로 못 꺼내므로 최신 plan 을 ref 로 따로 든다.
   * (이벤트 핸들러에서만 읽으므로 effect 로 늦게 채워도 항상 최신이다)
   */
  const planRef = useRef<OrganizePlan | null>(null)
  useEffect(() => {
    planRef.current = plan
  }, [plan])

  const applyEdit = useCallback((edit: (current: OrganizePlan) => EditResult): string | null => {
    const current = planRef.current
    if (!current) return '계획이 없습니다'
    const result = edit(current)
    if (!result.ok) return result.error
    planRef.current = result.plan
    setPlan(result.plan)
    setEdited(true)
    return null
  }, [])

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
  const keepAll = useCallback<PlanState['keepAll']>((folder) => {
    setPlan((current) => (current ? keepAllIn(current, folder) : current))
    setEdited(true)
  }, [])

  const clear = useCallback(() => {
    setPlan(null)
    setError(null)
    setEdited(false)
  }, [])

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
