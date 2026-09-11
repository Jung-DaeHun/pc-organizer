import { join } from 'node:path'
import {
  CATEGORY_LABELS,
  FILE_CATEGORIES,
  type FileCategory,
  type OrganizePlan,
  type PlanItem,
  type ProposedFolder,
  type SkippedItem
} from '@shared/types'
import { pathKey } from '../lib/paths'
import { skippedItem, type TopLevelListing } from './topLevel'

/**
 * 확장자 규칙으로 계획을 세운다. 순수 함수 — I/O 없음.
 *
 * AI 추천이 안 될 때(키 없음, 오프라인)의 대비책이자 AI 추천의 출발점이다.
 * 파일은 카테고리 이름의 하위 폴더로, 폴더와 '기타'는 그대로 둔다.
 */

export interface PlanOptions {
  id: string
  now: number
}

/** 이 카테고리는 규칙으로 옮기지 않는다. 확장자만으로는 아무것도 알 수 없다 */
const UNROUTED: ReadonlySet<FileCategory> = new Set<FileCategory>(['other'])

export function buildRulePlan(
  root: string,
  listing: TopLevelListing,
  options: PlanOptions
): OrganizePlan {
  const existingDirs = new Set(
    listing.items.filter((i) => i.kind === 'dir').map((i) => pathKey(i.name))
  )
  // 같은 이름의 **파일**이 루트에 있으면 그 이름으로 폴더를 만들 수 없다 (mkdir 이 EEXIST 로 터진다)
  const fileNames = new Set(
    listing.items.filter((i) => i.kind === 'file').map((i) => pathKey(i.name))
  )

  // 1) 파일마다 갈 곳(카테고리 이름)을 정하고, 실제로 쓰이는 폴더 이름을 모은다
  const labelFor = new Map<string, string>()
  const blockedLabels = new Set<string>()
  for (const item of listing.items) {
    if (item.kind !== 'file' || UNROUTED.has(item.category)) continue
    const label = CATEGORY_LABELS[item.category]
    if (fileNames.has(pathKey(label))) {
      blockedLabels.add(label)
      continue
    }
    labelFor.set(item.id, label)
  }
  const usedLabels = new Set([...labelFor.values()].map(pathKey))

  // 2) 항목을 계획 줄로 바꾼다. 목적지로 쓰이는 폴더는 옮기지 않는다
  const items: PlanItem[] = []
  const skipped: SkippedItem[] = [...listing.skipped]

  for (const item of listing.items) {
    if (item.kind === 'dir') {
      if (usedLabels.has(pathKey(item.name))) {
        skipped.push(skippedItem(item.path, item.name, 'destination'))
        continue
      }
      items.push({
        item,
        toDir: null,
        reason: '폴더는 규칙으로 분류하지 않는다',
        origin: 'rule',
        approved: false
      })
      continue
    }

    const label = labelFor.get(item.id)
    if (!label) {
      const blocked = blockedLabels.has(CATEGORY_LABELS[item.category])
      items.push({
        item,
        toDir: null,
        reason: blocked
          ? `'${CATEGORY_LABELS[item.category]}' 라는 파일이 있어 같은 이름의 폴더를 만들 수 없다`
          : item.ext
            ? `규칙에 없는 확장자 ${item.ext}`
            : '확장자 없음',
        origin: 'rule',
        approved: false
      })
      continue
    }

    items.push({
      item,
      toDir: join(root, label),
      reason: `${item.ext} → ${label}`,
      origin: 'rule',
      approved: true
    })
  }

  // 3) 제안 폴더는 카테고리 순서대로. 이미 있는 폴더면 표시만 한다
  const folders: ProposedFolder[] = FILE_CATEGORIES.filter(
    (category) => usedLabels.has(pathKey(CATEGORY_LABELS[category]))
  ).map((category) => {
    const name = CATEGORY_LABELS[category]
    return {
      name,
      dir: join(root, name),
      description: '확장자 규칙',
      existing: existingDirs.has(pathKey(name))
    }
  })

  return {
    id: options.id,
    createdAt: options.now,
    root,
    folders,
    items,
    skipped
  }
}
