import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { Settings } from '@shared/types'
import { pathKey } from '../lib/paths'

const MB = 1024 * 1024

/**
 * 스캔에서 통째로 건너뛸 디렉터리 이름.
 *
 * 프로그램이 관리하는 폴더라 '정리 대상'이 아니고, 항목 수만 수십만 개로 불어나
 * 스캔 시간을 통째로 잡아먹는다.
 */
const DEFAULT_EXCLUDED_DIR_NAMES = [
  'node_modules',
  '.git',
  '.svn',
  '.venv',
  'venv',
  '__pycache__',
  '.cache',
  'appdata',
  '$recycle.bin',
  'system volume information',
  'windows',
  'program files',
  'program files (x86)',
  'programdata'
]

export function defaultSettings(): Settings {
  return {
    // OneDrive를 쓰는 환경이면 getPath('desktop')이 OneDrive 아래 경로를 돌려준다.
    // 사용자가 실제로 보는 바탕화면과 일치하므로 그대로 쓴다.
    watchedFolders: [app.getPath('downloads'), app.getPath('desktop')],
    excludedDirNames: DEFAULT_EXCLUDED_DIR_NAMES,
    largeFileBytes: 100 * MB,
    oldFileDays: 180
  }
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/** 같은 폴더를 가리키는 경로를 하나로 줄인다. 먼저 나온 표기를 남긴다. */
function uniqueFolders(folders: string[]): string[] {
  const seen = new Set<string>()
  return folders.filter((folder) => {
    const key = pathKey(folder)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

let cache: Settings | null = null

/** 저장된 설정을 읽는다. 파일이 없거나 깨졌으면 기본값으로 시작한다. */
export async function getSettings(): Promise<Settings> {
  if (cache) return cache

  const defaults = defaultSettings()

  try {
    const raw = await readFile(settingsPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<Settings>

    // 저장 파일에 없는 항목은 기본값으로 채운다.
    // 나중에 설정 항목이 늘어도 예전 파일을 그대로 읽을 수 있다.
    cache = {
      watchedFolders: parsed.watchedFolders ?? defaults.watchedFolders,
      excludedDirNames: parsed.excludedDirNames ?? defaults.excludedDirNames,
      largeFileBytes: parsed.largeFileBytes ?? defaults.largeFileBytes,
      oldFileDays: parsed.oldFileDays ?? defaults.oldFileDays
    }
  } catch {
    cache = defaults
  }

  return cache
}

/** 바뀐 항목만 덮어쓰고 파일에 저장한다. */
export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings()
  const next: Settings = { ...current, ...patch }

  // 같은 폴더가 두 번 들어가면 스캔도 두 번 돈다. 대소문자만 다른 경로도 같은 폴더다.
  next.watchedFolders = uniqueFolders(next.watchedFolders)

  cache = next

  try {
    const file = settingsPath()
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(next, null, 2), 'utf8')
  } catch (err) {
    // 저장에 실패해도 이번 실행 동안은 메모리 값으로 계속 쓴다
    console.error('[store] 설정 저장 실패:', err instanceof Error ? err.message : err)
  }

  return next
}
