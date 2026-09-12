import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScanProgress, ScanResult } from '@shared/types'
import { errorMessage } from '@/lib/format'

export interface ScanState {
  result: ScanResult | null
  progress: ScanProgress | null
  isScanning: boolean
  error: string | null
  run: () => Promise<void>
  /** 파일이 움직인 뒤(실행·실행취소) 부른다. 결과를 비워 다시 스캔하기 전까지 계획 버튼을 막는다 */
  invalidate: () => void
}

/**
 * 스캔 실행과 진행률 구독을 한곳에 묶는다.
 *
 * 스캔은 main 프로세스에서 돌고 진행률만 이벤트로 넘어온다.
 * 컴포넌트가 사라진 뒤에 상태를 건드리지 않도록 구독은 반드시 정리한다.
 */
export function useScan(): ScanState {
  const [result, setResult] = useState<ScanResult | null>(null)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true

    const unsubscribe = window.api.onScanProgress((next) => {
      if (mounted.current) setProgress(next)
    })

    return () => {
      mounted.current = false
      unsubscribe()
    }
  }, [])

  const run = useCallback(async () => {
    setIsScanning(true)
    setError(null)
    setProgress(null)

    try {
      const next = await window.api.runScan()
      if (mounted.current) setResult(next)
    } catch (err) {
      console.error('스캔 실패', err)
      if (mounted.current) setError(errorMessage(err, '스캔에 실패했습니다'))
    } finally {
      if (mounted.current) {
        setIsScanning(false)
        setProgress(null)
      }
    }
  }, [])

  const invalidate = useCallback(() => {
    setResult(null)
    setError(null)
  }, [])

  return { result, progress, isScanning, error, run, invalidate }
}

export type { ScanProgress, ScanResult }
