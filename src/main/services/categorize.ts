import type { FileCategory } from '@shared/types'

/**
 * 카테고리별 확장자 목록.
 *
 * 사람이 읽고 고치기 쉬우라고 이 방향으로 적어두고, 실제 조회용 역인덱스는 아래에서 만든다.
 * 2단계의 이동 규칙 엔진도 이 표를 그대로 재사용한다.
 */
const EXTENSIONS_BY_CATEGORY: Record<Exclude<FileCategory, 'other'>, string[]> = {
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
  video: [
    'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v',
    'mpg', 'mpeg', 'ts', 'mts', 'm2ts', 'vob'
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

/** '.pdf' -> 'document' 로 바로 찾기 위한 역인덱스 (모듈 로드 시 한 번만 만든다) */
const CATEGORY_BY_EXTENSION: ReadonlyMap<string, FileCategory> = new Map(
  Object.entries(EXTENSIONS_BY_CATEGORY).flatMap(([category, exts]) =>
    exts.map((ext) => [ext, category as FileCategory] as const)
  )
)

/**
 * 확장자로 카테고리를 정한다.
 *
 * @param ext 점이 있든 없든, 대소문자 상관없이 받는다 ('.PDF', 'pdf' 모두 가능)
 */
export function categorize(ext: string): FileCategory {
  const normalized = ext.replace(/^\./, '').toLowerCase()
  if (!normalized) return 'other'
  return CATEGORY_BY_EXTENSION.get(normalized) ?? 'other'
}

/** 파일 이름에서 확장자를 뽑는다. 없으면 빈 문자열. 'archive.tar.gz' -> '.gz' */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  // 맨 앞의 점은 확장자가 아니라 숨김 파일 표시다 ('.gitignore')
  if (dot <= 0 || dot === fileName.length - 1) return ''
  return fileName.slice(dot).toLowerCase()
}
