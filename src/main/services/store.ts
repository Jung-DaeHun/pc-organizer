import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, normalize } from 'node:path'
import { app, safeStorage } from 'electron'
import { THEMES, type Settings, type Theme } from '@shared/types'
import { defaultRules, normalizeRules } from '@shared/rules'
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
    oldFileDays: 180,
    rules: defaultRules(),
    // 지금까지의 모습이 다크다. index.html 의 class="dark" 와 main/index.ts 의 창 배경색도 이 값을 전제한다
    theme: 'dark'
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

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string')

const isPositiveNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0

const isTheme = (v: unknown): v is Theme =>
  typeof v === 'string' && (THEMES as readonly string[]).includes(v)

/**
 * 어디서 왔든(파일, IPC patch) 설정을 이 함수 하나로 정규화한다.
 *
 * 모양이 틀린 값은 기본값으로 돌린다. 감시 폴더는 "어디를 옮길지"의 근거라서
 * 문자열 하나가 배열 자리에 들어오면 글자 단위로 스캔이 도는 식의 사고를 여기서 막는다.
 * 모르는 키는 버린다.
 */
function normalizeSettings(raw: unknown, defaults: Settings): Settings {
  const r = (raw ?? {}) as Record<string, unknown>
  // normalize: 'C:/Users/me' 처럼 슬래시가 섞인 경로도 스캐너·계획이 만드는 경로(백슬래시)와
  // 접두가 맞아야 한다. 안 맞으면 최상위 파일 전부가 '스캔 결과에 없음'으로 빠진다.
  const folders = isStringArray(r.watchedFolders)
    ? r.watchedFolders.map((f) => f.trim()).filter(Boolean).map((f) => normalize(f))
    : defaults.watchedFolders

  return {
    // 같은 폴더가 두 번 들어가면 스캔도 두 번 돈다. 대소문자만 다른 경로도 같은 폴더다.
    watchedFolders: uniqueFolders(folders),
    excludedDirNames: isStringArray(r.excludedDirNames)
      ? r.excludedDirNames
      : defaults.excludedDirNames,
    largeFileBytes: isPositiveNumber(r.largeFileBytes) ? r.largeFileBytes : defaults.largeFileBytes,
    oldFileDays: isPositiveNumber(r.oldFileDays) ? r.oldFileDays : defaults.oldFileDays,
    // 항상 카테고리마다 하나로 맞춘다. 빠진 카테고리는 defaults(갱신이면 현재 값)의 것
    rules: normalizeRules(r.rules, defaults.rules),
    theme: isTheme(r.theme) ? r.theme : defaults.theme
  }
}

/** 저장된 설정을 읽는다. 파일이 없거나 깨졌으면 기본값으로 시작한다. */
export async function getSettings(): Promise<Settings> {
  if (cache) return cache

  const defaults = defaultSettings()

  try {
    const raw = await readFile(settingsPath(), 'utf8')
    // 저장 파일에 없거나 모양이 틀린 항목은 기본값으로 채운다.
    // 나중에 설정 항목이 늘어도 예전 파일을 그대로 읽을 수 있다.
    cache = normalizeSettings(JSON.parse(raw), defaults)
  } catch {
    cache = defaults
  }

  return cache
}

/** 바뀐 항목만 덮어쓰고 파일에 저장한다. */
export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings()
  // patch 에 undefined 가 실려 오면 그대로 들어가므로, 병합 뒤 다시 정규화한다
  const next = normalizeSettings({ ...current, ...patch }, current)

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

// ---------------------------------------------------------------- 비밀 (API 키)

/**
 * API 키는 settings.json 과 분리해 userData/secrets.json 에 둔다.
 *
 * 값은 Electron safeStorage(윈도우에서는 DPAPI)로 암호화한 뒤 base64 로 적는다.
 * 암호화가 불가능한 환경이면 평문으로 떨어뜨리는 대신 저장을 거부한다.
 * 복호화된 키는 main 안에서만 쓰이고 IPC 응답에는 절대 실리지 않는다 —
 * renderer 는 set / has / clear 만 안다.
 */
interface Secrets {
  /** safeStorage 로 암호화한 뒤 base64 */
  anthropicApiKey?: string
}

function secretsPath(): string {
  return join(app.getPath('userData'), 'secrets.json')
}

async function readSecrets(): Promise<Secrets> {
  try {
    return JSON.parse(await readFile(secretsPath(), 'utf8')) as Secrets
  } catch {
    return {}
  }
}

async function writeSecrets(secrets: Secrets): Promise<void> {
  const file = secretsPath()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(secrets, null, 2), 'utf8')
}

/** 키를 암호화해 저장한다. 빈 값이거나 암호화가 안 되는 환경이면 예외 */
export async function setApiKey(key: string): Promise<void> {
  const trimmed = key.trim()
  if (!trimmed) throw new Error('API 키가 비어 있습니다')

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('이 환경에서는 키를 암호화할 수 없어 저장하지 않았습니다')
  }

  const encrypted = safeStorage.encryptString(trimmed).toString('base64')
  await writeSecrets({ ...(await readSecrets()), anthropicApiKey: encrypted })
}

export async function clearApiKey(): Promise<void> {
  const { anthropicApiKey: _removed, ...rest } = await readSecrets()
  await writeSecrets(rest)
}

/**
 * 복호화한 키. **main 전용** — IPC 핸들러가 클라이언트를 만들 때만 쓴다.
 * 없거나 (다른 사용자 계정 등으로) 복호화가 안 되면 null.
 */
export async function getApiKey(): Promise<string | null> {
  const { anthropicApiKey } = await readSecrets()
  if (!anthropicApiKey) return null

  try {
    return safeStorage.decryptString(Buffer.from(anthropicApiKey, 'base64'))
  } catch {
    return null
  }
}

/** 쓸 수 있는 키가 있는지만 알려준다. 키 자체는 돌려주지 않는다 */
export async function hasApiKey(): Promise<boolean> {
  return (await getApiKey()) !== null
}
