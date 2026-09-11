import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScanProgress, ScanResult } from '@shared/types'
import { errorMessage } from '@/lib/format'

export interface ScanState {
  result: ScanResult | null
  progress: ScanProgress | null
  isScanning: boolean
  error: string | null
  run: () => Promise<void>
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

  return { result, progress, isScanning, error, run }
}

export type { ScanProgress, ScanResult }
