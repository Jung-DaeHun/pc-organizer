import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ExecutionResult, UndoEntry } from '@shared/types'

/**
 * 실행 기록(저널). 실행취소가 이걸 읽어 되돌린다.
 *
 * 쓰는 곳은 **userData 아래 journal.json 하나**뿐이다 — 사용자 파일이 아니다. 경로는 인자로 받아
 * electron 을 import 하지 않는다(테스트는 임시 디렉터리를 넘긴다).
 *
 * 저장은 원자적이다: 임시 파일에 다 쓴 뒤 rename 으로 갈아 끼운다. 쓰는 도중에 앱이 죽어도
 * 이전 기록이 깨지지 않는다 — 기록이 깨지면 되돌릴 길이 사라진다.
 */

/** 이만큼만 남긴다. 실행취소는 최근 것에 하는 일이고, 오래된 기록은 파일이 이미 다른 곳에 가 있기 쉽다 */
export const JOURNAL_LIMIT = 20

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'string')

/**
 * 기록 파일은 디스크에 있는 JSON 이라 원소 하나하나까지 본다. 실행취소는 results 의 from/to 를 그대로
 * rename 하고 화면은 r.ok 를 읽는다 — 원소가 null 이거나 경로가 문자열이 아니면 둘 다 터진다
 */
function isResult(value: unknown): value is ExecutionResult {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    (v.kind === 'file' || v.kind === 'dir') &&
    typeof v.from === 'string' &&
    typeof v.to === 'string' &&
    typeof v.ok === 'boolean'
  )
}

const isResultArray = (v: unknown): v is ExecutionResult[] => Array.isArray(v) && v.every(isResult)

function isEntry(value: unknown): value is UndoEntry {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.executedAt === 'number' &&
    typeof v.root === 'string' &&
    isResultArray(v.results) &&
    isStringArray(v.createdFolders) &&
    (v.undoneAt === undefined || typeof v.undoneAt === 'number') &&
    (v.undoResults === undefined || isResultArray(v.undoResults)) &&
    (v.removedFolders === undefined || isStringArray(v.removedFolders)) &&
    (v.keptFolders === undefined || isStringArray(v.keptFolders))
  )
}

/** 최근 것이 앞. 파일이 없거나 깨졌으면 빈 목록 (모양이 틀린 항목은 버린다) */
export async function readJournal(path: string): Promise<UndoEntry[]> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.filter(isEntry).sort((a, b) => b.executedAt - a.executedAt)
}

async function writeJournal(path: string, entries: readonly UndoEntry[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(entries, null, 2), 'utf8')
  // 윈도우에서도 rename 은 기존 파일을 통째로 갈아 끼운다
  await rename(tmp, path)
}

/**
 * 기록 하나를 넣거나(같은 id 면) 갈아 끼운다. 실행 도중 항목마다 부르므로 같은 id 가 여러 번 온다.
 * 최근 JOURNAL_LIMIT 개만 남긴다.
 *
 * 저장하려는 항목은 **무조건 남긴다** — 시각으로 정렬한 뒤 자르면, 시계가 뒤로 간 뒤라 기존 항목의
 * executedAt 이 더 미래일 때 방금 실행한 기록이 잘려 나간다. 그러면 예외 없이 "기록이 없는 실행"이
 * 되어 실행취소 길이 사라진다. readJournal 이 최근 것을 앞으로 정렬해 주므로 나머지만 자른다.
 */
export async function saveEntry(path: string, entry: UndoEntry): Promise<void> {
  const others = (await readJournal(path)).filter((e) => e.id !== entry.id)
  await writeJournal(path, [entry, ...others.slice(0, JOURNAL_LIMIT - 1)])
}

export async function findEntry(path: string, id: string): Promise<UndoEntry | null> {
  return (await readJournal(path)).find((e) => e.id === id) ?? null
}
