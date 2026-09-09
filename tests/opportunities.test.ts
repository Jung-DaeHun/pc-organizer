import { describe, expect, it, vi } from 'vitest'
import type { FileEntry } from '@shared/types'
import {
  findDuplicates,
  findLarge,
  findOld,
  lastTouchedMs,
  selectLarge,
  selectOld,
  unionBytes
} from '../src/main/services/opportunities'

const NOW = new Date('2026-09-09T00:00:00Z').getTime()
const DAY = 86_400_000

function entry(overrides: Partial<FileEntry> & Pick<FileEntry, 'path'>): FileEntry {
  return {
    name: overrides.path.split(/[\\/]/).pop() ?? overrides.path,
    ext: '.bin',
    size: 100,
    mtimeMs: NOW,
    atimeMs: NOW,
    category: 'other',
    isCloudOnly: false,
    ...overrides
  }
}

describe('lastTouchedMs', () => {
  it('접근 시각과 수정 시각 중 최근값을 쓴다', () => {
    // 윈도우는 마지막 접근 시각 갱신이 꺼져 있어 atime이 과거에 멈춰 있는 일이 흔하다.
    // 그 값을 그대로 믿으면 지금도 쓰는 파일이 '오래된 파일'로 몰린다.
    const e = entry({ path: 'a', atimeMs: NOW - 900 * DAY, mtimeMs: NOW - 1 * DAY })
    expect(lastTouchedMs(e)).toBe(NOW - 1 * DAY)
  })
})

describe('findLarge', () => {
  it('기준 이상만 세고 큰 순서로 미리보기를 만든다', () => {
    const entries = [
      entry({ path: 'small', size: 10 }),
      entry({ path: 'big', size: 300 }),
      entry({ path: 'huge', size: 900 })
    ]

    const result = findLarge(entries, 100)

    expect(result.count).toBe(2)
    expect(result.bytes).toBe(1200)
    expect(result.samples.map((s) => s.name)).toEqual(['huge', 'big'])
  })

  it('기준과 정확히 같은 크기도 포함한다', () => {
    expect(findLarge([entry({ path: 'exact', size: 100 })], 100).count).toBe(1)
  })
})

describe('findOld', () => {
  it('기준 일수를 넘긴 파일만 고르고 오래된 순으로 보여준다', () => {
    const entries = [
      entry({ path: 'fresh', atimeMs: NOW - 10 * DAY, mtimeMs: NOW - 10 * DAY }),
      entry({ path: 'stale', atimeMs: NOW - 200 * DAY, mtimeMs: NOW - 200 * DAY }),
      entry({ path: 'ancient', atimeMs: NOW - 900 * DAY, mtimeMs: NOW - 900 * DAY })
    ]

    const result = findOld(entries, 180, NOW)

    expect(result.count).toBe(2)
    expect(result.samples.map((s) => s.name)).toEqual(['ancient', 'stale'])
  })

  it('수정 시각이 최근이면 접근 시각이 아무리 오래돼도 남긴다', () => {
    const entries = [entry({ path: 'edited', atimeMs: NOW - 900 * DAY, mtimeMs: NOW - 1 * DAY })]
    expect(findOld(entries, 180, NOW).count).toBe(0)
  })
})

describe('unionBytes', () => {
  it('두 묶음에 다 들어 있는 파일을 두 번 세지 않는다', () => {
    // 100MB 넘으면서 1년 넘게 안 쓴 파일은 흔하다.
    // 각 묶음 용량을 그냥 더하면 이런 파일이 두 번 잡혀 '확보 가능'이 부풀려진다.
    const big = entry({ path: 'big-and-old', size: 500 })
    const onlyBig = entry({ path: 'big', size: 300 })
    const onlyOld = entry({ path: 'old', size: 200 })

    expect(unionBytes([big, onlyBig], [big, onlyOld])).toBe(1000)
  })

  it('빈 묶음도 받아낸다', () => {
    expect(unionBytes([], [])).toBe(0)
  })

  it('실제 선택 결과를 겹쳐도 합계가 부풀지 않는다', () => {
    const entries = [
      entry({ path: 'big-old', size: 500, atimeMs: NOW - 900 * DAY, mtimeMs: NOW - 900 * DAY }),
      entry({ path: 'big-fresh', size: 400, atimeMs: NOW, mtimeMs: NOW }),
      entry({ path: 'small-old', size: 50, atimeMs: NOW - 900 * DAY, mtimeMs: NOW - 900 * DAY })
    ]

    const large = selectLarge(entries, 100)
    const old = selectOld(entries, 180, NOW)

    // 단순 합이면 1450 (big-old를 두 번 셈), 합집합이면 950
    expect(large.reduce((s, e) => s + e.size, 0) + old.reduce((s, e) => s + e.size, 0)).toBe(1450)
    expect(unionBytes(large, old)).toBe(950)
  })
})

describe('findDuplicates', () => {
  it('크기와 앞부분이 모두 같을 때만 중복 후보로 센다', async () => {
    const entries = [
      entry({ path: 'a', size: 500 }),
      entry({ path: 'b', size: 500 }),
      entry({ path: 'c', size: 500 })
    ]

    const result = await findDuplicates(entries, async () => 'same-hash')

    // 셋 중 하나는 남겨야 하므로 지울 수 있는 건 둘
    expect(result.count).toBe(2)
    expect(result.bytes).toBe(1000)
  })

  it('크기가 같아도 앞부분이 다르면 중복이 아니다', async () => {
    const entries = [entry({ path: 'a', size: 500 }), entry({ path: 'b', size: 500 })]

    const result = await findDuplicates(entries, async (path) => `hash-of-${path}`)

    expect(result.count).toBe(0)
    expect(result.bytes).toBe(0)
  })

  it('크기가 다르면 해시를 아예 읽지 않는다', async () => {
    const hasher = vi.fn(async () => 'irrelevant')
    const entries = [entry({ path: 'a', size: 100 }), entry({ path: 'b', size: 200 })]

    await findDuplicates(entries, hasher)

    expect(hasher).not.toHaveBeenCalled()
  })

  it('클라우드 전용 파일은 절대 읽지 않는다', async () => {
    // 이 파일을 읽는 순간 OneDrive가 내려받기를 시작한다.
    // 스캔 한 번에 수 GB가 새는 사고라서 회귀 테스트로 못박아 둔다.
    const hasher = vi.fn(async () => 'downloaded!')
    const entries = [
      entry({ path: 'cloud-1', size: 500, isCloudOnly: true }),
      entry({ path: 'cloud-2', size: 500, isCloudOnly: true })
    ]

    const result = await findDuplicates(entries, hasher)

    expect(hasher).not.toHaveBeenCalled()
    expect(result.count).toBe(0)
  })

  it('읽지 못한 파일은 후보에서 조용히 빠진다', async () => {
    const entries = [
      entry({ path: 'locked', size: 500 }),
      entry({ path: 'ok-1', size: 500 }),
      entry({ path: 'ok-2', size: 500 })
    ]

    const result = await findDuplicates(entries, async (path) =>
      path === 'locked' ? null : 'shared'
    )

    expect(result.count).toBe(1)
  })

  it('크기 0인 파일은 서로 중복으로 묶지 않는다', async () => {
    const entries = [entry({ path: 'a', size: 0 }), entry({ path: 'b', size: 0 })]
    expect((await findDuplicates(entries, async () => 'empty')).count).toBe(0)
  })
})
