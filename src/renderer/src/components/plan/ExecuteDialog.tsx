import { useMemo, type JSX } from 'react'
import { Folder, FolderOpen, Loader2 } from 'lucide-react'
import type {
  ExecuteProgress,
  ExecutionResult,
  OrganizePlan,
  UndoEntry,
  UndoOutcome
} from '@shared/types'
import { folderKey } from '@shared/folderName'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ProgressBar } from '@/components/ui/progress-bar'
import { formatBytes, formatCount } from '@/lib/format'

/**
 * 실행 다이얼로그의 단계. PlanPage 가 상태를 들고 이 컴포넌트는 그리기만 한다.
 *
 * confirm  — 무엇을 어디로 옮기는지 보여주고 사용자가 누르기를 기다린다 (아직 아무것도 안 함)
 * running  — main 이 옮기는 중. 닫을 수 없다
 * blocked  — 사전 점검에서 걸려 **아무것도 옮기지 않았다**. 계획은 그대로 남아 있다
 * done     — 옮겼다. 결과와 실행취소·다시 스캔
 * undoing / undone — 결과 화면에서 바로 되돌리는 중 / 되돌린 결과
 */
export type ExecuteState =
  | { phase: 'confirm'; plan: OrganizePlan }
  | { phase: 'running' }
  | { phase: 'blocked'; problems: ExecutionResult[] }
  /** journalError — 옮기긴 했는데 마지막 기록 저장이 실패했다. 실행취소가 불완전할 수 있어 경고한다 */
  | { phase: 'done'; entry: UndoEntry; journalError?: string }
  | { phase: 'undoing'; entry: UndoEntry; journalError?: string }
  | { phase: 'undone'; outcome: UndoOutcome }

interface ExecuteDialogProps {
  state: ExecuteState | null
  progress: ExecuteProgress | null
  /** 화면에 보여줄 실패 문장 (실행·실행취소 호출 자체가 실패했을 때) */
  error: string | null
  onConfirm: () => void
  onClose: () => void
  onUndo: (entry: UndoEntry) => void
  onRescan: () => void
}

interface FolderGroup {
  name: string
  existing: boolean
  names: string[]
  bytes: number
}

/** 확인 화면용: 폴더별로 어떤 항목이 들어가는지 */
function groupMoves(plan: OrganizePlan): FolderGroup[] {
  const byKey = new Map<string, FolderGroup>()
  for (const folder of plan.folders) {
    byKey.set(folderKey(folder.name), {
      name: folder.name,
      existing: folder.existing,
      names: [],
      bytes: 0
    })
  }
  for (const p of plan.items) {
    if (p.toFolder === null) continue
    const group = byKey.get(folderKey(p.toFolder))
    if (!group) continue
    group.names.push(p.item.kind === 'dir' ? `${p.item.name}/` : p.item.name)
    group.bytes += p.item.size
  }
  return [...byKey.values()].filter((g) => g.names.length > 0)
}

function ResultList({ results }: { results: ExecutionResult[] }): JSX.Element {
  return (
    <ul className="bg-muted/40 flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md px-3 py-2">
      {results.map((r) => (
        <li key={r.id} className="flex flex-col">
          <span className="selectable truncate font-mono text-[11px]" title={r.from}>
            {r.kind === 'dir' ? `${r.name}/` : r.name}
          </span>
          {!r.ok && <span className="text-destructive text-[11px]">{r.error}</span>}
        </li>
      ))}
    </ul>
  )
}

export function ExecuteDialog({
  state,
  progress,
  error,
  onConfirm,
  onClose,
  onUndo,
  onRescan
}: ExecuteDialogProps): JSX.Element | null {
  const groups = useMemo(
    () => (state?.phase === 'confirm' ? groupMoves(state.plan) : []),
    [state]
  )

  if (!state) return null

  // 옮기는 중·되돌리는 중에는 닫지 못한다 — 닫아도 main 은 계속 도니 화면만 잃는다
  const locked = state.phase === 'running' || state.phase === 'undoing'
  const close = locked ? () => undefined : onClose

  switch (state.phase) {
    case 'confirm': {
      const count = groups.reduce((n, g) => n + g.names.length, 0)
      const bytes = groups.reduce((n, g) => n + g.bytes, 0)
      const newFolders = groups.filter((g) => !g.existing).length
      return (
        <Dialog
          open
          title="이 대로 옮길까요?"
          onClose={close}
          footer={
            <>
              <Button variant="outline" size="sm" onClick={onClose}>
                취소
              </Button>
              <Button size="sm" onClick={onConfirm} disabled={count === 0}>
                {formatCount(count)}개 옮기기
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <p>
              <b>
                {formatCount(count)}개 항목 · {formatBytes(bytes)}
              </b>
              을(를) {formatCount(groups.length)}개 폴더로 옮깁니다.
              {newFolders > 0 && ` 폴더 ${formatCount(newFolders)}개를 새로 만듭니다.`}
            </p>
            <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
              {groups.map((g) => (
                <li key={g.name}>
                  <details className="rounded-md border px-3 py-1.5">
                    <summary className="flex cursor-pointer items-center gap-2 select-none">
                      {g.existing ? (
                        <FolderOpen className="text-muted-foreground size-3.5" />
                      ) : (
                        <Folder className="text-muted-foreground size-3.5" />
                      )}
                      <span className="font-medium">{g.name}</span>
                      <span className="text-muted-foreground">
                        {g.existing ? '기존 폴더' : '새 폴더'} · {formatCount(g.names.length)}개 ·{' '}
                        {formatBytes(g.bytes)}
                      </span>
                    </summary>
                    <ul className="mt-1.5 flex flex-col gap-0.5 pl-5 font-mono text-[11px]">
                      {g.names.map((name) => (
                        <li key={name} className="selectable truncate">
                          {name}
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground">
              이름은 바뀌지 않고, 목적지에 같은 이름이 있으면 하나도 옮기지 않습니다. 파일을 지우는 것은
              없습니다. 옮긴 뒤 &lsquo;실행취소&rsquo;로 되돌릴 수 있습니다.
            </p>
            {error && <p className="text-destructive">{error}</p>}
          </div>
        </Dialog>
      )
    }

    case 'running': {
      const total = progress?.total ?? 0
      const done = progress?.done ?? 0
      return (
        <Dialog open title="옮기는 중" onClose={close}>
          <div className="flex flex-col gap-3">
            <ProgressBar value={total > 0 ? done / total : 0} indicatorClassName="bg-primary" />
            <p className="text-muted-foreground flex items-center gap-2">
              <Loader2 className="size-3.5 animate-spin" />
              {formatCount(done)} / {formatCount(total)}
              {progress?.current && (
                <span className="selectable truncate font-mono text-[11px]">{progress.current}</span>
              )}
            </p>
          </div>
        </Dialog>
      )
    }

    case 'blocked':
      return (
        <Dialog
          open
          title="아무것도 옮기지 않았습니다"
          onClose={close}
          footer={
            <Button size="sm" onClick={onClose}>
              판으로 돌아가기
            </Button>
          }
        >
          <div className="flex flex-col gap-3">
            <p>
              실행 전 점검에서 {formatCount(state.problems.length)}개 항목에 문제가 있어 하나도 옮기지
              않았습니다. 걸린 카드를 &lsquo;그대로 두기&rsquo;로 옮기거나 다시 스캔한 뒤 실행하세요.
            </p>
            <ResultList results={state.problems} />
          </div>
        </Dialog>
      )

    case 'done':
    case 'undoing': {
      const { entry } = state
      const ok = entry.results.filter((r) => r.ok)
      const failed = entry.results.filter((r) => !r.ok)
      const undoing = state.phase === 'undoing'
      return (
        <Dialog
          open
          title={undoing ? '되돌리는 중' : '옮겼습니다'}
          onClose={close}
          footer={
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onUndo(entry)}
                disabled={undoing || ok.length === 0}
              >
                {undoing && <Loader2 className="animate-spin" />}
                실행취소
              </Button>
              <Button variant="outline" size="sm" onClick={onClose} disabled={undoing}>
                닫기
              </Button>
              <Button size="sm" onClick={onRescan} disabled={undoing}>
                다시 스캔
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <p>
              <b>{formatCount(ok.length)}개</b>를 옮겼습니다.
              {entry.createdFolders.length > 0 &&
                ` 새 폴더 ${formatCount(entry.createdFolders.length)}개 (${entry.createdFolders.join(', ')}).`}
              {failed.length > 0 && (
                <span className="text-destructive"> {formatCount(failed.length)}개는 옮기지 못했습니다.</span>
              )}
            </p>
            {failed.length > 0 && <ResultList results={failed} />}
            {state.journalError && (
              <p className="text-destructive">
                실행 기록을 저장하지 못했습니다 ({state.journalError}). 파일은 위 결과대로 옮겨졌지만 기록이
                뒤처져 실행취소가 마지막 항목을 놓칠 수 있습니다. 위 목록을 참고해 직접 확인하세요.
              </p>
            )}
            <p className="text-muted-foreground">
              파일이 움직여 스캔 결과가 낡았습니다. 계획을 다시 세우려면 다시 스캔하세요. 되돌리기는
              대시보드의 &lsquo;최근 실행&rsquo;에서도 할 수 있습니다.
            </p>
            {error && <p className="text-destructive">{error}</p>}
          </div>
        </Dialog>
      )
    }

    case 'undone': {
      const { results, removedFolders, keptFolders } = state.outcome
      const ok = results.filter((r) => r.ok)
      const failed = results.filter((r) => !r.ok)
      return (
        <Dialog
          open
          title="되돌렸습니다"
          onClose={close}
          footer={
            <>
              <Button variant="outline" size="sm" onClick={onClose}>
                닫기
              </Button>
              <Button size="sm" onClick={onRescan}>
                다시 스캔
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <p>
              <b>{formatCount(ok.length)}개</b>를 원래 자리로 되돌렸습니다.
              {failed.length > 0 && (
                <span className="text-destructive"> {formatCount(failed.length)}개는 되돌리지 못했습니다.</span>
              )}
            </p>
            {failed.length > 0 && <ResultList results={failed} />}
            {(removedFolders.length > 0 || keptFolders.length > 0) && (
              <p className="text-muted-foreground">
                {removedFolders.length > 0 &&
                  `실행하면서 만든 빈 폴더 ${formatCount(removedFolders.length)}개를 지웠습니다 (${removedFolders.join(', ')}).`}
                {keptFolders.length > 0 &&
                  ` ${keptFolders.join(', ')} 폴더는 비어 있지 않아 남겼습니다.`}
              </p>
            )}
            <p className="text-muted-foreground">다시 스캔하면 새 계획을 세울 수 있습니다.</p>
          </div>
        </Dialog>
      )
    }
  }
}
