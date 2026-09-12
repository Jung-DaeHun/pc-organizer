import { lstat, readdir } from 'node:fs/promises'
import { join, sep } from 'node:path'
import {
  SKIP_REASON_LABELS,
  type FileEntry,
  type OrganizeItem,
  type SkipReason,
  type SkippedItem
} from '@shared/types'
import { pathKey } from '../lib/paths'
import { categorize, extensionOf } from './categorize'

/**
 * 감시 폴더 **바로 아래** 항목만 정리 대상으로 뽑는다.
 *
 * 스캐너를 다시 돌리지 않는다. 루트 한 단계만 readdir 하고, 폴더의 용량·파일 수는
 * 마지막 스캔의 FileEntry 목록(scan.ts 의 lastEntries)을 경로 접두로 묶어 집계한다.
 * 이 파일은 조회만 한다.
 */

/** 정리 대상에서 항상 빼는 이름. 탐색기가 관리하는 파일이라 옮기면 폴더 표시가 깨진다 */
const SYSTEM_NAMES = new Set(['desktop.ini', 'thumbs.db'])

/**
 * 앱 바로가기(.lnk)는 그 자리에 있으라고 둔 것이다. 옮기면 의미가 없다.
 * 인터넷 바로가기(.url)는 뺀다 — 바탕화면에 쌓이는 정리 대상이고, 어디로 옮겨도 그대로 열린다.
 */
const SHORTCUT_EXTS = new Set(['.lnk'])

export interface TopLevelDirent {
  name: string
  kind: 'file' | 'dir' | 'link' | 'other'
  mtimeMs: number
}

/** 루트 한 단계를 읽는 함수. 테스트에서는 가짜를 넣는다 */
export type ReadTopLevel = (root: string) => Promise<TopLevelDirent[]>

export interface TopLevelListing {
  items: OrganizeItem[]
  skipped: SkippedItem[]
}

export interface TopLevelOptions {
  /** 스캐너가 내려가지 않은 폴더 이름(소문자 비교). 용량을 모르니 계획에서도 뺀다 */
  excludedDirNames?: readonly string[]
}

export function skippedItem(path: string, name: string, reason: SkipReason): SkippedItem {
  return { path, name, reason, why: SKIP_REASON_LABELS[reason] }
}

/** 실제 파일시스템으로 루트 한 단계를 읽는다. 링크는 따라가지 않도록 lstat 을 쓴다 */
export const readTopLevelFs: ReadTopLevel = async (root) => {
  const dirents = await readdir(root, { withFileTypes: true })
  const result: TopLevelDirent[] = []

  for (const dirent of dirents) {
    if (dirent.isSymbolicLink()) {
      result.push({ name: dirent.name, kind: 'link', mtimeMs: 0 })
      continue
    }

    let mtimeMs = 0
    try {
      mtimeMs = (await lstat(join(root, dirent.name))).mtimeMs
    } catch {
      // 시각을 못 읽어도 항목 자체는 보여준다
    }

    const kind = dirent.isDirectory() ? 'dir' : dirent.isFile() ? 'file' : 'other'
    result.push({ name: dirent.name, kind, mtimeMs })
  }

  return result
}

interface Bucket {
  /** 루트 바로 아래의 파일이면 그 항목 */
  direct?: FileEntry
  size: number
  fileCount: number
  /** 아래에 클라우드 전용 파일이 몇 개 있는지. 하나라도 있으면 폴더째로 옮기지 않는다 */
  cloudOnlyCount: number
}

/** 스캔 목록을 '루트 바로 아래 이름' 기준으로 묶는다. 키는 pathKey 로 접은 이름 */
function indexEntries(root: string, entries: readonly FileEntry[]): Map<string, Bucket> {
  const base = pathKey(root.endsWith(sep) ? root : root + sep)
  const map = new Map<string, Bucket>()

  for (const entry of entries) {
    const key = pathKey(entry.path)
    if (!key.startsWith(base)) continue

    const rest = key.slice(base.length)
    const cut = rest.search(/[\\/]/)

    if (cut === -1) {
      map.set(rest, {
        direct: entry,
        size: entry.size,
        fileCount: 1,
        cloudOnlyCount: entry.isCloudOnly ? 1 : 0
      })
      continue
    }

    const dirName = rest.slice(0, cut)
    const bucket = map.get(dirName) ?? { size: 0, fileCount: 0, cloudOnlyCount: 0 }
    bucket.size += entry.size
    bucket.fileCount += 1
    if (entry.isCloudOnly) bucket.cloudOnlyCount += 1
    map.set(dirName, bucket)
  }

  return map
}

/**
 * 루트 바로 아래 항목을 정리 대상과 제외 목록으로 나눈다.
 *
 * 항목 id 는 목록 안의 순번이다. 계획은 main 이 들고 있으므로(plan.ts 의 lastPlan)
 * renderer 와 AI 응답은 이 id 로만 항목을 가리킨다.
 */
export async function listTopLevel(
  root: string,
  entries: readonly FileEntry[],
  readTopLevel: ReadTopLevel,
  options: TopLevelOptions = {}
): Promise<TopLevelListing> {
  const dirents = await readTopLevel(root)
  const buckets = indexEntries(root, entries)
  const excluded = new Set((options.excludedDirNames ?? []).map((n) => n.toLowerCase()))

  const items: OrganizeItem[] = []
  const skipped: SkippedItem[] = []

  // 폴더 먼저, 그다음 나머지. 같은 무리 안에서는 이름순
  const rank = (d: TopLevelDirent): number => (d.kind === 'dir' ? 0 : 1)
  const sorted = [...dirents].sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'ko')
  )

  for (const dirent of sorted) {
    const path = join(root, dirent.name)
    const skip = (reason: SkipReason): void => {
      skipped.push(skippedItem(path, dirent.name, reason))
    }

    if (dirent.kind === 'link') {
      skip('link')
      continue
    }
    if (dirent.kind === 'other') {
      skip('not-file-or-dir')
      continue
    }
    if (SYSTEM_NAMES.has(dirent.name.toLowerCase())) {
      skip('system')
      continue
    }

    const bucket = buckets.get(pathKey(dirent.name))

    if (dirent.kind === 'dir') {
      if (excluded.has(dirent.name.toLowerCase())) {
        // node_modules 같은 폴더는 스캐너가 안 들어가서 0 B 로 보인다. 모르는 용량을 보여주느니 뺀다
        skip('excluded-dir')
        continue
      }
      if (bucket && bucket.cloudOnlyCount > 0) {
        // 파일 하나도 안 옮기는 정책을 폴더에도 그대로 적용한다
        skip('has-cloud-only')
        continue
      }
      items.push({
        id: String(items.length),
        path,
        name: dirent.name,
        kind: 'dir',
        ext: '',
        size: bucket?.size ?? 0,
        mtimeMs: dirent.mtimeMs,
        category: 'other',
        fileCount: bucket?.fileCount ?? 0
      })
      continue
    }

    const ext = extensionOf(dirent.name)
    if (SHORTCUT_EXTS.has(ext)) {
      skip('shortcut')
      continue
    }

    const entry = bucket?.direct
    if (!entry) {
      skip('not-in-scan')
      continue
    }
    if (entry.isCloudOnly) {
      // 같은 OneDrive 루트 안의 이동은 내려받기를 유발하지 않을 것으로 보이지만,
      // 확신이 설 때까지는 건드리지 않는다.
      skip('cloud-only')
      continue
    }

    items.push({
      id: String(items.length),
      path,
      name: dirent.name,
      kind: 'file',
      ext,
      size: entry.size,
      mtimeMs: entry.mtimeMs,
      category: categorize(ext)
    })
  }

  return { items, skipped }
}
