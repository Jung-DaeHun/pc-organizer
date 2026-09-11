import { useCallback, useEffect, useRef, useState } from 'react'
import type { AdvisorPreview, OrganizePlan, PlanItem } from '@shared/types'
import { errorMessage } from '@/lib/format'

export type PlanBusy = 'build' | 'preview' | 'advise' | null

export interface PlanState {
  plan: OrganizePlan | null
  busy: PlanBusy
  error: string | null
  /** 사용자가 화면에서 체크·목적지를 고쳤는지. AI 추천을 받으면 그 수정이 덮이므로 미리 알린다 */
  edited: boolean
  /** 확장자 규칙으로 계획을 세운다 */
  build: (root: string, scannedAt: number) => Promise<void>
  /** AI 에게 보낼 내용의 요약. 네트워크를 타지 않는다 */
  preview: () => Promise<AdvisorPreview | null>
  /** 실제로 AI 에게 보낸다. preview 를 보고 사용자가 누른 뒤에만 부른다 */
  advise: () => Promise<void>
  /** 사용자가 화면에서 고친 승인 여부·목적지를 renderer 쪽 계획에 반영 */
  patchItem: (id: string, patch: Partial<Pick<PlanItem, 'approved' | 'toDir'>>) => void
  clear: () => void
}

/**
 * 정리 계획 상태. useScan 과 같은 모양이다.
 *
 * 계획 원본은 main 이 들고 있고 여기 있는 건 화면용 사본이다. 사용자가 체크박스와 목적지를
 * 바꾸면 사본만 바뀌며, 실행(B 단계)은 이 사본의 {id, toDir} 만 main 에 보내 원본과 대조한다.
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

  const patchItem = useCallback<PlanState['patchItem']>((id, patch) => {
    setPlan((current) => {
      if (!current) return current
      return {
        ...current,
        items: current.items.map((p) => (p.item.id === id ? { ...p, ...patch } : p))
      }
    })
    setEdited(true)
  }, [])

  const clear = useCallback(() => {
    setPlan(null)
    setError(null)
    setEdited(false)
  }, [])

  return { plan, busy, error, edited, build, preview, advise, patchItem, clear }
}
