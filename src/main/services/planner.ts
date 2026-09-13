import {
  RULE_CATEGORIES,
  type CategoryRule,
  type OrganizePlan,
  type PlanItem,
  type ProposedFolder,
  type RuleCategory,
  type SkippedItem
} from '@shared/types'
import { folderKey } from '@shared/folderName'
import { defaultRules } from '@shared/rules'
import { skippedItem, type TopLevelListing } from './topLevel'

/**
 * 분류 규칙(Settings.rules)으로 계획을 세운다. 순수 함수 — I/O 없음.
 *
 * AI 추천이 안 될 때(키 없음, 오프라인)의 대비책이자 AI 추천의 출발점이다.
 * 파일은 규칙이 정한 폴더로, 폴더와 '기타'와 꺼 둔 카테고리는 그대로 둔다.
 * 목적지는 폴더 **이름**이다. 경로는 실행 단계에서 main 이 root 와 합쳐 만든다.
 */

export interface PlanOptions {
  id: string
  now: number
  /** 사용자 규칙. 없으면 기본 규칙 (테스트 편의) */
  rules?: readonly CategoryRule[]
}

export function buildRulePlan(
  root: string,
  listing: TopLevelListing,
  options: PlanOptions
): OrganizePlan {
  const ruleOf = new Map<RuleCategory, CategoryRule>(
    (options.rules ?? defaultRules()).map((rule) => [rule.category, rule])
  )
  // 두 카테고리가 대소문자만 다른 이름('Media'·'media')을 쓰면 한 폴더다. 앞선 카테고리의 표기로 통일한다 —
  // 판은 열을 이름으로 찾으므로 같은 폴더가 두 표기로 갈리면 카드가 열 밖으로 떨어진다
  const spelling = new Map<string, string>()
  for (const category of RULE_CATEGORIES) {
    const name = ruleOf.get(category)?.folderName
    if (name !== undefined && !spelling.has(folderKey(name))) spelling.set(folderKey(name), name)
  }
  /** 이 파일이 갈 폴더 이름. '기타'거나 꺼 둔 카테고리면 null */
  const destinationOf = (category: PlanItem['item']['category']): string | null => {
    if (category === 'other') return null
    const rule = ruleOf.get(category)
    return rule && rule.enabled ? (spelling.get(folderKey(rule.folderName)) ?? rule.folderName) : null
  }

  const existingDirs = new Set(
    listing.items.filter((i) => i.kind === 'dir').map((i) => folderKey(i.name))
  )
  // 같은 이름의 **파일**이 루트에 있으면 그 이름으로 폴더를 만들 수 없다 (mkdir 이 EEXIST 로 터진다)
  const fileNames = new Set(
    listing.items.filter((i) => i.kind === 'file').map((i) => folderKey(i.name))
  )

  // 1) 파일마다 갈 곳을 정하고, 실제로 쓰이는 폴더 이름을 모은다
  const labelFor = new Map<string, string>()
  const blockedLabels = new Set<string>()
  for (const item of listing.items) {
    if (item.kind !== 'file') continue
    const label = destinationOf(item.category)
    if (label === null) continue
    if (fileNames.has(folderKey(label))) {
      blockedLabels.add(label)
      continue
    }
    labelFor.set(item.id, label)
  }
  const usedLabels = new Set([...labelFor.values()].map(folderKey))

  // 2) 항목을 계획 줄로 바꾼다. 목적지로 쓰이는 폴더는 옮기지 않는다
  const items: PlanItem[] = []
  const skipped: SkippedItem[] = [...listing.skipped]

  for (const item of listing.items) {
    if (item.kind === 'dir') {
      if (usedLabels.has(folderKey(item.name))) {
        skipped.push(skippedItem(item.path, item.name, 'destination'))
        continue
      }
      items.push({ item, toFolder: null, reason: '폴더는 규칙으로 분류하지 않는다', origin: 'rule' })
      continue
    }

    const label = labelFor.get(item.id)
    if (!label) {
      const rule = item.category === 'other' ? undefined : ruleOf.get(item.category)
      const wanted = destinationOf(item.category)
      items.push({
        item,
        toFolder: null,
        reason:
          wanted !== null && blockedLabels.has(wanted)
            ? `'${wanted}' 라는 파일이 있어 같은 이름의 폴더를 만들 수 없다`
            : rule && !rule.enabled
              ? `'${rule.folderName}' 규칙이 꺼져 있다`
              : item.ext
                ? `규칙에 없는 확장자 ${item.ext}`
                : '확장자 없음',
        origin: 'rule'
      })
      continue
    }

    items.push({ item, toFolder: label, reason: `${item.ext} → ${label}`, origin: 'rule' })
  }

  // 3) 제안 폴더는 카테고리 순서대로, 같은 이름을 쓰는 카테고리는 폴더 하나로. 이미 있는 폴더면 표시만 한다
  const folders: ProposedFolder[] = [...spelling]
    .filter(([key]) => usedLabels.has(key))
    .map(([key, name]) => ({
      name,
      // 출처 배지가 '규칙' 이라고 이미 말한다. 설명까지 같은 말을 반복하지 않는다
      description: '',
      existing: existingDirs.has(key),
      origin: 'rule' as const
    }))

  return {
    id: options.id,
    createdAt: options.now,
    root,
    folders,
    items,
    skipped
  }
}
