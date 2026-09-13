import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppsInfo } from '@shared/types'
import { errorMessage } from '@/lib/format'

export interface AppsState {
  /** 레지스트리에서 읽은 목록. 아직 안 읽었으면 null */
  info: AppsInfo | null
  loading: boolean
  error: string | null
  /** 다시 읽는다 — 사용자가 윈도우 설정에서 제거하고 돌아왔을 때 */
  refresh: () => Promise<void>
}

/**
 * 설치된 앱·시작 프로그램 목록. main 이 PowerShell 로 레지스트리를 조회한 결과의 화면용 사본이다.
 * 대시보드의 '설치된 앱' 카드와 설치된 앱 화면이 같이 쓰므로 `App` 이 **한 번** 부르고 내려보낸다 — 화면마다
 * 부르면 대시보드 ↔ 앱 화면을 오갈 때마다 PowerShell 프로세스가 둘씩 새로 뜬다(각 최대 20초).
 * 마운트 때 한 번 읽고, refresh 로 다시 읽는다.
 */
export function useApps(): AppsState {
  const [info, setInfo] = useState<AppsInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // 첫 읽기는 loading 의 초기값(true)으로 시작하므로 결과만 반영한다. 콜백 안에서만 setState 한다 —
  // effect 본문에서 동기로 부르면 react-hooks/set-state-in-effect 에 걸린다
  const settle = useCallback(
    (request: Promise<AppsInfo>): Promise<void> =>
      request
        .then((next) => {
          if (mounted.current) {
            setInfo(next)
            setError(null)
          }
        })
        .catch((err: unknown) => {
          console.error('설치 앱 조회 실패', err)
          if (mounted.current) setError(errorMessage(err, '설치된 앱 목록을 읽지 못했습니다'))
        })
        .finally(() => {
          if (mounted.current) setLoading(false)
        }),
    []
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    await settle(window.api.listApps())
  }, [settle])

  useEffect(() => {
    void settle(window.api.listApps())
  }, [settle])

  return { info, loading, error, refresh }
}
