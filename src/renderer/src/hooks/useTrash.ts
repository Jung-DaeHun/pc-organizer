import { useCallback, useEffect, useRef, useState } from 'react'
import type { TrashPlan } from '@shared/types'
import { errorMessage } from '@/lib/format'
import { setAllIncluded, setIncluded, setKeeper } from '@/lib/trashEdit'

export interface TrashState {
  plan: TrashPlan | null
  busy: boolean
  error: string | null
  /** 마지막 스캔의 중복 후보로 계획을 세운다. 파일을 읽지 않는다 */
  build: (scannedAt: number) => Promise<void>
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const build = useCallback(async (scannedAt: number) => {
    setBusy(true)
    setError(null)
    try {
      const next = await window.api.buildTrashPlan(scannedAt)
      if (mounted.current) setPlan(next)
    } catch (err) {
      console.error('중복 정리 목록을 만들지 못했습니다', err)
      if (mounted.current) setError(errorMessage(err, '중복 정리 목록을 만들지 못했습니다'))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [])

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

  return { plan, busy, error, build, chooseKeeper, include, includeAll, clear }
}
