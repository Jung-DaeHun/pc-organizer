import { basename, dirname, join } from 'node:path'
import {
  EXEC_ERROR_LABELS,
  type ExecErrorCode,
  type ExecuteProgress,
  type ExecuteRequest,
  type ExecutionResult,
  type ItemKind,
  type OrganizePlan,
  type SkipReason,
  type UndoEntry
} from '@shared/types'
import { folderKey, sanitizeFolderName } from '@shared/folderName'
import { pathKey } from '../lib/paths'

/**
 * 정리 계획을 실제로 옮기는 실행기. **이 앱에서 사용자 파일을 움직이는 유일한 로직**이다.
 *
 * 파일시스템은 ExecutorIo 로 주입받는다 — 이 파일은 fs 를 import 하지 않고, 실체는
 * ipc/handlers.ts 가 node:fs/promises 로 만든다. 그래서 Vitest 에서 가짜 io 로 전부 검증할 수 있고,
 * 쓰기 호출이 어디서 일어나는지 한눈에 보인다.
 *
 * 하는 일은 폴더 만들기(mkdir), 옮기기(rename), 그리고 실행취소가 **자기가 만든 빈 폴더**를 치우는 것
 * (rmdir, 비재귀)뿐이다. 사용자 파일을 지우는 호출(unlink·rm)은 없고, 복사하지 않고(다른 드라이브면 EXDEV 로
 * 실패), 이름을 바꾸지 않고(목적지 = join(root, 폴더, 원래 이름)), 덮어쓰지 않는다(목적지에 같은 이름이
 * 있으면 실패). 실행취소는 같은 rename 을 거꾸로 한 뒤, 만든 폴더가 비어 있으면 rmdir 한다 — 안에 무엇이든
 * 남아 있으면 ENOTEMPTY 로 실패해 그대로 둔다.
 */

/** lstat 결과 중 실행기가 보는 것. node:fs 의 Stats 가 그대로 맞는다 */
export interface EntryStat {
  isDirectory(): boolean
  isFile(): boolean
  isSymbolicLink(): boolean
}

export interface ExecutorIo {
  /** 링크를 따라가지 않아야 한다 (stat 이 아니라 lstat) */
  lstat(path: string): Promise<EntryStat>
  /** 한 단계만 만든다. 이미 있으면 EEXIST */
  mkdir(path: string): Promise<unknown>
  rename(from: string, to: string): Promise<void>
  /**
   * **비어 있는 디렉터리만** 지운다 (비재귀). 안에 무엇이든 있으면 ENOTEMPTY 로 실패해야 한다.
   * 실행취소가 자기가 만든 폴더를 치울 때만 부른다 — 사용자 파일이 지워질 수 있는 경로는 이 인터페이스에 없다.
   */
  rmdir(path: string): Promise<void>
}

/** 한 항목을 from 에서 to 로 옮기는 일. 실행도 되돌리기도 이 모양이다 */
export interface Hop {
  id: string
  name: string
  kind: ItemKind
  from: string
  to: string
}

/** 검증을 통과해 실제로 시도할 이동 하나. to 는 항상 join(root, toFolder, name) */
export interface Move extends Hop {
  toFolder: string
}

export interface ExecuteHooks {
  onProgress?: (progress: ExecuteProgress) => void
  /**
   * 이동 하나가 끝날 때마다(성공이든 실패든). 저널이 여기서 기록을 남긴다.
   * createdFolders 는 지금까지 만든 폴더 — 도중에 앱이 죽어도 실행취소가 폴더를 치울 수 있게 같이 기록한다.
   * 이 훅이 예외를 던지면 **더 진행하지 않는다** — 기록을 남길 수 없는 이동은 하지 않는다.
   */
  onResult?: (result: ExecutionResult, createdFolders: readonly string[]) => Promise<void>
}

export interface ExecuteReport {
  results: ExecutionResult[]
  /** 이번에 새로 만든 폴더 이름 */
  createdFolders: string[]
}

// ---------------------------------------------------------------- 검증 (계획 ↔ 요청)

/** skipped 중 실제로 폴더인 것. 그 이름의 목적지는 '기존 폴더'라 괜찮다 (planEdit.ts 와 같은 목록) */
const DIR_SKIP_REASONS: ReadonlySet<SkipReason> = new Set<SkipReason>([
  'destination',
  'has-cloud-only',
  'excluded-dir'
])

/**
 * renderer 가 돌려보낸 요청을 main 의 계획과 대조해 이동 목록으로 바꾼다.
 *
 * renderer 사본은 믿지 않는다. id 는 계획에 있어야 하고, 경로는 계획의 것을 쓰며(요청에는 경로가
 * 없다), 폴더 이름은 다시 검증한다. 판(planEdit.ts)이 지키는 규칙을 여기서 한 번 더 지킨다 —
 * **목적지로 쓰이는 폴더는 옮기지 않는다.** 하나라도 어긋나면 전체를 거부한다(예외). 요청이
 * 어긋났다는 건 버그거나 조작이라, 일부만 옮기는 것보다 아무것도 안 하는 게 낫다.
 */
export function resolveMoves(plan: OrganizePlan, requests: readonly ExecuteRequest[]): Move[] {
  // IPC 로 들어온 값이라 모양부터 본다
  if (!Array.isArray(requests)) throw new Error('요청 형식이 잘못되었습니다')
  if (requests.length === 0) throw new Error('옮길 항목이 없습니다')

  const byId = new Map(plan.items.map((p) => [p.item.id, p.item]))
  const seen = new Set<string>()
  const moves: Move[] = []

  for (const request of requests) {
    if (
      typeof request !== 'object' ||
      request === null ||
      typeof request.id !== 'string' ||
      typeof request.toFolder !== 'string'
    ) {
      throw new Error('요청 형식이 잘못되었습니다')
    }
    if (seen.has(request.id)) throw new Error(`같은 항목이 두 번 들어 있습니다 (id ${request.id})`)
    seen.add(request.id)

    const item = byId.get(request.id)
    if (!item) throw new Error(`계획에 없는 항목입니다 (id ${request.id})`)
    // 항목 경로는 항상 루트 바로 아래여야 한다. 아니면 계획 자체가 이상한 것
    if (pathKey(item.path) !== pathKey(join(plan.root, item.name))) {
      throw new Error(`항목 경로가 감시 폴더 바로 아래가 아닙니다 (${item.name})`)
    }

    const toFolder = sanitizeFolderName(request.toFolder)
    if (toFolder === null) throw new Error(`폴더 이름으로 쓸 수 없습니다 ('${request.toFolder}')`)

    moves.push({
      id: item.id,
      name: item.name,
      kind: item.kind,
      from: item.path,
      toFolder,
      to: join(plan.root, toFolder, item.name)
    })
  }

  // 목적지 폴더 이름은 옮기는 항목의 이름과 겹칠 수 없다. 폴더 카드를 옮기면서 그 이름으로
  // 열을 만들면 자기 안으로 들어가거나 열이 사라진다. 파일·링크 이름과 겹치면 mkdir 이 실패한다
  const movingKeys = new Set(moves.map((m) => folderKey(m.name)))
  const fileKeys = new Set(
    plan.items.filter((p) => p.item.kind === 'file').map((p) => folderKey(p.item.name))
  )
  for (const s of plan.skipped) {
    if (!DIR_SKIP_REASONS.has(s.reason)) fileKeys.add(folderKey(s.name))
  }

  for (const move of moves) {
    const key = folderKey(move.toFolder)
    if (movingKeys.has(key)) {
      throw new Error(`'${move.toFolder}' 은(는) 이번에 옮기는 항목의 이름이라 목적지로 쓸 수 없습니다`)
    }
    if (fileKeys.has(key)) {
      throw new Error(`'${move.toFolder}' 이라는 파일이 이미 있어 그 이름의 폴더를 만들 수 없습니다`)
    }
  }

  return moves
}

// ---------------------------------------------------------------- 점검

const errorCode = (err: unknown): string | undefined =>
  typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code?: unknown }).code)
    : undefined

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

function fail(hop: Hop, code: ExecErrorCode, detail?: string): ExecutionResult {
  return {
    id: hop.id,
    name: hop.name,
    kind: hop.kind,
    from: hop.from,
    to: hop.to,
    ok: false,
    code,
    error: detail ? `${EXEC_ERROR_LABELS[code]}: ${detail}` : EXEC_ERROR_LABELS[code]
  }
}

function succeed(hop: Hop): ExecutionResult {
  return { id: hop.id, name: hop.name, kind: hop.kind, from: hop.from, to: hop.to, ok: true }
}

/** lstat. 없으면 null, 그 밖의 실패는 그대로 던진다 */
async function statOrNull(io: ExecutorIo, path: string): Promise<EntryStat | null> {
  try {
    return await io.lstat(path)
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return null
    throw err
  }
}

const kindOf = (stat: EntryStat): ItemKind | null =>
  stat.isDirectory() ? 'dir' : stat.isFile() ? 'file' : null

/**
 * 원본이 옮길 수 있는 상태인지, 목적지가 비어 있는지 본다. 문제가 없으면 null.
 * 원본은 그대로 있어야 하고(링크 아님, 종류 같음) 목적지에는 같은 이름이 없어야 한다.
 * 실행과 되돌리기가 같은 검사를 쓴다.
 */
async function checkHop(hop: Hop, io: ExecutorIo): Promise<ExecutionResult | null> {
  const source = await statOrNull(io, hop.from)
  if (!source) return fail(hop, 'missing')
  if (source.isSymbolicLink()) return fail(hop, 'link')
  if (kindOf(source) !== hop.kind) return fail(hop, 'kind-changed')
  if (await statOrNull(io, hop.to)) return fail(hop, 'exists')
  return null
}

/**
 * 이동 하나를 읽기 전용으로 점검한다. 문제가 없으면 null.
 * checkHop 에 더해 목적지 폴더 자리가 비어 있거나 진짜 폴더(링크 아님)인지 본다.
 * 사전 점검과 실제 이동 직전에 같은 함수를 두 번 부른다.
 */
export async function checkMove(move: Move, io: ExecutorIo): Promise<ExecutionResult | null> {
  try {
    const destDir = await statOrNull(io, dirname(move.to))
    // 정션이나 심볼릭 링크인 목적지로 옮기면 파일이 다른 곳(다른 드라이브일 수도)으로 흘러간다
    if (destDir && (destDir.isSymbolicLink() || !destDir.isDirectory())) {
      return fail(move, 'dest-not-dir')
    }
    return await checkHop(move, io)
  } catch (err) {
    return fail(move, 'io', errorText(err))
  }
}

/** 전부 점검만 한다. 걸린 것만 돌려준다 — 비어 있으면 실행해도 된다 */
export async function preflight(moves: readonly Move[], io: ExecutorIo): Promise<ExecutionResult[]> {
  const problems: ExecutionResult[] = []
  for (const move of moves) {
    const problem = await checkMove(move, io)
    if (problem) problems.push(problem)
  }
  return problems
}

// ---------------------------------------------------------------- 실행

async function moveOne(move: Move, io: ExecutorIo, created: Set<string>): Promise<ExecutionResult> {
  // 사전 점검과 실제 이동 사이에 바뀔 수 있으니 바로 앞에서 한 번 더 본다
  const problem = await checkMove(move, io)
  if (problem) return problem

  const destDir = dirname(move.to)
  try {
    if (!(await statOrNull(io, destDir))) {
      try {
        await io.mkdir(destDir)
        created.add(move.toFolder)
      } catch (err) {
        // 같은 배치의 앞 항목이 방금 만들었을 수 있다. 그 경우가 아니면 진짜 실패
        if (errorCode(err) !== 'EEXIST') throw err
      }
    }
    await io.rename(move.from, move.to)
    return succeed(move)
  } catch (err) {
    const code = errorCode(err)
    if (code === 'EXDEV') return fail(move, 'exdev')
    if (code === 'ENOENT') return fail(move, 'missing', errorText(err))
    return fail(move, 'io', errorText(err))
  }
}

/**
 * 이동을 순서대로 실행한다. 하나가 실패해도 다음으로 넘어가고, 결과는 전부 돌려준다.
 * onResult 가 예외를 던지면(기록 실패) 남은 항목은 시도하지 않고 실패로 채운다.
 */
export async function executeMoves(
  moves: readonly Move[],
  io: ExecutorIo,
  hooks: ExecuteHooks = {}
): Promise<ExecuteReport> {
  const results: ExecutionResult[] = []
  const created = new Set<string>()
  const total = moves.length

  for (let i = 0; i < moves.length; i += 1) {
    const move = moves[i] as Move
    hooks.onProgress?.({ done: i, total, current: move.name })

    const result = await moveOne(move, io, created)
    results.push(result)

    try {
      await hooks.onResult?.(result, [...created])
    } catch (err) {
      const reason = `실행 기록을 저장할 수 없어 중단했습니다 (${errorText(err)})`
      for (const rest of moves.slice(i + 1)) results.push(fail(rest, 'io', reason))
      break
    }
  }

  hooks.onProgress?.({ done: total, total, current: '' })
  return { results, createdFolders: [...created] }
}

// ---------------------------------------------------------------- 실행취소

export interface UndoReport {
  results: ExecutionResult[]
  /** 실행이 만들었고 비어 있어 지운 폴더 */
  removedFolders: string[]
  /** 실행이 만들었지만 남긴 폴더 — 비어 있지 않거나(사용자가 무언가 넣음, 되돌리기 실패분) 폴더가 아니게 됨 */
  keptFolders: string[]
}

/**
 * 기록의 이동 하나가 실행이 만들었을 모양인가 — from = root\name, to = root\폴더\name, 폴더 이름은 규칙대로.
 * 기록 파일은 디스크에 있는 JSON 이라 createdFolders 의 이름을 다시 검사하듯 경로도 다시 본다.
 * 모양이 다르면 감시 폴더 밖으로 무언가를 옮기는 rename 이 될 수 있어 손대지 않는다.
 */
function isRecordedMove(root: string, done: ExecutionResult): boolean {
  const { name } = done
  if (!name || name === '.' || name === '..' || basename(name) !== name) return false
  if (pathKey(done.from) !== pathKey(join(root, name))) return false
  const folder = basename(dirname(done.to))
  if (sanitizeFolderName(folder) !== folder) return false
  return pathKey(done.to) === pathKey(join(root, folder, name))
}

/**
 * 실행 기록의 ok 였던 이동을 **역순으로** to → from 되돌린 뒤, 실행이 만든 폴더 중 빈 것을 치운다.
 * 이동은 지금 to 에 그 항목이 그대로 있고(링크 아님, 종류 같음) from 자리가 비어 있을 때만 한다.
 * 폴더는 기록(createdFolders)에 있는 이름만, 지금도 진짜 폴더일 때만, 비재귀 rmdir 로 지운다 —
 * 안에 무엇이든 남아 있으면 ENOTEMPTY 로 실패해 그대로 둔다. 기존 폴더를 목적지로 썼다면 기록에 없어 건드리지 않는다.
 */
export async function undoMoves(entry: UndoEntry, io: ExecutorIo): Promise<UndoReport> {
  const results: ExecutionResult[] = []
  const moved = entry.results.filter((r) => r.ok).reverse()

  for (const done of moved) {
    const back: Hop = { id: done.id, name: done.name, kind: done.kind, from: done.to, to: done.from }
    if (!isRecordedMove(entry.root, done)) {
      results.push(fail(back, 'io', '기록의 경로가 실행이 만든 모양이 아니라 건드리지 않았습니다'))
      continue
    }
    try {
      const problem = await checkHop(back, io)
      if (problem) {
        results.push(problem)
        continue
      }
      await io.rename(back.from, back.to)
      results.push(succeed(back))
    } catch (err) {
      results.push(fail(back, errorCode(err) === 'EXDEV' ? 'exdev' : 'io', errorText(err)))
    }
  }

  const removedFolders: string[] = []
  const keptFolders: string[] = []
  for (const name of entry.createdFolders) {
    // 기록 파일은 디스크에 있는 JSON 이다. 이름이 폴더 이름 규칙을 어기면(구분자, '..') 손대지 않는다
    if (sanitizeFolderName(name) !== name) {
      keptFolders.push(name)
      continue
    }
    const path = join(entry.root, name)
    try {
      const stat = await statOrNull(io, path)
      if (!stat) continue // 이미 없다
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        keptFolders.push(name)
        continue
      }
      await io.rmdir(path)
      removedFolders.push(name)
    } catch {
      // ENOTEMPTY 등 — 비어 있지 않으면 남긴다. 실패 이유는 중요하지 않다, 지우지 않았다는 것만 중요하다
      keptFolders.push(name)
    }
  }

  return { results, removedFolders, keptFolders }
}
