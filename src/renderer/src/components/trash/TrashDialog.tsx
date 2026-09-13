import { useMemo, type JSX } from 'react'
import { Loader2, ShieldCheck, Trash2 } from 'lucide-react'
import type { TrashEntry, TrashPlan, TrashProgress, TrashResult } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ProgressBar } from '@/components/ui/progress-bar'
import { formatBytes, formatCount, truncatePath } from '@/lib/format'
import { trashItemsOf } from '@/lib/trashEdit'

/**
 * 휴지통 다이얼로그의 단계. ExecuteDialog 와 같은 상태 기계에 '검증' 단계가 하나 더 있다.
 * TrashPage 가 상태를 들고 이 컴포넌트는 그리기만 한다.
 *
 * confirm — 무엇을 보내고 무엇을 남기는지 보여주고 사용자가 누르기를 기다린다 (아직 아무것도 안 함)
 * running — main 이 도는 중. 닫을 수 없다. 진행률의 phase 로 '전체 해시 비교 중'(읽기만)과
 *           '휴지통으로 보내는 중'을 가른다 — 진행률이 오기 전에는 비교 중으로 본다
 * blocked — 점검에서 걸려 **아무것도 보내지 않았다**. 계획은 그대로 남아 있다
 * done    — 보냈다. 결과와 "휴지통에서 복원" 안내, 다시 스캔
 */
export type TrashDialogState =
  | { phase: 'confirm'; plan: TrashPlan }
  | { phase: 'running' }
  | { phase: 'blocked'; problems: TrashResult[] }
  /** journalError — 보내긴 했는데 마지막 기록 저장이 실패했다 */
  | { phase: 'done'; entry: TrashEntry; journalError?: string }

interface TrashDialogProps {
  state: TrashDialogState | null
  progress: TrashProgress | null
  /** 호출 자체가 실패했을 때 화면에 보여줄 문장 */
  error: string | null
  onConfirm: () => void
  onClose: () => void
  onRescan: () => void
}

function ResultList({ results }: { results: TrashResult[] }): JSX.Element {
  return (
    <ul className="bg-muted/40 flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md px-3 py-2">
      {results.map((r) => (
        <li key={r.id} className="flex flex-col">
          <span className="selectable truncate font-mono text-[11px]" title={r.path}>
            {truncatePath(r.path, 72)}
          </span>
          {!r.ok && <span className="text-destructive text-[11px]">{r.error}</span>}
        </li>
      ))}
    </ul>
  )
}

export function TrashDialog({
  state,
  progress,
  error,
  onConfirm,
  onClose,
  onRescan
}: TrashDialogProps): JSX.Element | null {
  const groups = useMemo(
    () => (state?.phase === 'confirm' ? state.plan.groups.filter((g) => g.included) : []),
    [state]
  )

  if (!state) return null

  // 도는 중에는 닫지 못한다 — 닫아도 main 은 계속 도니 화면만 잃는다
  const close = state.phase === 'running' ? () => undefined : onClose

  switch (state.phase) {
    case 'confirm': {
      const count = groups.reduce((n, g) => n + g.items.length - 1, 0)
      const bytes = groups.reduce((n, g) => n + g.size * (g.items.length - 1), 0)
      return (
        <Dialog
          open
          title="휴지통으로 보낼까요?"
          onClose={close}
          className="max-w-2xl"
          footer={
            <>
              <Button variant="outline" size="sm" onClick={onClose}>
                취소
              </Button>
              <Button variant="destructive" size="sm" onClick={onConfirm} disabled={count === 0}>
                <Trash2 />
                {formatCount(count)}개 휴지통으로 보내기
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <p>
              <b>
                {formatCount(count)}개 파일 · {formatBytes(bytes)}
              </b>
              을(를) 윈도우 휴지통으로 보냅니다. 그룹마다 하나씩, {formatCount(groups.length)}개 파일은
              남깁니다.
            </p>
            <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
              {groups.map((g) => {
                const keeper = g.items.find((it) => it.id === g.keepId)
                return (
                  <li key={g.id} className="rounded-md border px-3 py-2">
                    <div className="mb-1 flex items-baseline gap-2">
                      <span className="font-medium">{keeper?.name}</span>
                      <span className="text-muted-foreground">
                        {formatBytes(g.size)} · {formatCount(g.items.length - 1)}개 보냄
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5 font-mono text-[11px]">
                      {keeper && (
                        <div className="selectable text-primary truncate" title={keeper.path}>
                          남김 {truncatePath(keeper.path, 70)}
                        </div>
                      )}
                      {trashItemsOf(g).map((it) => (
                        <div
                          key={it.id}
                          className="selectable text-muted-foreground truncate"
                          title={it.path}
                        >
                          보냄 {truncatePath(it.path, 70)}
                        </div>
                      ))}
                    </div>
                  </li>
                )
              })}
            </ul>
            <p className="text-muted-foreground flex items-start gap-2">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              <span>
                보내기 전에 각 그룹의 파일 전체를 다시 비교합니다. 하나라도 다르거나 사라졌으면 <b>아무것도
                보내지 않습니다</b>. 영구 삭제가 아니라 윈도우 휴지통으로 가며, 거기서 복원할 수 있습니다.
              </span>
            </p>
            {error && <p className="text-destructive">{error}</p>}
          </div>
        </Dialog>
      )
    }

    case 'running': {
      const verifying = progress?.phase !== 'trashing'
      const total = progress?.total ?? 0
      const done = progress?.done ?? 0
      return (
        <Dialog open title={verifying ? '전체 내용을 비교하는 중' : '휴지통으로 보내는 중'} onClose={close}>
          <div className="flex flex-col gap-3">
            <ProgressBar value={total > 0 ? done / total : 0} indicatorClassName="bg-primary" />
            <p className="text-muted-foreground flex items-center gap-2">
              <Loader2 className="size-3.5 animate-spin" />
              {verifying
                ? `${formatBytes(done)} / ${formatBytes(total)}`
                : `${formatCount(done)} / ${formatCount(total)}`}
              {progress?.current && (
                <span className="selectable truncate font-mono text-[11px]">{progress.current}</span>
              )}
            </p>
            {verifying && (
              <p className="text-muted-foreground">읽기만 합니다. 아직 아무것도 보내지 않았습니다.</p>
            )}
          </div>
        </Dialog>
      )
    }

    case 'blocked':
      return (
        <Dialog
          open
          title="아무것도 보내지 않았습니다"
          onClose={close}
          footer={
            <Button size="sm" onClick={onClose}>
              목록으로 돌아가기
            </Button>
          }
        >
          <div className="flex flex-col gap-3">
            <p>
              보내기 전 점검에서 {formatCount(state.problems.length)}개 파일에 문제가 있어 하나도 보내지
              않았습니다. 걸린 그룹을 빼거나 다시 스캔한 뒤 실행하세요.
            </p>
            <ResultList results={state.problems} />
          </div>
        </Dialog>
      )

    case 'done': {
      const { entry } = state
      const ok = entry.results.filter((r) => r.ok)
      const failed = entry.results.filter((r) => !r.ok)
      const bytes = ok.reduce((n, r) => n + r.size, 0)
      return (
        <Dialog
          open
          title="휴지통으로 보냈습니다"
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
              <b>
                {formatCount(ok.length)}개 · {formatBytes(bytes)}
              </b>
              을(를) 휴지통으로 보냈습니다. {formatCount(entry.keptPaths.length)}개는 남겼습니다.
              {failed.length > 0 && (
                <span className="text-destructive"> {formatCount(failed.length)}개는 보내지 못했습니다.</span>
              )}
            </p>
            {failed.length > 0 && <ResultList results={failed} />}
            {state.journalError && (
              <p className="text-destructive">
                실행 기록을 저장하지 못했습니다 ({state.journalError}). 파일은 위 결과대로 휴지통에 갔지만
                대시보드의 기록이 뒤처질 수 있습니다.
              </p>
            )}
            <p className="text-muted-foreground">
              되돌리려면 윈도우 휴지통에서 복원하세요. 파일이 움직여 스캔 결과가 낡았습니다 — 다시 스캔하면
              새 계획을 세울 수 있습니다.
            </p>
            {error && <p className="text-destructive">{error}</p>}
          </div>
        </Dialog>
      )
    }
  }
}
