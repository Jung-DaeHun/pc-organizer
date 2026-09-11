import { basename } from 'node:path'
import { z } from 'zod'
import type {
  AdvisorItem,
  AdvisorPreview,
  AdvisorRequest,
  OrganizeItem,
  OrganizePlan,
  PlanItem,
  ProposedFolder,
  SkippedItem
} from '@shared/types'
import { folderKey, sanitizeFolderName } from '@shared/folderName'
import type { StructuredCall } from '../lib/structured'
import { skippedItem } from './topLevel'

/**
 * AI 추천.
 *
 * 여기서 하는 일은 셋이다 — (1) 보낼 내용을 **허용된 필드만으로** 조립하고,
 * (2) 돌아온 답을 의심하며 검증하고, (3) 검증된 답을 계획에 얹는다.
 * 네트워크는 StructuredCall 로 주입받는다. 이 파일은 SDK 를 모른다.
 *
 * 삭제는 AI 가 제안할 수 없다. 응답 스키마에 그런 필드가 없다.
 */

/** 한 요청에 담는 항목 수. 넘으면 순차 청크로 나눈다 */
export const CHUNK_SIZE = 300

/** 응답 토큰 상한. 300 항목 × (id + 폴더 + 이유) 에 넉넉하다 */
export const MAX_OUTPUT_TOKENS = 16_000

/**
 * 한 번의 추천에서 새로 만들 수 있는 폴더 수. 프롬프트는 8개 이하를 권하지만 그건 부탁이고,
 * 이건 강제다 — 넘는 폴더와 그 배정은 버린다. 실행 단계에서 폴더가 수십 개 생기는 일을 막는다.
 */
export const MAX_NEW_FOLDERS = 12

// ---------------------------------------------------------------- 응답 스키마

/**
 * AI 가 돌려줄 수 있는 것의 전부. strictObject 라 다른 키가 오면 실패한다.
 * `assignments` 는 '어느 폴더로', `leave` 는 '그대로 두고 이유'. 그 외의 동작은 없다.
 */
export const ADVICE_SCHEMA = z.strictObject({
  folders: z.array(
    z.strictObject({
      name: z.string(),
      description: z.string()
    })
  ),
  assignments: z.array(
    z.strictObject({
      id: z.string(),
      folder: z.string(),
      reason: z.string()
    })
  ),
  leave: z.array(
    z.strictObject({
      id: z.string(),
      reason: z.string()
    })
  )
})

export type Advice = z.infer<typeof ADVICE_SCHEMA>

// ---------------------------------------------------------------- 프롬프트

export const SYSTEM_PROMPT = `당신은 윈도우 PC 의 폴더 하나를 정리하는 도우미다.
사용자의 폴더 바로 아래에 있는 파일과 폴더 목록(이름·종류·확장자·크기·수정일만)을 받는다.
파일 내용은 볼 수 없고, 보이는 것만으로 판단한다.

할 일:
- 항목들을 **의미** 로 묶는다. 같은 기기의 드라이버, 같은 프로젝트, 같은 가게·행사·과제처럼
  사람이 나중에 찾을 때 떠올릴 이름으로 묶는다. 확장자만으로 묶는 건 이미 규칙이 하니 하지 않는다.
- 폴더 이름은 한국어, 짧게, 윈도우 폴더 이름으로 쓸 수 있는 문자만. 새 폴더는 8개 이하로.
- existingFolders 에 있는 폴더는 이름을 그대로 써서 재사용할 수 있다.
- 확신이 없거나 그 자리에 두는 게 나은 항목(바로가기, 진행 중인 작업으로 보이는 것)은 leave 에 넣고
  이유를 적는다.
- 각 id 는 assignments 또는 leave 중 한 곳에만, 한 번만 나온다.
- 폴더 항목(kind = dir)도 통째로 다른 폴더 아래로 옮길 수 있다. 자기 자신과 같은 이름의 폴더로는
  보내지 않는다.
- reason 은 사용자가 한눈에 납득할 한 문장.`

// ---------------------------------------------------------------- 요청 조립

/** YYYY-MM-DD. 시각은 보내지 않는다 */
function toDateOnly(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * 항목 하나를 전송용으로 바꾼다.
 *
 * 필드를 하나씩 옮겨 적는다. `...item` 으로 펼치면 나중에 OrganizeItem 에 필드가 추가될 때
 * 그 값이 조용히 따라 나간다. tests/advisor.test.ts 가 여기 나열된 키 외에는 없음을 확인한다.
 */
function toAdvisorItem(item: OrganizeItem): AdvisorItem {
  const out: AdvisorItem = {
    id: item.id,
    name: item.name,
    kind: item.kind,
    ext: item.ext,
    size: item.size,
    mtime: toDateOnly(item.mtimeMs),
    category: item.category
  }
  if (item.kind === 'dir') out.fileCount = item.fileCount ?? 0
  return out
}

export function buildAdvisorRequest(
  root: string,
  items: readonly OrganizeItem[],
  existingFolders: readonly string[]
): AdvisorRequest {
  return {
    rootName: basename(root),
    existingFolders: [...existingFolders],
    items: items.map(toAdvisorItem)
  }
}

export function chunkItems<T>(items: readonly T[], size = CHUNK_SIZE): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

/** 보내기 전에 사용자에게 보여줄 요약. 토큰 수는 대략값이다 (문자 3개 ≈ 1토큰) */
export function estimateRequest(request: AdvisorRequest): AdvisorPreview {
  const chunkCount = Math.max(1, Math.ceil(request.items.length / CHUNK_SIZE))
  const bodyChars = JSON.stringify(request).length
  const promptChars = SYSTEM_PROMPT.length * chunkCount

  return {
    itemCount: request.items.length,
    chunkCount,
    sampleNames: request.items.slice(0, 10).map((item) => item.name),
    approxInputTokens: Math.ceil((bodyChars + promptChars) / 3)
  }
}

// ---------------------------------------------------------------- 응답 검증

export interface ValidatedAdvice {
  folders: ProposedFolder[]
  /** id -> 폴더 이름(정규화됨), 이유 */
  assignments: Map<string, { folder: string; reason: string }>
  /** id -> 이유 */
  leave: Map<string, string>
  /**
   * 버린 항목과 이유. 화면에는 내보내지 않는다 — 테스트가 검증 이유를 확인하고,
   * 문제가 생기면 디버거에서 볼 용도다. (이름은 들어 있지만 main 밖으로 나가지 않는다)
   */
  dropped: string[]
}

export function emptyAdvice(): ValidatedAdvice {
  return { folders: [], assignments: new Map(), leave: new Map(), dropped: [] }
}

/**
 * AI 응답을 의심하며 검증한다. 모르는 id, 쓸 수 없는 폴더 이름, 모르는 폴더, 자기 자신으로의
 * 이동, 파일 이름과 겹치는 폴더, 상한을 넘는 새 폴더는 버린다. 한 id 가 여러 번 나오면 처음 것만 남긴다.
 */
export function validateAdvice(advice: Advice, request: AdvisorRequest): ValidatedAdvice {
  const result = emptyAdvice()
  const itemsById = new Map(request.items.map((item) => [item.id, item]))

  // 같은 이름의 **파일**이 루트에 있으면 그 이름으로 폴더를 만들 수 없다 (mkdir 이 EEXIST 로 터진다)
  const fileNameKeys = new Set(
    request.items.filter((i) => i.kind === 'file').map((i) => folderKey(i.name))
  )

  // 이름 비교는 folderKey 로 접어서 한다. '사진' 과 '사진 ' 은 같은 폴더가 아니지만
  // 'Photos' 와 'photos' 는 윈도우에서 같은 폴더다.
  const canonical = new Map<string, string>()
  for (const name of request.existingFolders) canonical.set(folderKey(name), name)

  const existingKeys = new Set(canonical.keys())
  let newFolderCount = 0

  for (const folder of advice.folders) {
    const name = sanitizeFolderName(folder.name)
    if (!name) {
      result.dropped.push(`폴더 이름을 쓸 수 없음: ${JSON.stringify(folder.name)}`)
      continue
    }
    const key = folderKey(name)
    if (canonical.has(key)) {
      // 이미 알고 있는 이름이면 원래 표기를 유지한다
      if (!result.folders.some((f) => folderKey(f.name) === key)) {
        result.folders.push({
          name: canonical.get(key) as string,
          description: folder.description,
          existing: existingKeys.has(key),
          origin: 'ai'
        })
      }
      continue
    }
    if (fileNameKeys.has(key)) {
      result.dropped.push(`같은 이름의 파일이 있어 폴더로 쓸 수 없음: ${name}`)
      continue
    }
    if (newFolderCount >= MAX_NEW_FOLDERS) {
      result.dropped.push(`새 폴더 상한(${MAX_NEW_FOLDERS}) 초과: ${name}`)
      continue
    }
    newFolderCount += 1
    canonical.set(key, name)
    result.folders.push({ name, description: folder.description, existing: false, origin: 'ai' })
  }

  for (const assignment of advice.assignments) {
    const item = itemsById.get(assignment.id)
    if (!item) {
      result.dropped.push(`모르는 항목 id: ${assignment.id}`)
      continue
    }
    if (result.assignments.has(assignment.id) || result.leave.has(assignment.id)) {
      result.dropped.push(`중복 언급: ${item.name}`)
      continue
    }
    const name = sanitizeFolderName(assignment.folder)
    const folder = name ? canonical.get(folderKey(name)) : undefined
    if (!folder) {
      result.dropped.push(`모르는 폴더로 배정: ${item.name} → ${JSON.stringify(assignment.folder)}`)
      continue
    }
    if (item.kind === 'dir' && folderKey(item.name) === folderKey(folder)) {
      result.dropped.push(`자기 자신으로 이동: ${item.name}`)
      continue
    }
    // 기존 폴더인데 folders 에 안 적혔으면 여기서 채워 넣는다
    if (!result.folders.some((f) => folderKey(f.name) === folderKey(folder))) {
      result.folders.push({ name: folder, description: '', existing: true, origin: 'ai' })
    }
    result.assignments.set(assignment.id, { folder, reason: assignment.reason })
  }

  for (const entry of advice.leave) {
    const item = itemsById.get(entry.id)
    if (!item) {
      result.dropped.push(`모르는 항목 id: ${entry.id}`)
      continue
    }
    if (result.assignments.has(entry.id) || result.leave.has(entry.id)) {
      result.dropped.push(`중복 언급: ${item.name}`)
      continue
    }
    result.leave.set(entry.id, entry.reason)
  }

  return result
}

/** 청크별 검증 결과를 하나로 합친다. 먼저 온 것이 이긴다 */
export function mergeValidated(a: ValidatedAdvice, b: ValidatedAdvice): ValidatedAdvice {
  const folders = [...a.folders]
  for (const folder of b.folders) {
    if (!folders.some((f) => folderKey(f.name) === folderKey(folder.name))) folders.push(folder)
  }
  const assignments = new Map(a.assignments)
  for (const [id, value] of b.assignments) if (!assignments.has(id)) assignments.set(id, value)
  const leave = new Map(a.leave)
  for (const [id, reason] of b.leave) if (!leave.has(id) && !assignments.has(id)) leave.set(id, reason)

  return { folders, assignments, leave, dropped: [...a.dropped, ...b.dropped] }
}

// ---------------------------------------------------------------- 계획에 얹기

/**
 * 검증된 추천을 규칙 계획 위에 덮는다.
 *
 * AI 가 언급한 항목은 AI 결과로, 언급하지 않은 항목은 규칙 결과 그대로 둔다.
 * 어떤 폴더든 목적지로 쓰이면 그 폴더 항목 자체는 옮기지 않는다.
 */
export function mergeAdviceIntoPlan(plan: OrganizePlan, advice: ValidatedAdvice): OrganizePlan {
  const usedFolderKeys = new Set<string>()
  const draft: PlanItem[] = []

  for (const planItem of plan.items) {
    const { item } = planItem
    const assigned = advice.assignments.get(item.id)

    if (assigned) {
      usedFolderKeys.add(folderKey(assigned.folder))
      draft.push({ item, toFolder: assigned.folder, reason: assigned.reason, origin: 'ai' })
      continue
    }

    const leaveReason = advice.leave.get(item.id)
    if (leaveReason !== undefined) {
      draft.push({ item, toFolder: null, reason: leaveReason, origin: 'ai' })
      continue
    }

    if (planItem.toFolder) usedFolderKeys.add(folderKey(planItem.toFolder))
    draft.push(planItem)
  }

  // 목적지로 쓰이는 폴더 항목은 빼고, 그 이유를 적는다
  const items: PlanItem[] = []
  const skipped: SkippedItem[] = [...plan.skipped]
  for (const planItem of draft) {
    const { item } = planItem
    if (item.kind === 'dir' && usedFolderKeys.has(folderKey(item.name))) {
      skipped.push(skippedItem(item.path, item.name, 'destination'))
      continue
    }
    items.push(planItem)
  }

  // 제안 폴더 = AI 폴더 + 아직 규칙 항목이 쓰는 폴더. 실제로 쓰이는 것만 남긴다
  const folders: ProposedFolder[] = []
  const pushFolder = (folder: ProposedFolder): void => {
    if (!folders.some((f) => folderKey(f.name) === folderKey(folder.name))) folders.push(folder)
  }
  for (const folder of advice.folders) if (usedFolderKeys.has(folderKey(folder.name))) pushFolder(folder)
  for (const folder of plan.folders) if (usedFolderKeys.has(folderKey(folder.name))) pushFolder(folder)

  return { ...plan, folders, items, skipped }
}

/** 계획의 root 안에 이미 있는 폴더 이름. AI 가 재사용할 수 있게 알려준다 */
function existingFolderNames(plan: OrganizePlan): string[] {
  const names = plan.items.filter((p) => p.item.kind === 'dir').map((p) => p.item.name)
  for (const folder of plan.folders) if (folder.existing) names.push(folder.name)
  // 목적지라서 skipped 로 간 폴더도 실제로 존재한다
  for (const s of plan.skipped) if (s.reason === 'destination') names.push(s.name)

  const seen = new Set<string>()
  return names.filter((name) => {
    const key = folderKey(name)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** 동의 화면용 요약. 실제 요청과 같은 조립 함수를 거친다 */
export function previewAdvice(plan: OrganizePlan): AdvisorPreview {
  const items = plan.items.map((p) => p.item)
  return estimateRequest(buildAdvisorRequest(plan.root, items, existingFolderNames(plan)))
}

/**
 * 계획 전체를 AI 에게 묻고 추천을 얹은 새 계획을 돌려준다.
 * 청크가 여럿이면 앞 청크가 제안한 폴더를 다음 청크에 '기존 폴더' 로 넘겨 이름이 흔들리지 않게 한다.
 */
export async function advisePlan(plan: OrganizePlan, call: StructuredCall): Promise<OrganizePlan> {
  const items = plan.items.map((p) => p.item)
  let known = existingFolderNames(plan)
  let merged = emptyAdvice()

  for (const chunk of chunkItems(items)) {
    const request = buildAdvisorRequest(plan.root, chunk, known)
    const advice = await call({
      system: SYSTEM_PROMPT,
      user: JSON.stringify(request),
      schema: ADVICE_SCHEMA,
      maxTokens: MAX_OUTPUT_TOKENS
    })
    const validated = validateAdvice(advice, request)
    merged = mergeValidated(merged, validated)

    const knownKeys = new Set(known.map(folderKey))
    for (const folder of validated.folders) {
      if (!knownKeys.has(folderKey(folder.name))) {
        known = [...known, folder.name]
        knownKeys.add(folderKey(folder.name))
      }
    }
  }

  return mergeAdviceIntoPlan(plan, merged)
}
