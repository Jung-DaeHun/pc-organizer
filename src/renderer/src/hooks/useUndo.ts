import { useCallback, useEffect, useRef, useState } from 'react'
import type { UndoEntry, UndoOutcome } from '@shared/types'
import { errorMessage } from '@/lib/format'

export interface UndoState {
  /** 최근 것이 앞. 아직 안 읽었으면 null */
  entries: UndoEntry[] | null
  busy: boolean
  error: string | null
  refresh: () => Promise<void>
  /** 기록 하나를 되돌린다. 실패하면 error 에 문장을 남기고 null */
  undo: (id: string) => Promise<UndoOutcome | null>
}

/**
 * 실행 기록(저널)과 실행취소. 기록은 main 의 userData/journal.json 에 있고 여기 있는 건 화면용 사본이다.
 * 대시보드의 '최근 실행' 카드와 계획 화면의 결과 다이얼로그가 같이 쓴다.
 */
export function useUndo(): UndoState {
  const [entries, setEntries] = useState<UndoEntry[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const next = await window.api.listUndo()
      if (mounted.current) setEntries(next)
    } catch (err) {
      console.error('실행 기록 읽기 실패', err)
      if (mounted.current) setError(errorMessage(err, '실행 기록을 읽지 못했습니다'))
    }
  }, [])

  const undo = useCallback<UndoState['undo']>(
    async (id) => {
      setBusy(true)
      setError(null)
      try {
        const outcome = await window.api.runUndo(id)
        if (mounted.current) {
          setEntries((current) =>
            current ? current.map((e) => (e.id === outcome.entry.id ? outcome.entry : e)) : current
          )
        }
        return outcome
      } catch (err) {
        console.error('실행취소 실패', err)
        if (mounted.current) setError(errorMessage(err, '되돌리지 못했습니다'))
        return null
      } finally {
        if (mounted.current) setBusy(false)
      }
    },
    []
  )

  return { entries, busy, error, refresh, undo }
}
