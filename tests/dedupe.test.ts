import { describe, expect, it, vi } from 'vitest'
import type { FileEntry, TrashItem } from '@shared/types'

/**
 * 휴지통 계획(dedupe.ts). 남길 파일 규칙과 계획 모양은 순수 함수로, buildTrashPlan 은 scan.ts 의 조회만
 * 바꿔 끼워 "화면이 본 스캔과 같을 때만 응한다"를 본다 (plan.test.ts 와 같은 방식).
 */
const scanState = vi.hoisted(() => ({
  groups: [] as FileEntry[][],
  scannedAt: 0
}))

vi.mock('../src/main/services/scan', () => ({
  getLastDuplicateGroups: () => scanState.groups,
  getLastScannedAt: () => scanState.scannedAt
}))

import { beginActivity } from '../src/main/services/activity'
import {
  buildTrashPlan,
  chooseKeeper,
  getLastTrashPlan,
  reclaimableOf,
  toTrashPlan
} from '../src/main/services/dedupe'

const NOW = new Date('2026-09-13T00:00:00Z').getTime()
const DAY = 86_400_000

function entry(path: string, overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    path,
    name: path.split(/[\\/]/).pop() ?? path,
    ext: '.bin',
    size: 100,
    mtimeMs: NOW,
    atimeMs: NOW,
    category: 'other',
    isCloudOnly: false,
    ...overrides
  }
}

function item(id: string, overrides: Partial<TrashItem> = {}): TrashItem {
  return { id, path: id, name: id, size: 100, mtimeMs: NOW, lastTouchedMs: NOW, ...overrides }
}

describe('chooseKeeper', () => {
  it('가장 최근에 손댄 것을 남긴다', () => {
    const items = [
      item('old', { lastTouchedMs: NOW - 30 * DAY }),
      item('fresh', { lastTouchedMs: NOW }),
      item('older', { lastTouchedMs: NOW - 90 * DAY })
    ]
    expect(chooseKeeper(items).id).toBe('fresh')
  })

  it('같으면 경로가 짧은 것 — 더 위 폴더에 있는 쪽', () => {
    const items = [
      item('a', { path: 'C:\\Users\\me\\Desktop\\deep\\copy\\x.pdf' }),
      item('b', { path: 'C:\\Users\\me\\Desktop\\x.pdf' }),
      item('c', { path: 'C:\\Users\\me\\Desktop\\other\\x.pdf' })
    ]
    expect(chooseKeeper(items).id).toBe('b')
  })

  it('그래도 같으면 앞의 것', () => {
    const items = [item('first'), item('secnd'), item('third')]
    expect(chooseKeeper(items).id).toBe('first')
  })

  it('빈 그룹은 거부한다', () => {
    expect(() => chooseKeeper([])).toThrow()
  })
})

describe('toTrashPlan', () => {
  const meta = { id: 'plan-1', now: NOW, scannedAt: 123 }

  it('그룹마다 남길 파일 하나를 고르고 전부 포함 상태로 시작한다', () => {
    const groups = [
      [
        entry('C:\\a\\x.pdf', { mtimeMs: NOW - DAY, atimeMs: NOW - DAY }),
        entry('C:\\b\\x.pdf', { mtimeMs: NOW, atimeMs: NOW - DAY })
      ]
    ]

    const plan = toTrashPlan(groups, meta)

    expect(plan).toMatchObject({ id: 'plan-1', createdAt: NOW, scannedAt: 123 })
    expect(plan.groups).toHaveLength(1)
    const group = plan.groups[0]!
    expect(group.items.map((it) => it.path)).toEqual(['C:\\a\\x.pdf', 'C:\\b\\x.pdf'])
    expect(group.keepId).toBe(group.items[1]!.id)
    expect(group.included).toBe(true)
    expect(group.size).toBe(100)
  })

  it('항목 id 는 계획 안에서 유일하고 그룹 id 를 접두로 갖는다', () => {
    const groups = [
      [entry('a1', { size: 10 }), entry('a2', { size: 10 })],
      [entry('b1', { size: 20 }), entry('b2', { size: 20 }), entry('b3', { size: 20 })]
    ]

    const plan = toTrashPlan(groups, meta)
    const ids = plan.groups.flatMap((g) => g.items.map((it) => it.id))

    expect(new Set(ids).size).toBe(ids.length)
    for (const g of plan.groups) {
      for (const it of g.items) expect(it.id.startsWith(`${g.id}.`)).toBe(true)
      expect(g.items.some((it) => it.id === g.keepId)).toBe(true)
    }
  })

  it('지울 수 있는 용량이 큰 그룹이 앞이다', () => {
    const groups = [
      [entry('small1', { size: 10 }), entry('small2', { size: 10 })],
      // 5 × 2개분 = 10 < 30 × 1개분 = 30 < 10 × 5개분 = 50
      [entry('many1', { size: 10 }), entry('many2', { size: 10 }), entry('many3', { size: 10 }),
        entry('many4', { size: 10 }), entry('many5', { size: 10 }), entry('many6', { size: 10 })],
      [entry('mid1', { size: 30 }), entry('mid2', { size: 30 })]
    ]

    const plan = toTrashPlan(groups, meta)

    expect(plan.groups.map(reclaimableOf)).toEqual([50, 30, 10])
  })

  it('둘 미만인 그룹은 버린다 — 지울 것이 없다', () => {
    const plan = toTrashPlan([[entry('alone')], [entry('p1'), entry('p2')]], meta)
    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0]!.items).toHaveLength(2)
  })

  it('lastTouchedMs 는 atime 과 mtime 중 큰 쪽이다', () => {
    const groups = [[entry('x', { atimeMs: NOW - 900 * DAY, mtimeMs: NOW - DAY }), entry('y')]]
    const plan = toTrashPlan(groups, meta)
    expect(plan.groups[0]!.items[0]!.lastTouchedMs).toBe(NOW - DAY)
  })

  it('경로·이름·크기·수정일만 옮겨 적는다 (FileEntry 를 통째로 펼치지 않는다)', () => {
    const plan = toTrashPlan([[entry('p1'), entry('p2')]], meta)
    expect(Object.keys(plan.groups[0]!.items[0]!).sort()).toEqual(
      ['id', 'lastTouchedMs', 'mtimeMs', 'name', 'path', 'size'].sort()
    )
  })
})

describe('buildTrashPlan', () => {
  it('화면이 본 스캔과 같을 때만 응하고 결과를 main 에 남긴다', () => {
    scanState.groups = [[entry('p1'), entry('p2')]]
    scanState.scannedAt = 1000

    const plan = buildTrashPlan(1000)

    expect(plan.scannedAt).toBe(1000)
    expect(plan.groups).toHaveLength(1)
    expect(getLastTrashPlan()).toBe(plan)
  })

  it('스캔 전이면 거부한다', () => {
    scanState.groups = []
    scanState.scannedAt = 0
    expect(() => buildTrashPlan(0)).toThrow('먼저 스캔')
  })

  it('화면의 스캔 결과가 낡았으면 거부한다', () => {
    scanState.groups = [[entry('p1'), entry('p2')]]
    scanState.scannedAt = 2000
    expect(() => buildTrashPlan(1000)).toThrow('최신이 아닙니다')
  })

  it('스캔·실행·실행취소가 도는 동안은 거부한다', () => {
    scanState.groups = [[entry('p1'), entry('p2')]]
    scanState.scannedAt = 3000
    const release = beginActivity('scan')
    try {
      expect(() => buildTrashPlan(3000)).toThrow('진행 중')
    } finally {
      release()
    }
    expect(buildTrashPlan(3000).groups).toHaveLength(1)
  })
})
