import {
  CATEGORY_LABELS,
  RULE_CATEGORIES,
  type CategoryRule,
  type RuleCategory
} from './types'
import { FORBIDDEN_CHARS, hasControlChar, sanitizeFolderName } from './folderName'

/**
 * 분류 규칙의 기본값과 정규화. main(store.ts 가 파일·IPC 로 들어온 값을 검증)과 renderer(설정 화면의
 * '기본값으로 되돌리기'·입력 검사)가 같은 표와 같은 검사를 써야 화면에서 통과한 값이 저장에서 바뀌지 않는다.
 * Node 의존성 없음.
 */

/**
 * 카테고리별 기본 확장자.
 *
 * 사람이 읽고 고치기 쉬우라고 이 방향으로 적어두고, 조회용 역인덱스는 categorize.ts 가 만든다.
 */
export const DEFAULT_EXTENSIONS_BY_CATEGORY: Record<RuleCategory, readonly string[]> = {
  document: [
    'pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'md',
    'xls', 'xlsx', 'xlsm', 'csv', 'tsv', 'ods',
    'ppt', 'pptx', 'odp', 'epub', 'djvu',
    // 한글과컴퓨터 오피스: 한글 / 한셀 / 한쇼
    'hwp', 'hwpx', 'hml', 'cell', 'show'
  ],
  image: [
    'jpg', 'jpeg', 'jfif', 'png', 'gif', 'bmp', 'webp', 'avif', 'svg', 'ico',
    'heic', 'heif', 'tif', 'tiff', 'psd', 'ai', 'raw', 'cr2', 'nef', 'arw', 'dng'
  ],
  // 'ts'(MPEG 전송 스트림)는 넣지 않는다 — 한 확장자는 한 카테고리에만 있고, 'ts' 는 코드(TypeScript)가 가진다.
  // tests/rules.test.ts 가 겹침이 없음을 못 박는다
  video: [
    'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v',
    'mpg', 'mpeg', 'mts', 'm2ts', 'vob'
  ],
  audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus', 'aiff', 'mid'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'alz', 'egg', 'iso', 'cab', 'tgz'],
  installer: ['exe', 'msi', 'msix', 'appx', 'appxbundle', 'msu', 'apk', 'dmg'],
  code: [
    'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'ipynb', 'java', 'kt',
    'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'go', 'rs', 'rb', 'php', 'swift',
    'html', 'htm', 'css', 'scss', 'json', 'xml', 'yml', 'yaml', 'toml',
    'sh', 'bat', 'cmd', 'ps1', 'sql', 'r', 'lua', 'vue', 'svelte'
  ]
}

/** 새 배열을 돌려준다 — 호출한 쪽이 고쳐도 기본값은 그대로다 */
export function defaultRule(category: RuleCategory): CategoryRule {
  return {
    category,
    folderName: CATEGORY_LABELS[category],
    extensions: [...DEFAULT_EXTENSIONS_BY_CATEGORY[category]],
    enabled: true
  }
}

export function defaultRules(): CategoryRule[] {
  return RULE_CATEGORIES.map(defaultRule)
}

export const MAX_EXTENSION_LENGTH = 20

/**
 * 사용자가 친 확장자를 규칙에 적는 모양('pdf' — 소문자, 점 없음)으로 다듬는다. 못 쓰면 null.
 *
 * 앞의 점은 떼되('.pdf' → 'pdf') 안의 점은 거부한다 — extensionOf 가 마지막 점 뒤만 보므로 'tar.gz' 는
 * 어떤 파일과도 맞지 않는 죽은 규칙이 된다. 금지 문자·제어 문자는 확장자도 파일 이름의 일부라 폴더 이름과
 * 같은 검사(folderName.ts)를 쓴다.
 */
export function normalizeExtension(raw: string): string | null {
  const ext = raw.trim().replace(/^\.+/, '').toLowerCase()
  if (!ext || ext.length > MAX_EXTENSION_LENGTH) return null
  if (ext.includes('.') || /\s/.test(ext) || FORBIDDEN_CHARS.test(ext)) return null
  if (hasControlChar(ext)) return null
  return ext
}

const isRuleCategory = (v: unknown): v is RuleCategory =>
  typeof v === 'string' && (RULE_CATEGORIES as readonly string[]).includes(v)

/**
 * 어디서 왔든(설정 파일, IPC patch) 규칙 목록을 이 함수 하나로 정규화한다.
 *
 * 결과는 **항상 카테고리마다 하나, RULE_CATEGORIES 순서**다. 모양이 틀리거나 빠진 카테고리는 fallback
 * (없으면 기본값)의 것을 쓴다. 폴더 이름은 sanitizeFolderName 을 거치고 못 쓰면 fallback 의 이름으로,
 * 확장자는 normalizeExtension 을 거치고 못 쓰면 버린다. 같은 확장자가 두 카테고리에 있으면 앞선
 * 카테고리가 가진다 — 스캔이 파일마다 카테고리 하나를 정해야 하므로 겹침을 남겨 두지 않는다.
 * 모르는 카테고리·모르는 키는 버린다.
 */
export function normalizeRules(
  raw: unknown,
  fallback: readonly CategoryRule[] = defaultRules()
): CategoryRule[] {
  const given = new Map<RuleCategory, Record<string, unknown>>()
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) continue
      const r = entry as Record<string, unknown>
      // 같은 카테고리가 두 번 있으면 먼저 나온 것
      if (isRuleCategory(r.category) && !given.has(r.category)) given.set(r.category, r)
    }
  }

  const fallbackFor = (category: RuleCategory): CategoryRule =>
    fallback.find((r) => r.category === category) ?? defaultRule(category)

  const taken = new Set<string>()
  return RULE_CATEGORIES.map((category) => {
    const base = fallbackFor(category)
    const r = given.get(category)

    const rawExts = r && Array.isArray(r.extensions) ? r.extensions : base.extensions
    const extensions: string[] = []
    for (const item of rawExts) {
      if (typeof item !== 'string') continue
      const ext = normalizeExtension(item)
      if (ext === null || taken.has(ext)) continue
      taken.add(ext)
      extensions.push(ext)
    }

    const folderName =
      (r && typeof r.folderName === 'string' ? sanitizeFolderName(r.folderName) : null) ??
      sanitizeFolderName(base.folderName) ??
      CATEGORY_LABELS[category]

    return {
      category,
      folderName,
      extensions,
      enabled: r && typeof r.enabled === 'boolean' ? r.enabled : base.enabled
    }
  })
}

/** 두 규칙 목록이 같은가. 설정 화면이 '저장할 게 있는지' 볼 때 쓴다 */
export function rulesEqual(a: readonly CategoryRule[], b: readonly CategoryRule[]): boolean {
  if (a.length !== b.length) return false
  return a.every((ra, i) => {
    const rb = b[i]
    return (
      rb !== undefined &&
      ra.category === rb.category &&
      ra.folderName === rb.folderName &&
      ra.enabled === rb.enabled &&
      ra.extensions.length === rb.extensions.length &&
      ra.extensions.every((ext, j) => ext === rb.extensions[j])
    )
  })
}
