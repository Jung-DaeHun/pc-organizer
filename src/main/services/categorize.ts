import type { CategoryRule, FileCategory } from '@shared/types'
import { defaultRules } from '@shared/rules'

/**
 * 확장자 → 카테고리.
 *
 * 표는 사용자가 설정 화면에서 고치는 분류 규칙(Settings.rules)이고 기본값은 shared/rules.ts 에 있다.
 * 스캔(scanner.ts)과 정리 계획(topLevel.ts)이 같은 규칙으로 만든 함수를 주입받아, 집계에서 '이미지'로
 * 센 파일이 계획에서도 '이미지' 폴더로 간다.
 */
export type Categorizer = (ext: string) => FileCategory

/**
 * 규칙 목록으로 조회 함수를 만든다. 역인덱스('pdf' → 'document')는 한 번만 만든다 — 스캔은 파일마다 부른다.
 * 같은 확장자가 두 규칙에 있으면 앞선 규칙이 가진다 (normalizeRules 가 겹침을 이미 걷어내지만 여기서도 같은 답)
 */
export function createCategorizer(rules: readonly CategoryRule[]): Categorizer {
  const byExtension = new Map<string, FileCategory>()
  for (const rule of rules) {
    for (const ext of rule.extensions) {
      if (!byExtension.has(ext)) byExtension.set(ext, rule.category)
    }
  }

  return (ext) => {
    // 점이 있든 없든, 대소문자 상관없이 받는다 ('.PDF', 'pdf' 모두 가능)
    const normalized = ext.replace(/^\./, '').toLowerCase()
    if (!normalized) return 'other'
    return byExtension.get(normalized) ?? 'other'
  }
}

/** 기본 규칙으로 만든 조회 함수. 규칙을 넘기지 않은 호출(테스트)의 기본값 */
export const categorize: Categorizer = createCategorizer(defaultRules())

/** 파일 이름에서 확장자를 뽑는다. 없으면 빈 문자열. 'archive.tar.gz' -> '.gz' */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  // 맨 앞의 점은 확장자가 아니라 숨김 파일 표시다 ('.gitignore')
  if (dot <= 0 || dot === fileName.length - 1) return ''
  return fileName.slice(dot).toLowerCase()
}
