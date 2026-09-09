import type { FileEntry, OpportunityGroup, OpportunitySample } from '@shared/types'

const DAY_MS = 86_400_000

/** 카드에 미리보기로 띄울 항목 수 */
const SAMPLE_LIMIT = 5

/** 파일 앞부분 해시를 구하는 함수. 테스트에서 갈아끼울 수 있게 밖에서 받는다. */
export type HeadHasher = (path: string) => Promise<string | null>

function toSample(entry: FileEntry): OpportunitySample {
  return { path: entry.path, name: entry.name, size: entry.size, mtimeMs: entry.mtimeMs }
}

function emptyGroup(): OpportunityGroup {
  return { count: 0, bytes: 0, samples: [] }
}

/** 파일을 마지막으로 건드린 시각.
 *
 * 윈도우는 기본적으로 '마지막 접근 시각' 갱신을 꺼두기 때문에 atime을 그대로 믿을 수 없다.
 * (atime이 생성 시각에 멈춰 mtime보다 과거인 경우가 흔하다)
 * 둘 중 최근값을 쓰면 '실제로는 쓰고 있는 파일'을 오래된 파일로 잘못 모는 일을 막는다.
 */
export function lastTouchedMs(entry: FileEntry): number {
  return Math.max(entry.atimeMs, entry.mtimeMs)
}

/** 고른 파일 묶음을 화면에 넘길 요약 수치로 바꾼다 */
export function toOpportunityGroup(matched: FileEntry[]): OpportunityGroup {
  return {
    count: matched.length,
    bytes: matched.reduce((sum, e) => sum + e.size, 0),
    samples: matched.slice(0, SAMPLE_LIMIT).map(toSample)
  }
}

/** 기준 크기 이상인 파일을 큰 순서로 */
export function selectLarge(entries: FileEntry[], thresholdBytes: number): FileEntry[] {
  return entries.filter((e) => e.size >= thresholdBytes).sort((a, b) => b.size - a.size)
}

/** 지정한 일수 넘게 손대지 않은 파일을 오래된 순서로 */
export function selectOld(
  entries: FileEntry[],
  days: number,
  now: number = Date.now()
): FileEntry[] {
  const cutoff = now - days * DAY_MS
  return entries
    .filter((e) => lastTouchedMs(e) < cutoff)
    .sort((a, b) => lastTouchedMs(a) - lastTouchedMs(b))
}

/** 기준 크기 이상인 파일 */
export function findLarge(entries: FileEntry[], thresholdBytes: number): OpportunityGroup {
  return toOpportunityGroup(selectLarge(entries, thresholdBytes))
}

/** 지정한 일수 넘게 손대지 않은 파일 */
export function findOld(
  entries: FileEntry[],
  days: number,
  now: number = Date.now()
): OpportunityGroup {
  return toOpportunityGroup(selectOld(entries, days, now))
}

/**
 * 여러 묶음에 걸친 파일의 총 용량. 같은 파일이 두 묶음에 다 들어 있어도 한 번만 센다.
 *
 * '대용량이면서 오래된' 파일은 흔하다. 각 묶음의 용량을 그냥 더하면
 * 그런 파일을 두 번 세서 실제보다 부풀려진 숫자가 나온다.
 */
export function unionBytes(...groups: FileEntry[][]): number {
  const seen = new Set<string>()
  let bytes = 0

  for (const group of groups) {
    for (const entry of group) {
      if (seen.has(entry.path)) continue
      seen.add(entry.path)
      bytes += entry.size
    }
  }

  return bytes
}

/**
 * 중복 '후보'를 찾는다.
 *
 * 1) 크기가 같은 파일끼리 묶는다 — 크기가 다르면 내용이 같을 수 없으므로 여기서 대부분 걸러진다
 * 2) 남은 것만 앞 4KB 해시를 비교한다
 *
 * 전체 해시가 아니므로 결과는 어디까지나 후보다. 실제 삭제(2단계)에서는 전체를 다시 비교한다.
 * 클라우드 전용 파일은 읽는 순간 내려받기가 시작되므로 아예 대상에서 뺀다.
 *
 * count/bytes는 '지울 수 있는 양'이다. 같은 파일이 3개면 2개분을 센다.
 */
export async function findDuplicates(
  entries: FileEntry[],
  hashHead: HeadHasher
): Promise<OpportunityGroup> {
  const candidates = entries.filter((e) => e.size > 0 && !e.isCloudOnly)

  const bySize = new Map<number, FileEntry[]>()
  for (const entry of candidates) {
    const bucket = bySize.get(entry.size)
    if (bucket) bucket.push(entry)
    else bySize.set(entry.size, [entry])
  }

  const sizeCollisions = [...bySize.values()].filter((group) => group.length > 1)
  if (sizeCollisions.length === 0) return emptyGroup()

  const byHash = new Map<string, FileEntry[]>()
  for (const group of sizeCollisions) {
    for (const entry of group) {
      const head = await hashHead(entry.path)
      if (head === null) continue

      // 크기가 다르면서 앞부분만 같은 경우를 배제하려고 크기까지 키에 넣는다
      const key = `${entry.size}:${head}`
      const bucket = byHash.get(key)
      if (bucket) bucket.push(entry)
      else byHash.set(key, [entry])
    }
  }

  let count = 0
  let bytes = 0
  const redundant: FileEntry[] = []

  for (const group of byHash.values()) {
    if (group.length < 2) continue

    // 한 벌은 남겨야 하므로 나머지만 '지울 수 있는 것'으로 센다
    const extras = group.length - 1
    count += extras
    bytes += group[0].size * extras

    // 미리보기에는 남길 하나를 뺀 나머지를 보여준다
    redundant.push(...group.slice(1))
  }

  return {
    count,
    bytes,
    samples: redundant
      .sort((a, b) => b.size - a.size)
      .slice(0, SAMPLE_LIMIT)
      .map(toSample)
  }
}
