/** 화면 표기용 순수 함수 모음. 부수효과가 없어 그대로 단위 테스트한다. */

// 크기 표기는 main 의 오류 문장(executor.ts)과 같은 함수를 쓴다 — 화면과 문장의 수치가 어긋나지 않게
export { formatBytes } from '@shared/format'

/** 1234 -> '1,234' */
export function formatCount(n: number): string {
  return n.toLocaleString('ko-KR')
}

/** 0.732 -> '73%' */
export function formatPercent(ratio: number, fractionDigits = 0): string {
  if (!Number.isFinite(ratio)) return '0%'
  return `${(ratio * 100).toFixed(fractionDigits)}%`
}

/** 타임스탬프를 '2026. 9. 9.' 형태로 */
export function formatDate(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '-'
  return new Date(ms).toLocaleDateString('ko-KR')
}

/** 지난 시간을 '3일 전' 처럼. 파일이 얼마나 묵었는지 한눈에 보여주려는 용도 */
export function formatAge(ms: number, now = Date.now()): string {
  if (!Number.isFinite(ms) || ms <= 0) return '-'

  const days = Math.floor((now - ms) / 86_400_000)
  if (days < 0) return '방금'
  if (days === 0) return '오늘'
  if (days < 30) return `${days}일 전`
  if (days < 365) return `${Math.floor(days / 30)}개월 전`
  return `${Math.floor(days / 365)}년 전`
}

/**
 * IPC 핸들러가 던진 예외를 사람이 읽을 메시지로.
 *
 * Electron 은 main 의 Error 를 "Error invoking remote method 'x': Error: 메시지" 로 감싸서 넘긴다.
 * 그 접두는 사용자에게 아무 정보도 아니라 떼어낸다.
 */
export function errorMessage(err: unknown, fallback = '알 수 없는 오류'): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  const cleaned = raw.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, '').trim()
  return cleaned || fallback
}

/** 긴 경로를 가운데를 접어서 줄인다. 'C:\Users\...\report.pdf' */
export function truncatePath(path: string, maxLength = 48): string {
  if (path.length <= maxLength) return path

  const head = Math.ceil((maxLength - 3) / 2)
  const tail = Math.floor((maxLength - 3) / 2)
  return `${path.slice(0, head)}...${path.slice(-tail)}`
}
