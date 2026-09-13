import { useEffect, useMemo, type JSX } from 'react'
import { ArrowLeft, Copy, Loader2, Trash2 } from 'lucide-react'
import { TrashGroupCard } from '@/components/trash/TrashGroupCard'
import { Button } from '@/components/ui/button'
import type { ScanState } from '@/hooks/useScan'
import { useTrash } from '@/hooks/useTrash'
import { formatBytes, formatCount, formatDate } from '@/lib/format'
import { summarize } from '@/lib/trashEdit'

interface TrashPageProps {
  scan: ScanState
  onBack: () => void
}

/**
 * 중복 후보 정리 화면. 그룹마다 남길 파일 하나를 고르고 나머지를 휴지통 대상으로 본다.
 *
 * 이 화면은 읽기 전용이다 — 목록은 스캔이 이미 계산한 그룹이라 파일을 읽지 않고, 무엇을 고르든 파일은
 * 움직이지 않는다. 지우는 건 하단 버튼 → 확인 다이얼로그 → 전체 해시 재검증 뒤의 일이다(B3 3번 커밋).
 */
export default function TrashPage({ scan, onBack }: TrashPageProps): JSX.Element {
  const { plan, busy, error, build, chooseKeeper, include, includeAll } = useTrash()
  const scannedAt = scan.result?.scannedAt ?? 0

  // 들어오면 바로 만든다 — 비용이 없고(파일을 읽지 않는다) 사용자가 고를 게 이 목록뿐이다
  useEffect(() => {
    if (scannedAt > 0) void build(scannedAt)
  }, [build, scannedAt])

  const stats = useMemo(() => (plan ? summarize(plan) : null), [plan])

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
          먼저 대시보드에서 스캔을 실행하세요. 목록은 스캔 결과에서 나옵니다.
        </div>
      )}
      {error && <div className="text-destructive border-b px-6 py-2 text-xs">{error}</div>}

      <main className="flex min-h-0 flex-1 flex-col gap-3 p-6">
        {busy && !plan ? (
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
                  disabled={busy || stats.includedGroups === stats.groups}
                >
                  전부 포함
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => includeAll(false)}
                  disabled={busy || stats.includedGroups === 0}
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
                  disabled={busy}
                  onChooseKeeper={chooseKeeper}
                  onInclude={include}
                />
              ))}
            </div>

            <footer className="flex items-center justify-end gap-2 border-t pt-3">
              <span className="text-muted-foreground mr-auto text-xs">
                남길 파일은 라디오로 바꿀 수 있습니다. 기본값은 가장 최근에 손댄 사본입니다.
              </span>
              {/*
                여기서는 확인 다이얼로그만 열 예정이다. 실제로 보내는 건 다이얼로그에서 한 번 더 누른 뒤.
                휴지통 채널이 아직 없어 눌리지 않게 둔다 (B3 3번 커밋).
              */}
              <Button variant="destructive" disabled title="다음 단계에서 열립니다">
                <Trash2 />
                휴지통으로 보내기 ({formatCount(stats.files)}개 · {formatBytes(stats.bytes)})
              </Button>
            </footer>
          </>
        )}
      </main>
    </div>
  )
}
