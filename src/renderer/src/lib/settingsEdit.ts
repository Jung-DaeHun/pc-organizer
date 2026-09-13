import type { CategoryRule, RuleCategory } from '@shared/types'
import { CATEGORY_LABELS } from '@shared/types'
import { MAX_FOLDER_NAME_LENGTH, sanitizeFolderName } from '@shared/folderName'
import { MAX_EXTENSION_LENGTH, normalizeExtension, rulesEqual } from '@shared/rules'

/**
 * 설정 화면이 규칙 초안(화면 사본)을 고칠 때 쓰는 순수 함수들.
 *
 * 전부 `CategoryRule[] → CategoryRule[]` 이고 입력을 바꾸지 않는다. 저장은 사용자가 '저장'을 누른 뒤
 * `window.api.updateSettings` 로 가고, main 의 normalizeRules 가 같은 검사를 한 번 더 한다 — 여기서는
 * 그 검사에 걸릴 값을 미리 막아 "화면에서는 통과했는데 저장하니 딴 값" 이 되지 않게 한다.
 * 컴포넌트 테스트가 없는 프로젝트라, 화면의 규칙은 여기에 모아 Vitest 로 검증한다.
 */

function update(
  rules: readonly CategoryRule[],
  category: RuleCategory,
  patch: (rule: CategoryRule) => CategoryRule
): CategoryRule[] {
  return rules.map((rule) => (rule.category === category ? patch(rule) : rule))
}

export function setFolderName(
  rules: readonly CategoryRule[],
  category: RuleCategory,
  folderName: string
): CategoryRule[] {
  return update(rules, category, (rule) => ({ ...rule, folderName }))
}

export function setEnabled(
  rules: readonly CategoryRule[],
  category: RuleCategory,
  enabled: boolean
): CategoryRule[] {
  return update(rules, category, (rule) => ({ ...rule, enabled }))
}

export interface AddExtensionResult {
  rules: CategoryRule[]
  /** 못 넣은 이유. null 이면 넣었다 (이미 있었으면 그대로) */
  error: string | null
  /** 다른 카테고리에 있던 확장자를 옮겨 왔으면 어디서 왔는지. 화면이 한 줄 알린다 */
  movedFrom: RuleCategory | null
}

/**
 * 확장자를 카테고리에 넣는다. 한 확장자는 한 카테고리에만 있으므로 다른 카테고리에 있던 것은 거기서 뺀다 —
 * 사용자가 'svg 는 코드'라고 정한 것이지 '이미지에서 빼고' 를 따로 시키게 하지 않는다
 */
export function addExtension(
  rules: readonly CategoryRule[],
  category: RuleCategory,
  raw: string
): AddExtensionResult {
  const ext = normalizeExtension(raw)
  if (ext === null) {
    return {
      rules: [...rules],
      error: `확장자로 쓸 수 없습니다 (영문·숫자 등 ${MAX_EXTENSION_LENGTH}자 이내, 점·공백·\\ / : * ? " < > | 없이)`,
      movedFrom: null
    }
  }

  const owner = rules.find((rule) => rule.extensions.includes(ext))
  if (owner?.category === category) return { rules: [...rules], error: null, movedFrom: null }

  const next = rules.map((rule) => {
    if (rule.category === category) return { ...rule, extensions: [...rule.extensions, ext] }
    if (rule.category === owner?.category) {
      return { ...rule, extensions: rule.extensions.filter((e) => e !== ext) }
    }
    return rule
  })
  return { rules: next, error: null, movedFrom: owner?.category ?? null }
}

export function removeExtension(
  rules: readonly CategoryRule[],
  category: RuleCategory,
  ext: string
): CategoryRule[] {
  return update(rules, category, (rule) => ({
    ...rule,
    extensions: rule.extensions.filter((e) => e !== ext)
  }))
}

/** 폴더 이름이 저장에서 거부될 이유. null 이면 쓸 수 있다 */
export function folderNameProblem(name: string): string | null {
  if (!name.trim()) return '폴더 이름을 입력하세요'
  if (sanitizeFolderName(name) === null) {
    return `폴더 이름으로 쓸 수 없습니다 (\\ / : * ? " < > | 금지, 앞뒤 점·공백 금지, ${MAX_FOLDER_NAME_LENGTH}자 이내)`
  }
  return null
}

/** 카테고리마다 폴더 이름 문제. 비어 있으면 저장할 수 있다 */
export function ruleProblems(rules: readonly CategoryRule[]): Partial<Record<RuleCategory, string>> {
  const problems: Partial<Record<RuleCategory, string>> = {}
  for (const rule of rules) {
    const problem = folderNameProblem(rule.folderName)
    if (problem) problems[rule.category] = problem
  }
  return problems
}

/** 저장 버튼이 눌릴 조건 — 고친 게 있고, 문제가 없다 */
export function canSaveRules(draft: readonly CategoryRule[], saved: readonly CategoryRule[]): boolean {
  return !rulesEqual(draft, saved) && Object.keys(ruleProblems(draft)).length === 0
}

/**
 * 저장할 모양으로 다듬는다 — 폴더 이름의 앞뒤 공백을 떼는 정도. main 의 normalizeRules 가 같은 일을
 * 하지만, 여기서 미리 해 두면 돌아온 설정이 화면의 초안과 같아 '저장했는데 아직 고친 게 있음' 으로 보이지 않는다
 */
export function toSaveable(rules: readonly CategoryRule[]): CategoryRule[] {
  return rules.map((rule) => ({
    ...rule,
    folderName: sanitizeFolderName(rule.folderName) ?? CATEGORY_LABELS[rule.category],
    extensions: [...rule.extensions]
  }))
}

// ---------------------------------------------------------------- 판정 기준

/** 입력란의 문자열을 양의 정수로. 아니면 null */
export function parsePositiveInteger(raw: string): number | null {
  if (!/^\s*\d+\s*$/.test(raw)) return null
  const n = Number(raw)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}
