/**
 * main 과 renderer 가 같이 쓰는 표기 함수. 순수 함수뿐이다 (node·electron 없음).
 * renderer 전용 표기(`renderer/src/lib/format.ts`)는 여기 것을 다시 내보낸다.
 */

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
