import type { FileEntry, Opportunities, ScanProgress, ScanResult } from '@shared/types'
import { hashHead } from '../lib/hash'
import { beginActivity } from './activity'
import { mergeEntries, scanFolders } from './scanner'
import {
  findDuplicates,
  selectLarge,
  selectOld,
  toOpportunityGroup,
  unionBytes
} from './opportunities'
import { getSettings } from './store'
import { breakdownByCategory, summarizeFolder } from './summarize'
import { measureTempAndTrash } from './temp'

/**
 * 마지막 스캔의 원본 목록.
 *
 * renderer로는 집계된 수치만 보낸다. 파일 수만 개를 IPC로 넘기면
 * 직렬화 비용만으로 화면이 눈에 띄게 버벅인다.
 * 개별 파일이 필요한 기능(정리 계획 세우기)은 main에서 이 값을 쓴다.
 *
 * 목록과 scannedAt 은 스캔이 **끝났을 때** 한꺼번에 바뀐다. 그래야 renderer 가 들고 있는
 * ScanResult.scannedAt 과 대조해 "사용자가 화면에서 본 그 목록"인지 확인할 수 있다.
 */
let lastEntries: FileEntry[] = []
let lastScannedAt = 0

export function getLastEntries(): readonly FileEntry[] {
  return lastEntries
}

/** 마지막으로 끝난 스캔의 시작 시각. ScanResult.scannedAt 과 같은 값 */
export function getLastScannedAt(): number {
  return lastScannedAt
}

/**
 * 파일을 실제로 옮긴 뒤(실행·실행취소) 부른다. 목록이 실제와 달라졌으니 다시 스캔하기 전까지는
 * 계획을 세우지 못하게 한다 — 낡은 목록으로 세운 계획은 없는 파일을 가리킨다.
 */
export function markStale(): void {
  lastEntries = []
  lastScannedAt = 0
}

/**
 * 등록된 폴더를 전부 훑고 대시보드가 필요로 하는 수치를 만든다.
 * 스캔·실행·실행취소는 한 번에 하나만 돈다(activity.ts) — 훑는 도중 파일이 움직이면 옮기기 전 위치로
 * 잡힌 목록이 남아, 그 뒤의 markStale() 이 무효가 된다.
 */
export async function runScan(onProgress?: (progress: ScanProgress) => void): Promise<ScanResult> {
  const release = beginActivity('scan')
  try {
    return await scanOnce(onProgress)
  } finally {
    release()
  }
}

const EMPTY_GROUP: Opportunities['temp'] = { count: 0, bytes: 0, samples: [] }

async function scanOnce(onProgress?: (progress: ScanProgress) => void): Promise<ScanResult> {
  const startedAt = Date.now()
  const settings = await getSettings()

  const scans = await scanFolders(settings.watchedFolders, {
    excludedDirNames: settings.excludedDirNames,
    onProgress
  })

  // 감시 폴더가 겹치면 같은 파일이 두 폴더에서 잡힌다. 집계와 중복 검사는 한 번씩만 센다.
  const entries = mergeEntries(scans)

  // 중복 후보 해시와 임시 폴더 계산은 서로 무관하니 같이 돌린다.
  // 임시 폴더·휴지통은 감시 폴더 밖의 덤이라, 거기서 실패해도 본 스캔 결과는 살린다.
  const [duplicates, temp] = await Promise.all([
    findDuplicates(entries, hashHead),
    measureTempAndTrash().catch((err: unknown) => {
      console.error('[scan] 임시 폴더 측정 실패:', err instanceof Error ? err.message : err)
      return EMPTY_GROUP
    })
  ])

  lastEntries = entries
  lastScannedAt = startedAt

  const largeEntries = selectLarge(entries, settings.largeFileBytes)
  const oldEntries = selectOld(entries, settings.oldFileDays)

  const opportunities: Opportunities = {
    duplicates,
    large: toOpportunityGroup(largeEntries),
    old: toOpportunityGroup(oldEntries),
    temp,
    // 중복 후보는 스캔 폴더 안, 임시파일은 그 밖이라 두 값은 겹치지 않는다
    reclaimableBytes: duplicates.bytes + temp.bytes,
    reviewBytes: unionBytes(largeEntries, oldEntries)
  }

  const folders = scans.map(summarizeFolder)

  return {
    scannedAt: startedAt,
    durationMs: Date.now() - startedAt,
    folders,
    totalFiles: entries.length,
    totalBytes: entries.reduce((sum, e) => sum + e.size, 0),
    totalSkipped: scans.reduce((sum, s) => sum + s.skippedCount, 0),
    byCategory: breakdownByCategory(entries),
    opportunities
  }
}
