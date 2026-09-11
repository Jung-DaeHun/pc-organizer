import { describe, expect, it } from 'vitest'
import { topBySize } from '../src/main/services/temp'

const sample = (name: string, size: number) => ({ path: name, name, size, mtimeMs: 0 })

describe('topBySize', () => {
  it('n 개 초과 입력에서 크기 상위 n 개를 큰 순서로 돌려준다', () => {
    const input = [3, 10, 1, 7, 5, 9, 2].map((n) => sample(`f${n}`, n))
    expect(topBySize(input, 3).map((s) => s.size)).toEqual([10, 9, 7])
  })

  it('n 개 이하면 전부 돌려준다 (정렬만)', () => {
    const input = [1, 3, 2].map((n) => sample(`f${n}`, n))
    expect(topBySize(input, 5).map((s) => s.size)).toEqual([3, 2, 1])
    expect(topBySize([], 5)).toEqual([])
  })

  it('아주 큰 입력도 스프레드 없이 처리한다', () => {
    // 예전 구현 `push(...entries)` 는 이 규모에서 콜 스택이 넘쳤다
    const input = Array.from({ length: 200_000 }, (_, i) => sample(`f${i}`, i % 1000))
    const top = topBySize(input, 5)
    expect(top.map((s) => s.size)).toEqual([999, 999, 999, 999, 999])
  })
})
