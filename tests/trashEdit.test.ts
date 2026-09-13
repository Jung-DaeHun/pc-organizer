import { describe, expect, it } from 'vitest'
import type { TrashGroup, TrashItem, TrashPlan } from '@shared/types'
import {
  setAllIncluded,
  setIncluded,
  setKeeper,
  summarize,
  trashItemsOf
} from '../src/renderer/src/lib/trashEdit'

function item(id: string): TrashItem {
  return { id, path: `C:\\${id}`, name: id, size: 100, mtimeMs: 0, lastTouchedMs: 0 }
}

function group(id: string, size: number, itemIds: string[], overrides: Partial<TrashGroup> = {}): TrashGroup {
  const items = itemIds.map(item)
  return { id, size, items: items.map((it) => ({ ...it, size })), keepId: items[0]!.id, included: true, ...overrides }
}

const plan: TrashPlan = {
  id: 'p',
  createdAt: 0,
  scannedAt: 1,
  groups: [group('0', 100, ['0.0', '0.1', '0.2']), group('1', 700, ['1.0', '1.1'])]
}

describe('setKeeper', () => {
  it('그룹의 남길 파일을 바꾼다', () => {
    const next = setKeeper(plan, '0', '0.2')
    expect(next.groups[0]!.keepId).toBe('0.2')
    expect(next.groups[1]).toBe(plan.groups[1])
  })

  it('그룹에 없는 id 면 아무것도 바꾸지 않는다 (같은 객체)', () => {
    expect(setKeeper(plan, '0', '1.0')).toBe(plan)
    expect(setKeeper(plan, 'nope', '0.1')).toBe(plan)
  })

  it('이미 남길 파일이면 같은 객체', () => {
    expect(setKeeper(plan, '0', '0.0')).toBe(plan)
  })
})

describe('setIncluded / setAllIncluded', () => {
  it('그룹 하나를 뺐다 넣는다', () => {
    const excluded = setIncluded(plan, '1', false)
    expect(excluded.groups[1]!.included).toBe(false)
    expect(excluded.groups[0]).toBe(plan.groups[0])
    expect(setIncluded(excluded, '1', true).groups[1]!.included).toBe(true)
  })

  it('바뀌는 게 없으면 같은 객체', () => {
    expect(setIncluded(plan, '0', true)).toBe(plan)
    expect(setAllIncluded(plan, true)).toBe(plan)
  })

  it('전부 뺀 뒤 전부 넣는다', () => {
    const none = setAllIncluded(plan, false)
    expect(none.groups.every((g) => !g.included)).toBe(true)
    expect(setAllIncluded(none, true).groups.every((g) => g.included)).toBe(true)
  })
})

describe('summarize', () => {
  it('포함한 그룹에서 남길 것을 뺀 나머지를 센다', () => {
    // 그룹 0: 3개 중 2개 × 100, 그룹 1: 2개 중 1개 × 700
    expect(summarize(plan)).toEqual({
      groups: 2,
      includedGroups: 2,
      files: 3,
      bytes: 900,
      reclaimableBytes: 900
    })
  })

  it('뺀 그룹은 files·bytes 에서 빠지지만 전체 지울 수 있는 양에는 남는다', () => {
    expect(summarize(setIncluded(plan, '1', false))).toEqual({
      groups: 2,
      includedGroups: 1,
      files: 2,
      bytes: 200,
      reclaimableBytes: 900
    })
  })

  it('남길 파일을 바꿔도 개수·용량은 그대로다 (그룹마다 하나는 항상 남는다)', () => {
    expect(summarize(setKeeper(plan, '0', '0.2'))).toEqual(summarize(plan))
  })
})

describe('trashItemsOf', () => {
  it('남길 것을 뺀 나머지', () => {
    const g = setKeeper(plan, '0', '0.1').groups[0]!
    expect(trashItemsOf(g).map((it) => it.id)).toEqual(['0.0', '0.2'])
  })
})
