import type { Stats } from 'node:fs'

/**
 * 클라우드 전용 파일 판정의 최소 크기.
 *
 * NTFS는 아주 작은 파일을 MFT 안에 그대로 넣어버리는데(resident file),
 * 이 경우에도 할당 크기가 0으로 잡혀 클라우드 전용과 구분되지 않는다.
 * 1KB 이하는 어차피 해시 비용이 없으니 판정 대상에서 빼는 편이 안전하다.
 */
export const CLOUD_ONLY_MIN_SIZE = 1024

/**
 * OneDrive 등에서 클라우드에만 있고 로컬에는 실체가 없는 파일인지 본다.
 *
 * 이런 파일은 크기는 제대로 보이지만 실제로 할당된 블록이 없다.
 * 내용을 읽는 순간 자동으로 내려받기 시작하므로 해시 계산에서 반드시 제외해야 한다.
 * (메타데이터만 읽는 건 다운로드를 유발하지 않는다)
 *
 * 스캐너가 목록을 만들 때 한 번, 그리고 파일을 실제로 여는 코드(`hashFull`)가 열기 직전에 한 번 더
 * 부른다 — 스캔 뒤 OneDrive 가 '공간 확보'로 내려놓았을 수 있어 스캔 때의 플래그를 믿지 않는다.
 */
export function isCloudOnly(stats: Pick<Stats, 'size' | 'blocks'>): boolean {
  return stats.size > CLOUD_ONLY_MIN_SIZE && Number(stats.blocks) === 0
}
