import { describe, expect, it } from 'vitest'
import type { InstalledApp } from '../src/shared/types'
import {
  filterApps,
  parseInstallDate,
  sortApps,
  summarizeApps
} from '../src/renderer/src/lib/appsView'

function app(partial: Partial<InstalledApp> & { name: string }): InstalledApp {
  return {
    version: '1.0',
    publisher: '',
    sizeBytes: 0,
    installDate: '',
    installLocation: '',
    ...partial
  }
}

describe('parseInstallDate', () => {
  it('YYYYMMDD 를 그 날짜의 자정(로컬)으로 읽는다', () => {
    expect(parseInstallDate('20240105')).toBe(new Date(2024, 0, 5).getTime())
  })

  it('구분자가 - 나 / 여도 같은 날짜다', () => {
    const expected = new Date(2024, 0, 5).getTime()
    expect(parseInstallDate('2024-01-05')).toBe(expected)
    expect(parseInstallDate('2024/01/05')).toBe(expected)
    expect(parseInstallDate(' 20240105 ')).toBe(expected)
  })

  it('빈 값·순서가 애매한 M/D/YYYY·달력에 없는 날짜는 모른다(null)', () => {
    expect(parseInstallDate('')).toBeNull()
    expect(parseInstallDate('1/5/2024')).toBeNull()
    expect(parseInstallDate('2024-1-5')).toBeNull()
    // 구분자가 섞이거나 한쪽에만 있으면 확실한 모양이 아니다
    expect(parseInstallDate('2024-01/05')).toBeNull()
    expect(parseInstallDate('202401-05')).toBeNull()
    expect(parseInstallDate('2024-0105')).toBeNull()
    expect(parseInstallDate('20240230')).toBeNull()
    expect(parseInstallDate('20241301')).toBeNull()
    expect(parseInstallDate('2024010')).toBeNull()
    expect(parseInstallDate('abcdefgh')).toBeNull()
  })
})

describe('filterApps', () => {
  const apps = [
    app({ name: 'Visual Studio Code', publisher: 'Microsoft Corporation' }),
    app({ name: '한글 2024', publisher: '한글과컴퓨터' }),
    app({ name: 'Notepad++', publisher: 'Notepad++ Team' })
  ]

  it('빈 검색어면 전부, 입력은 바꾸지 않는다', () => {
    const result = filterApps(apps, '   ')
    expect(result).toEqual(apps)
    expect(result).not.toBe(apps)
  })

  it('이름과 게시자를 대소문자 무시로 본다', () => {
    expect(filterApps(apps, 'visual').map((a) => a.name)).toEqual(['Visual Studio Code'])
    expect(filterApps(apps, 'MICROSOFT').map((a) => a.name)).toEqual(['Visual Studio Code'])
    expect(filterApps(apps, '한컴').map((a) => a.name)).toEqual([])
    expect(filterApps(apps, '한글').map((a) => a.name)).toEqual(['한글 2024'])
  })
})

describe('sortApps', () => {
  const big = app({ name: 'Big', sizeBytes: 3_000, installDate: '20220101' })
  const mid = app({ name: 'Mid', sizeBytes: 2_000, installDate: '20240101' })
  const small = app({ name: 'Small', sizeBytes: 1_000, installDate: '' })
  const unknown = app({ name: 'Unknown', sizeBytes: 0, installDate: '20200101' })
  const apps = [small, unknown, mid, big]

  it('용량 큰 순 — 용량을 모르는 앱은 뒤로', () => {
    expect(sortApps(apps, 'size').map((a) => a.name)).toEqual(['Big', 'Mid', 'Small', 'Unknown'])
  })

  it('설치일 오래된 순 — 설치일을 모르는 앱은 뒤로', () => {
    expect(sortApps(apps, 'installed').map((a) => a.name)).toEqual([
      'Unknown',
      'Big',
      'Mid',
      'Small'
    ])
  })

  it('이름순', () => {
    expect(sortApps(apps, 'name').map((a) => a.name)).toEqual(['Big', 'Mid', 'Small', 'Unknown'])
  })

  it('동률은 이름순이라 순서가 흔들리지 않고, 입력은 바꾸지 않는다', () => {
    const b = app({ name: 'B', sizeBytes: 5 })
    const a = app({ name: 'A', sizeBytes: 5 })
    const input = [b, a]
    expect(sortApps(input, 'size').map((x) => x.name)).toEqual(['A', 'B'])
    expect(sortApps(input, 'installed').map((x) => x.name)).toEqual(['A', 'B'])
    expect(input.map((x) => x.name)).toEqual(['B', 'A'])
  })
})

describe('summarizeApps', () => {
  it('용량은 보고한 앱만 더하고, 모르는 앱 수를 따로 센다', () => {
    const summary = summarizeApps([
      app({ name: 'A', sizeBytes: 100 }),
      app({ name: 'B', sizeBytes: 0 }),
      app({ name: 'C', sizeBytes: 50 })
    ])
    expect(summary).toEqual({ count: 3, knownSizeBytes: 150, unknownSizeCount: 1 })
  })

  it('빈 목록', () => {
    expect(summarizeApps([])).toEqual({ count: 0, knownSizeBytes: 0, unknownSizeCount: 0 })
  })
})
