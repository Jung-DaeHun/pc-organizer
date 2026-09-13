import type { JournalEntry, UndoEntry, UndoOutcome } from '@shared/types'
import { beginActivity } from './activity'
import { undoMoves, type ExecutorIo } from './executor'
import { findEntry, readJournal, saveEntry } from './journal'
import { clearLastPlan } from './plan'
import { markStale } from './scan'

/**
 * 실행취소의 조율. 저널에서 기록을 찾아 실행기에 거꾸로 돌려 달라고 한다.
 * 쓰기 I/O 는 실행과 같은 ExecutorIo 를 주입받는다 — 되돌리기도 rename 일 뿐이다.
 */

/** 최근 것이 앞. 이동·휴지통 기록이 섞여 있다. 화면의 '최근 실행' 카드가 보여준다 */
export function listUndoEntries(journalPath: string): Promise<JournalEntry[]> {
  return readJournal(journalPath)
}

/**
 * 기록 하나를 되돌린다. 한 기록은 한 번만 되돌릴 수 있다(undoneAt).
 * 스캔·실행과 겹치지 않는다(activity.ts). 이동을 거꾸로 한 뒤 실행이 만든 폴더 중 빈 것을 치운다
 * (executor.undoMoves). 무언가 움직였으면 계획과 스캔 목록을 버린다 — 다시 스캔해야 한다.
 */
export async function undoExecution(
  id: string,
  io: ExecutorIo,
  journalPath: string
): Promise<UndoOutcome> {
  // 검사보다 먼저 잠근다 — findEntry 를 기다리는 사이 다른 호출이 끼어들 수 없게
  const release = beginActivity('undo')
  let started = false
  try {
    const entry = await findEntry(journalPath, id)
    if (!entry) throw new Error('그런 실행 기록이 없습니다')
    // 휴지통 기록은 되돌리지 않는다 — 앱이 휴지통에서 꺼내는 코드는 없고, 윈도우 휴지통에서 복원한다
    if (entry.kind === 'trash') throw new Error('휴지통으로 보낸 것은 윈도우 휴지통에서 복원하세요')
    if (entry.undoneAt) throw new Error('이미 되돌린 기록입니다')

    started = true
    const { results, removedFolders, keptFolders } = await undoMoves(entry, io)
    const updated: UndoEntry = {
      ...entry,
      undoneAt: Date.now(),
      undoResults: results,
      removedFolders,
      keptFolders
    }
    try {
      await saveEntry(journalPath, updated)
    } catch (err) {
      console.error('[undo] 실행 기록 저장 실패:', err instanceof Error ? err.message : err)
    }
    return { entry: updated, results, removedFolders, keptFolders }
  } finally {
    release()
    if (started) {
      clearLastPlan()
      markStale()
    }
  }
}
