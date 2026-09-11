import { lstat, opendir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Stats } from 'node:fs'
import type { FileEntry, ScanProgress } from '@shared/types'
import { pathKey } from '../lib/paths'
import { categorize, extensionOf } from './categorize'

/** 파일 몇 개마다 진행률을 흘려보낼지. 너무 잦으면 IPC가 오히려 스캔을 느리게 만든다. */
const PROGRESS_INTERVAL = 250

/**
 * 클라우드 전용 파일 판정의 최소 크기.
 *
 * NTFS는 아주 작은 파일을 MFT 안에 그대로 넣어버리는데(resident file),
 * 이 경우에도 할당 크기가 0으로 잡혀 클라우드 전용과 구분되지 않는다.
 * 1KB 이하는 어차피 해시 비용이 없으니 판정 대상에서 빼는 편이 안전하다.
 */
const CLOUD_ONLY_MIN_SIZE = 1024

export interface ScanOptions {
  /** 이 이름의 디렉터리는 통째로 건너뛴다 (소문자로 비교) */
  excludedDirNames?: string[]
  onProgress?: (progress: ScanProgress) => void
}

export interface FolderScan {
  path: string
  entries: FileEntry[]
  /** 권한 부족 등으로 읽지 못하고 넘어간 항목 수 */
  skippedCount: number
}

/**
 * OneDrive 등에서 클라우드에만 있고 로컬에는 실체가 없는 파일인지 본다.
 *
 * 이런 파일은 크기는 제대로 보이지만 실제로 할당된 블록이 없다.
 * 내용을 읽는 순간 자동으로 내려받기 시작하므로 해시 계산에서 반드시 제외해야 한다.
 * (메타데이터만 읽는 건 다운로드를 유발하지 않는다)
 */
export function isCloudOnly(stats: Pick<Stats, 'size' | 'blocks'>): boolean {
  return stats.size > CLOUD_ONLY_MIN_SIZE && Number(stats.blocks) === 0
}

/** 여러 폴더를 차례로 훑는다. 진행률 카운터는 폴더를 건너서도 이어진다. */
export async function scanFolders(roots: string[], options: ScanOptions = {}): Promise<FolderScan[]> {
  const counter = { filesSeen: 0 }
  const results: FolderScan[] = []

  for (const root of roots) {
    results.push(await scanFolder(root, options, counter))
  }

  return results
}

/**
 * 여러 폴더의 스캔 결과를 한 목록으로 합친다. 같은 파일은 한 번만 넣는다.
 *
 * 감시 폴더가 서로 포함 관계이면(바탕화면 + 바탕화면\프로젝트) 하위 트리의 파일이
 * 두 폴더에서 각각 잡힌다. 그대로 이어 붙이면 전체 파일 수와 용량이 그만큼 부풀고,
 * 크기도 해시도 같은 자기 자신과 '중복 후보'로 묶여 지울 수 있는 양이 거짓이 된다.
 *
 * 폴더를 등록할 때 포함 관계를 막는 대신 여기서 거르는 이유: 루트 A와, A의 제외 폴더
 * 아래에 있는 B처럼 포함 관계이면서도 실제로는 겹치지 않는 조합이 있다.
 * 폴더별 요약은 각 폴더의 실제 내용을 보여줘야 하므로 FolderScan은 그대로 두고
 * 전체 집계에 쓰는 목록만 여기서 합친다.
 */
export function mergeEntries(scans: FolderScan[]): FileEntry[] {
  const seen = new Set<string>()
  const merged: FileEntry[] = []

  for (const scan of scans) {
    for (const entry of scan.entries) {
      const key = pathKey(entry.path)
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(entry)
    }
  }

  return merged
}

/**
 * 폴더 하나를 재귀적으로 훑는다.
 *
 * 재귀 호출 대신 명시적 스택을 쓴다. 폴더가 아주 깊어도 콜 스택이 넘치지 않고,
 * 중간에 취소를 붙이기도 쉽다.
 */
export async function scanFolder(
  root: string,
  options: ScanOptions = {},
  counter = { filesSeen: 0 }
): Promise<FolderScan> {
  const excluded = new Set((options.excludedDirNames ?? []).map((name) => name.toLowerCase()))
  const entries: FileEntry[] = []
  let skippedCount = 0

  const stack: string[] = [root]

  while (stack.length > 0) {
    const dir = stack.pop() as string

    try {
      const handle = await opendir(dir)

      for await (const dirent of handle) {
        const fullPath = join(dir, dirent.name)

        // 심볼릭 링크와 정션은 따라가지 않는다.
        // 따라갔다가 자기 자신을 가리키는 링크를 만나면 무한 루프에 빠진다.
        if (dirent.isSymbolicLink()) {
          skippedCount += 1
          continue
        }

        if (dirent.isDirectory()) {
          if (!excluded.has(dirent.name.toLowerCase())) stack.push(fullPath)
          continue
        }

        if (!dirent.isFile()) continue

        try {
          const stats = await lstat(fullPath)
          const ext = extensionOf(dirent.name)

          entries.push({
            path: fullPath,
            name: dirent.name,
            ext,
            size: stats.size,
            mtimeMs: stats.mtimeMs,
            atimeMs: stats.atimeMs,
            category: categorize(ext),
            isCloudOnly: isCloudOnly(stats)
          })

          counter.filesSeen += 1
          if (counter.filesSeen % PROGRESS_INTERVAL === 0) {
            options.onProgress?.({ filesSeen: counter.filesSeen, currentDir: dir })
          }
        } catch {
          // 파일이 스캔 도중 사라졌거나 접근 권한이 없다. 세고 넘어간다.
          skippedCount += 1
        }
      }
    } catch {
      // 디렉터리 자체를 열지 못한 경우. 시스템 폴더에서 흔하다.
      skippedCount += 1
    }
  }

  // 마지막 상태를 한 번 더 알려 진행률이 어중간하게 멈춘 것처럼 보이지 않게 한다
  options.onProgress?.({ filesSeen: counter.filesSeen, currentDir: root })

  return { path: root, entries, skippedCount }
}
