import type { FileEntry, Opportunities, ScanProgress, ScanResult } from '@shared/types'
import { hashHead } from '../lib/hash'
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
 * 개별 파일이 필요한 기능(2단계의 이동 계획 세우기)은 main에서 이 값을 쓴다.
 */
let lastEntries: FileEntry[] = []

export function getLastEntries(): readonly FileEntry[] {
  return lastEntries
}

/** 등록된 폴더를 전부 훑고 대시보드가 필요로 하는 수치를 만든다. */
export async function runScan(onProgress?: (progress: ScanProgress) => void): Promise<ScanResult> {
  const startedAt = Date.now()
  const settings = await getSettings()

  const scans = await scanFolders(settings.watchedFolders, {
    excludedDirNames: settings.excludedDirNames,
    onProgress
  })

  // 감시 폴더가 겹치면 같은 파일이 두 폴더에서 잡힌다. 집계와 중복 검사는 한 번씩만 센다.
  const entries = mergeEntries(scans)
  lastEntries = entries

  // 중복 후보 해시와 임시 폴더 계산은 서로 무관하니 같이 돌린다
  const [duplicates, temp] = await Promise.all([
    findDuplicates(entries, hashHead),
    measureTempAndTrash()
  ])

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
