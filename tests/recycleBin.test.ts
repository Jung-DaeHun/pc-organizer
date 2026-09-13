import { describe, expect, it } from 'vitest'
import {
  driveLetterOf,
  parseRecycleBinPolicy,
  type RawRecycleBinPolicy
} from '../src/main/lib/recycleBin'

/**
 * 휴지통 설정 해석(lib/recycleBin.ts). PowerShell 조회 자체는 여기서 돌리지 않고, 조회 결과를 어떻게
 * 읽는지만 본다 — 한도는 MiB → 바이트, '휴지통을 쓰지 않음' 은 어느 자리에 있든 bypassed, 모르면 null.
 */

const MIB = 1024 * 1024

/** 이 머신의 실제 조회 결과 모양 (2026-09-13, C: 930GiB, 한도 49685MiB) */
const typical: RawRecycleBinPolicy = {
  Capacity: 999_022_391_296,
  MaxCapacity: 49_685,
  NukeOnDelete: 0,
  NoRecycleFilesUser: null,
  NoRecycleFilesMachine: null,
  RecycleBinSizeUser: null,
  RecycleBinSizeMachine: null
}

describe('parseRecycleBinPolicy', () => {
  it('MaxCapacity(MiB)를 바이트 한도로 읽는다', () => {
    expect(parseRecycleBinPolicy(typical)).toEqual({ maxFileBytes: 49_685 * MIB, bypassed: false })
  })

  it('조회 실패(null)와 볼륨 키 없음(MaxCapacity null)은 모른다 — null', () => {
    expect(parseRecycleBinPolicy(null)).toBeNull()
    expect(parseRecycleBinPolicy({ ...typical, MaxCapacity: null })).toBeNull()
  })

  it("'휴지통을 쓰지 않음' 은 볼륨 설정이든 사용자·컴퓨터 정책이든 bypassed", () => {
    expect(parseRecycleBinPolicy({ ...typical, NukeOnDelete: 1 })?.bypassed).toBe(true)
    expect(parseRecycleBinPolicy({ ...typical, NoRecycleFilesUser: 1 })?.bypassed).toBe(true)
    expect(parseRecycleBinPolicy({ ...typical, NoRecycleFilesMachine: 1 })?.bypassed).toBe(true)
    // 볼륨 키가 없어도 정책이 있으면 답은 정해진다 — 보내지 않는다
    expect(parseRecycleBinPolicy({ ...typical, MaxCapacity: null, NoRecycleFilesMachine: 1 })).toEqual({
      maxFileBytes: 0,
      bypassed: true
    })
  })

  it('그룹 정책의 퍼센트 한도가 있으면 볼륨 한도와 작은 쪽을 쓴다', () => {
    // 1% of 999GB ≈ 9.99GB < 49685MiB
    const withPolicy = parseRecycleBinPolicy({ ...typical, RecycleBinSizeMachine: 1 })
    expect(withPolicy?.maxFileBytes).toBe(Math.floor(999_022_391_296 / 100))
    // 퍼센트가 커서 볼륨 한도가 더 작으면 볼륨 한도
    expect(parseRecycleBinPolicy({ ...typical, RecycleBinSizeUser: 90 })?.maxFileBytes).toBe(49_685 * MIB)
  })

  it('이상한 값(음수·문자열)은 모른다로 본다', () => {
    expect(parseRecycleBinPolicy({ ...typical, MaxCapacity: -1 })).toBeNull()
    expect(parseRecycleBinPolicy({ ...typical, MaxCapacity: '49685' as unknown as number })).toBeNull()
  })
})

describe('driveLetterOf', () => {
  it('드라이브 문자 루트만 받고 대문자로 맞춘다', () => {
    expect(driveLetterOf('C:\\')).toBe('C')
    expect(driveLetterOf('d:\\')).toBe('D')
    expect(driveLetterOf('E:/')).toBe('E')
  })

  it('UNC·빈 루트·경로 조각은 null — 그 볼륨의 휴지통은 모른다', () => {
    expect(driveLetterOf('\\\\server\\share\\')).toBeNull()
    expect(driveLetterOf('')).toBeNull()
    expect(driveLetterOf('C:\\Users')).toBeNull()
    // 드라이브 문자 하나만 스크립트에 끼워 넣으므로 여기서 걸러진 문자열은 PowerShell 에 닿지 않는다
    expect(driveLetterOf("C:'; Remove-Item x")).toBeNull()
  })
})
