import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import { ArrowLeft, Copy, Loader2, Trash2 } from 'lucide-react'
import { TrashDialog, type TrashDialogState } from '@/components/trash/TrashDialog'
import { TrashGroupCard } from '@/components/trash/TrashGroupCard'
import { Button } from '@/components/ui/button'
import type { ScanState } from '@/hooks/useScan'
import { useTrash } from '@/hooks/useTrash'
import { formatBytes, formatCount, formatDate } from '@/lib/format'
import { summarize, toTrashRequests } from '@/lib/trashEdit'

interface TrashPageProps {
  scan: ScanState
  onBack: () => void
}

/**
 * 중복 후보 정리 화면. 그룹마다 남길 파일 하나를 고르고 나머지를 휴지통 대상으로 본다.
 *
 * 목록은 스캔이 이미 계산한 그룹이라 파일을 읽지 않고, 여기서 무엇을 고르든 파일은 움직이지 않는다.
 * 보내는 건 하단 버튼 → 확인 다이얼로그에서 사용자가 한 번 더 누른 뒤이고, main 은 그때 전체 해시를
 * 다시 비교해 하나라도 다르면 아무것도 보내지 않는다. 그 뒤에는 스캔 결과가 낡아 다시 스캔해야 한다.
 */
export default function TrashPage({ scan, onBack }: TrashPageProps): JSX.Element {
  const { plan, busy, error, progress, build, execute, chooseKeeper, include, includeAll } =
    useTrash()
  const [dialog, setDialog] = useState<TrashDialogState | null>(null)
  // 이 화면에서 무언가를 보냈는지 — 그 뒤의 빈 화면은 "스캔 전"이 아니라 "낡음"이다
  const [sent, setSent] = useState(false)
  const scannedAt = scan.result?.scannedAt ?? 0

  // 들어오면 바로 만든다 — 비용이 없고(파일을 읽지 않는다) 사용자가 고를 게 이 목록뿐이다
  useEffect(() => {
    if (scannedAt > 0) void build(scannedAt)
  }, [build, scannedAt])

  const stats = useMemo(() => (plan ? summarize(plan) : null), [plan])

  // ---------------------------------------------------------------- 실행

  const openConfirm = useCallback(() => {
    if (plan) setDialog({ phase: 'confirm', plan })
  }, [plan])

  const confirm = useCallback(async () => {
    if (!plan) return
    setDialog({ phase: 'running' })
    const outcome = await execute(toTrashRequests(plan))
    if (!outcome) {
      // 호출 자체가 실패했다 (useTrash 의 error 에 문장이 있다). 아무것도 안 갔으니 확인 화면으로
      setDialog({ phase: 'confirm', plan })
      return
    }
    if (outcome.status === 'blocked') {
      setDialog({ phase: 'blocked', problems: outcome.problems })
      return
    }
    // 파일이 휴지통에 갔다. 대시보드의 스캔 결과도 더는 맞지 않는다
    scan.invalidate()
    setSent(true)
    setDialog({ phase: 'done', entry: outcome.entry, journalError: outcome.journalError })
  }, [plan, execute, scan])

  const rescan = useCallback(() => {
    setDialog(null)
    onBack()
    void scan.run()
  }, [onBack, scan])

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="대시보드로">
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold">중복 후보 정리</h1>
          <p className="text-muted-foreground truncate text-xs">
            그룹마다 하나를 남기고 나머지를 휴지통으로 보냅니다. 아래 버튼을 누르고 확인하기 전까지 아무것도
            지우지 않습니다.
          </p>
        </div>
      </header>

      <div className="bg-muted/40 text-muted-foreground flex items-center gap-2 border-b px-6 py-2 text-xs">
        <Copy className="size-3.5 shrink-0" />
        <span>
          크기와 <b>앞 4KB</b>만 비교한 후보입니다. 휴지통으로 보내기 전에 파일 전체를 다시 비교하며, 하나라도
          다르면 아무것도 보내지 않습니다.
        </span>
      </div>

      {scannedAt === 0 && (
        <div className="text-muted-foreground border-b px-6 py-2 text-xs">
          {sent
            ? '파일이 움직여 스캔 결과가 낡았습니다. 다시 스캔하면 새 목록을 만듭니다.'
            : '먼저 대시보드에서 스캔을 실행하세요. 목록은 스캔 결과에서 나옵니다.'}
        </div>
      )}
      {error && !dialog && <div className="text-destructive border-b px-6 py-2 text-xs">{error}</div>}

      <main className="flex min-h-0 flex-1 flex-col gap-3 p-6">
        {busy === 'build' && !plan ? (
          <p className="text-muted-foreground flex items-center gap-2 text-xs">
            <Loader2 className="size-3.5 animate-spin" />
            목록을 만드는 중
          </p>
        ) : !plan || !stats ? null : plan.groups.length === 0 ? (
          <p className="text-muted-foreground text-xs">중복 후보가 없습니다.</p>
        ) : (
          <>
            <section className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="font-medium">
                {formatCount(stats.groups)}그룹 · 지울 수 있는 {formatBytes(stats.reclaimableBytes)}
              </span>
              <span className="text-muted-foreground">
                포함 {formatCount(stats.includedGroups)}그룹 · 휴지통으로 {formatCount(stats.files)}개 ·{' '}
                {formatBytes(stats.bytes)}
              </span>
              <span className="ml-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => includeAll(true)}
                  disabled={busy !== null || stats.includedGroups === stats.groups}
                >
                  전부 포함
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => includeAll(false)}
                  disabled={busy !== null || stats.includedGroups === 0}
                >
                  전부 제외
                </Button>
                <span className="text-muted-foreground ml-2">{formatDate(plan.createdAt)} 기준</span>
              </span>
            </section>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
              {plan.groups.map((group) => (
                <TrashGroupCard
                  key={group.id}
                  group={group}
                  disabled={busy !== null}
                  onChooseKeeper={chooseKeeper}
                  onInclude={include}
                />
              ))}
            </div>

            <footer className="flex items-center justify-end gap-2 border-t pt-3">
              <span className="text-muted-foreground mr-auto text-xs">
                남길 파일은 라디오로 바꿀 수 있습니다. 기본값은 가장 최근에 손댄 사본입니다.
              </span>
              {/* 여기서는 확인 다이얼로그만 연다. 실제로 보내는 건 다이얼로그에서 한 번 더 누른 뒤 */}
              <Button
                variant="destructive"
                onClick={openConfirm}
                disabled={stats.files === 0 || busy !== null}
                title={stats.files === 0 ? '보낼 파일이 없습니다' : undefined}
              >
                <Trash2 />
                휴지통으로 보내기 ({formatCount(stats.files)}개 · {formatBytes(stats.bytes)})
              </Button>
            </footer>
          </>
        )}
      </main>

      <TrashDialog
        state={dialog}
        progress={progress}
        error={dialog?.phase === 'confirm' ? error : null}
        onConfirm={() => void confirm()}
        onClose={() => setDialog(null)}
        onRescan={rescan}
      />
    </div>
  )
}
