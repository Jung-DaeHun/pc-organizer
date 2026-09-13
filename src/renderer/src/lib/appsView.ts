import type { InstalledApp } from '@shared/types'

/**
 * 설치된 앱 화면의 순수 함수들 — 검색·정렬·설치일 해석·요약. 입력을 바꾸지 않는다.
 *
 * 목록은 main 이 레지스트리에서 읽은 그대로이고 여기서는 보여주는 순서와 범위만 정한다. 어떤 앱을 지우라고
 * 고르지 않는다 — 설치일이 오래됐다고 안 쓰는 앱이 아니고, 크다고 지워도 되는 앱이 아니다. 판단은 사용자가
 * 하고, 여기서는 그 판단의 근거(용량·설치일)를 정직하게 늘어놓는다. 컴포넌트 테스트가 없는 프로젝트라
 * 화면의 규칙은 여기에 모아 Vitest 로 검증한다.
 */

export const APP_SORTS = ['size', 'installed', 'name'] as const
export type AppSort = (typeof APP_SORTS)[number]

export const APP_SORT_LABELS: Record<AppSort, string> = {
  size: '용량 큰 순',
  installed: '설치일 오래된 순',
  name: '이름순'
}

/**
 * 레지스트리 InstallDate 를 타임스탬프로. 모양이 제각각이라 확실한 것만 받고 나머지는 null(모름).
 *
 * 표준은 'YYYYMMDD' 지만 설치 프로그램마다 'YYYY-MM-DD'·'YYYY/MM/DD' 로 적기도 한다. 'M/D/YYYY' 처럼 순서가
 * 애매한 것은 받지 않는다 — 1월 2일과 2월 1일을 바꿔 보여주느니 모른다고 하는 게 낫다.
 * 달력에 없는 날짜(2월 30일)도 null.
 */
export function parseInstallDate(raw: string): number | null {
  // 구분자는 없거나 둘 다 같아야 한다(\2) — '2024-01/05' 같은 섞인 모양은 확실한 게 아니다
  const m = /^(\d{4})([-/]?)(\d{2})\2(\d{2})$/.exec(raw.trim())
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[3])
  const day = Number(m[4])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(year, month - 1, day)
  // Date 는 2월 30일을 3월 2일로 굴려 버린다 — 되돌려 비교해 걸러낸다
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return date.getTime()
}

/** 이름·게시자에 검색어가 들어 있는 앱만. 대소문자 무시, 빈 검색어면 전부 */
export function filterApps(apps: readonly InstalledApp[], query: string): InstalledApp[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...apps]
  return apps.filter(
    (app) => app.name.toLowerCase().includes(q) || app.publisher.toLowerCase().includes(q)
  )
}

const byName = (a: InstalledApp, b: InstalledApp): number => a.name.localeCompare(b.name, 'ko')

/**
 * 정렬. 값을 모르는 앱(용량 0, 설치일 해석 불가)은 어느 기준이든 **뒤**로 보낸다 — 앞에 두면 "가장 작은 앱"·
 * "가장 오래된 앱"으로 읽힌다. 동률은 이름순이라 순서가 실행마다 흔들리지 않는다.
 */
export function sortApps(apps: readonly InstalledApp[], sort: AppSort): InstalledApp[] {
  const sorted = [...apps]
  if (sort === 'name') return sorted.sort(byName)

  if (sort === 'size') {
    return sorted.sort((a, b) => {
      const ka = a.sizeBytes > 0 ? 0 : 1
      const kb = b.sizeBytes > 0 ? 0 : 1
      return ka - kb || b.sizeBytes - a.sizeBytes || byName(a, b)
    })
  }

  const installedAt = new Map(sorted.map((app) => [app, parseInstallDate(app.installDate)]))
  return sorted.sort((a, b) => {
    const ta = installedAt.get(a) ?? null
    const tb = installedAt.get(b) ?? null
    if (ta === null && tb === null) return byName(a, b)
    if (ta === null) return 1
    if (tb === null) return -1
    return ta - tb || byName(a, b)
  })
}

export interface AppsSummary {
  count: number
  /** 용량을 보고한 앱만 더한 값. 전체 용량이 아니다 */
  knownSizeBytes: number
  /** 용량을 보고하지 않은 앱 수. 합계가 '확인된 것만'임을 화면이 밝히는 근거 */
  unknownSizeCount: number
}

export function summarizeApps(apps: readonly InstalledApp[]): AppsSummary {
  let knownSizeBytes = 0
  let unknownSizeCount = 0
  for (const app of apps) {
    if (app.sizeBytes > 0) knownSizeBytes += app.sizeBytes
    else unknownSizeCount += 1
  }
  return { count: apps.length, knownSizeBytes, unknownSizeCount }
}
