import { useEffect, useState, type JSX } from 'react'
import { History, Loader2, Trash2, Undo2 } from 'lucide-react'
import type { TrashEntry, UndoEntry } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useUndo } from '@/hooks/useUndo'
import { formatBytes, formatCount, formatDate, truncatePath } from '@/lib/format'

interface RecentRunCardProps {
  /** 스캔 중이면 되돌리지 못한다 (main 도 거부한다 — 여기서는 버튼을 막아 이유를 보여준다) */
  scanning: boolean
  /** 되돌린 뒤 부른다 — 파일이 움직였으니 스캔 결과를 비운다 */
  onFilesMoved: () => void
}

/** 카드에 보여줄 개수. 저널에는 더 남아 있다 */
const SHOWN = 5

function summary(entry: UndoEntry): string {
  const ok = entry.results.filter((r) => r.ok).length
  const failed = entry.results.length - ok
  const parts = [`${formatCount(ok)}개 옮김`]
  if (failed > 0) parts.push(`${formatCount(failed)}개 실패`)
  if (entry.createdFolders.length > 0) parts.push(`새 폴더 ${formatCount(entry.createdFolders.length)}개`)
  return parts.join(' · ')
}

function trashSummary(entry: TrashEntry): string {
  const ok = entry.results.filter((r) => r.ok)
  const failed = entry.results.length - ok.length
  const bytes = ok.reduce((n, r) => n + r.size, 0)
  const parts = [`${formatCount(ok.length)}개 휴지통으로 (${formatBytes(bytes)})`]
  if (failed > 0) parts.push(`${formatCount(failed)}개 실패`)
  if (entry.keptPaths.length > 0) parts.push(`${formatCount(entry.keptPaths.length)}개 남김`)
  return parts.join(' · ')
}

function undoSummary(entry: UndoEntry): string {
  const results = entry.undoResults ?? []
  const ok = results.filter((r) => r.ok).length
  const failed = results.length - ok
  const parts = [`${formatCount(ok)}개 되돌림`]
  if (failed > 0) parts.push(`${formatCount(failed)}개 못 되돌림`)
  // createdFolders - removed 로 계산하지 않는다 — 사용자가 이미 지운 폴더는 지운 것도 남긴 것도 아니다
  const removed = entry.removedFolders?.length ?? 0
  const kept = entry.keptFolders?.length ?? 0
  if (removed > 0) parts.push(`빈 폴더 ${formatCount(removed)}개 지움`)
  if (kept > 0) parts.push(`폴더 ${formatCount(kept)}개 남김`)
  return parts.join(' · ')
}

/**
 * 실행 기록과 실행취소. 앱을 다시 켠 뒤에도 되돌릴 수 있게 대시보드에 둔다.
 * 기록은 main 의 journal.json 이 진실이고, 여기서는 최근 몇 개만 보여준다.
 * 휴지통 기록은 되돌리기 버튼 대신 "윈도우 휴지통에서 복원" 안내만 한다 — 앱이 휴지통에서 꺼내는 코드는 없다.
 */
export function RecentRunCard({ scanning, onFilesMoved }: RecentRunCardProps): JSX.Element {
  const { entries, busy, error, refresh, undo } = useUndo()
  const [target, setTarget] = useState<UndoEntry | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    void refresh()
  }, [refresh])

  const confirmUndo = async (): Promise<void> => {
    if (!target) return
    const entry = target
    setTarget(null)
    const outcome = await undo(entry.id)
    if (outcome) {
      onFilesMoved()
      setNotice(`${formatDate(entry.executedAt)} 실행 — ${undoSummary(outcome.entry)}`)
    }
  }

  const shown = entries?.slice(0, SHOWN) ?? null

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <History className="size-4" />
            최근 실행
          </CardTitle>
          <CardDescription>
            옮긴 기록은 되돌리면 원래 자리로 돌아가고, 그때 만든 폴더는 비어 있으면 함께 지웁니다.
            휴지통으로 보낸 것은 윈도우 휴지통에서 복원합니다
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-xs">
        {shown === null ? (
          <Skeleton className="h-10 w-full" />
        ) : shown.length === 0 ? (
          <p className="text-muted-foreground">아직 옮긴 것이 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {shown.map((entry) => {
              if (entry.kind === 'trash') {
                return (
                  <li key={entry.id} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="shrink-0 font-medium whitespace-nowrap">{formatDate(entry.executedAt)}</span>
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Trash2 className="size-3" />
                          중복 후보 정리
                        </span>
                      </div>
                      <div className="text-muted-foreground">{trashSummary(entry)}</div>
                    </div>
                    <span className="text-muted-foreground shrink-0 text-[11px]">
                      윈도우 휴지통에서 복원
                    </span>
                  </li>
                )
              }
              const movedOk = entry.results.some((r) => r.ok)
              return (
                <li key={entry.id} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="shrink-0 font-medium whitespace-nowrap">{formatDate(entry.executedAt)}</span>
                      <span className="text-muted-foreground selectable truncate" title={entry.root}>
                        {truncatePath(entry.root, 36)}
                      </span>
                    </div>
                    <div className="text-muted-foreground">
                      {summary(entry)}
                      {entry.undoneAt && ` · ${undoSummary(entry)} (${formatDate(entry.undoneAt)})`}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setTarget(entry)}
                    disabled={busy || scanning || Boolean(entry.undoneAt) || !movedOk}
                    title={
                      entry.undoneAt
                        ? '이미 되돌렸습니다'
                        : !movedOk
                          ? '옮긴 것이 없어 되돌릴 게 없습니다'
                          : scanning
                            ? '스캔이 끝난 뒤에 되돌릴 수 있습니다'
                            : undefined
                    }
                  >
                    {busy ? <Loader2 className="animate-spin" /> : <Undo2 />}
                    실행취소
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
        {notice && <p className="text-muted-foreground">{notice}</p>}
        {error && <p className="text-destructive">{error}</p>}
      </CardContent>

      <Dialog
        open={target !== null}
        title="되돌릴까요?"
        onClose={() => setTarget(null)}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setTarget(null)}>
              취소
            </Button>
            <Button size="sm" onClick={() => void confirmUndo()}>
              되돌리기
            </Button>
          </>
        }
      >
        {target && (
          <div className="flex flex-col gap-2">
            <p>
              {formatDate(target.executedAt)}에 옮긴{' '}
              <b>{formatCount(target.results.filter((r) => r.ok).length)}개</b>를 원래 자리로 되돌립니다.
            </p>
            <p className="text-muted-foreground">
              옮긴 자리에 그대로 있고 원래 자리가 비어 있는 것만 되돌립니다. 그때 만든 폴더는 비어 있으면
              지우고, 무언가 들어 있으면 남깁니다. 되돌린 뒤에는 다시 스캔해야 계획을 세울 수 있습니다.
            </p>
          </div>
        )}
      </Dialog>
    </Card>
  )
}
