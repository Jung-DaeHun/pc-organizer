import { FILE_CATEGORIES, type CategoryBreakdown, type FileEntry, type FolderSummary } from '@shared/types'
import type { FolderScan } from './scanner'

/**
 * 카테고리별 개수와 용량을 센다.
 * 항목이 하나도 없는 카테고리는 빼서, 차트가 빈 조각으로 지저분해지지 않게 한다.
 */
export function breakdownByCategory(entries: FileEntry[]): CategoryBreakdown[] {
  const counts = new Map(FILE_CATEGORIES.map((c) => [c, { count: 0, bytes: 0 }]))

  for (const entry of entries) {
    const bucket = counts.get(entry.category)
    if (!bucket) continue
    bucket.count += 1
    bucket.bytes += entry.size
  }

  return [...counts.entries()]
    .filter(([, v]) => v.count > 0)
    .map(([category, v]) => ({ category, count: v.count, bytes: v.bytes }))
    .sort((a, b) => b.bytes - a.bytes)
}

export function summarizeFolder(scan: FolderScan): FolderSummary {
  return {
    path: scan.path,
    fileCount: scan.entries.length,
    totalBytes: scan.entries.reduce((sum, e) => sum + e.size, 0),
    skippedCount: scan.skippedCount,
    byCategory: breakdownByCategory(scan.entries)
  }
}
