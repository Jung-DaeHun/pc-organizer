import { useCallback, useEffect, useRef, useState } from 'react'
import type { TrashOutcome, TrashPlan, TrashProgress, TrashRequest } from '@shared/types'
import { errorMessage } from '@/lib/format'
import { setAllIncluded, setIncluded, setKeeper } from '@/lib/trashEdit'

export type TrashBusy = 'build' | 'execute' | null

export interface TrashState {
  plan: TrashPlan | null
  busy: TrashBusy
  error: string | null
  /** 실행 진행률(검증 → 보내기). busy === 'execute' 일 때만 값이 있다 */
  progress: TrashProgress | null
  /** 마지막 스캔의 중복 후보로 계획을 세운다. 파일을 읽지 않는다 */
  build: (scannedAt: number) => Promise<void>
  /**
   * 확인 다이얼로그에서 사용자가 누른 뒤에만 부른다. 'done' 이면 파일이 휴지통에 갔으니 화면의 계획을 비운다.
   * 'blocked' 면 아무것도 안 갔고 계획은 남는다. 호출 자체가 실패하면 error 에 문장을 남기고 null
   */
  execute: (requests: TrashRequest[]) => Promise<TrashOutcome | null>
  /** 화면 편집. 남길 파일과 포함 여부만 바꿀 수 있다 */
  chooseKeeper: (groupId: string, itemId: string) => void
  include: (groupId: string, included: boolean) => void
  includeAll: (included: boolean) => void
  clear: () => void
}

/**
 * 휴지통 계획 상태. usePlan 과 같은 모양이되 훨씬 단순하다 — 편집이 실패할 길이 없어 결과를 돌려주지 않는다.
 * 원본은 main 이 들고 있고 여기 있는 건 화면용 사본이다.
 */
export function useTrash(): TrashState {
  const [plan, setPlan] = useState<TrashPlan | null>(null)
  const [busy, setBusy] = useState<TrashBusy>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<TrashProgress | null>(null)

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    const unsubscribe = window.api.onTrashProgress((next) => {
      if (mounted.current) setProgress(next)
    })
    return () => {
      mounted.current = false
      unsubscribe()
    }
  }, [])

  const guard = useCallback(
    async <T>(kind: TrashBusy, work: () => Promise<T>, fallback: string): Promise<T | null> => {
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
    async (scannedAt: number) => {
      const next = await guard(
        'build',
        () => window.api.buildTrashPlan(scannedAt),
        '중복 정리 목록을 만들지 못했습니다'
      )
      if (next && mounted.current) setPlan(next)
    },
    [guard]
  )

  const execute = useCallback<TrashState['execute']>(
    async (requests) => {
      setProgress(null)
      const outcome = await guard(
        'execute',
        () => window.api.executeTrash(requests),
        '휴지통으로 보내지 못했습니다'
      )
      if (mounted.current) {
        setProgress(null)
        // 파일이 휴지통에 갔다. 이 계획은 더 이상 실제와 맞지 않는다
        if (outcome?.status === 'done') setPlan(null)
      }
      return outcome
    },
    [guard]
  )

  const chooseKeeper = useCallback<TrashState['chooseKeeper']>((groupId, itemId) => {
    setPlan((current) => (current ? setKeeper(current, groupId, itemId) : current))
  }, [])
  const include = useCallback<TrashState['include']>((groupId, included) => {
    setPlan((current) => (current ? setIncluded(current, groupId, included) : current))
  }, [])
  const includeAll = useCallback<TrashState['includeAll']>((included) => {
    setPlan((current) => (current ? setAllIncluded(current, included) : current))
  }, [])

  const clear = useCallback(() => {
    setPlan(null)
    setError(null)
  }, [])

  return { plan, busy, error, progress, build, execute, chooseKeeper, include, includeAll, clear }
}
