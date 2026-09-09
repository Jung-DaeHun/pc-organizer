/** 화면 표기용 순수 함수 모음. 부수효과가 없어 그대로 단위 테스트한다. */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const

/**
 * 바이트를 사람이 읽는 크기로. 윈도우 탐색기와 같은 1024 기준을 쓴다.
 * (탐색기도 1024로 나누고 라벨은 KB/MB/GB로 적는다)
 */
export function formatBytes(bytes: number, fractionDigits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'

  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1)
  const value = bytes / 1024 ** exponent
  // 바이트 단위에서 소수점은 의미가 없다
  const digits = exponent === 0 ? 0 : fractionDigits

  return `${value.toFixed(digits)} ${BYTE_UNITS[exponent]}`
}

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

/** 긴 경로를 가운데를 접어서 줄인다. 'C:\Users\...\report.pdf' */
export function truncatePath(path: string, maxLength = 48): string {
  if (path.length <= maxLength) return path

  const head = Math.ceil((maxLength - 3) / 2)
  const tail = Math.floor((maxLength - 3) / 2)
  return `${path.slice(0, head)}...${path.slice(-tail)}`
}
