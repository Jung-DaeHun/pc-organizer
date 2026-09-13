import type { JSX } from 'react'
import { Copy, Clock, Sparkles, Trash2, Weight } from 'lucide-react'
import type { Opportunities, OpportunityGroup, Settings } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatBytes, formatCount, truncatePath } from '@/lib/format'

interface OpportunityCardProps {
  opportunities: Opportunities | null
  /** 대용량·오래된 파일의 기준값. 힌트 문구가 실제 판정 기준과 어긋나지 않게 */
  settings: Settings | null
  /** 중복 후보 정리 화면을 연다. null 이면 열 수 없는 상태(스캔 전·스캔 중) */
  onOpenTrash: (() => void) | null
}

interface Row {
  key: string
  icon: JSX.Element
  label: string
  hint: string
  group: OpportunityGroup
  /** true면 사람이 하나씩 봐야 하는 항목. 확보 가능 용량에 더하지 않는다 */
  needsReview: boolean
  /** 이 행의 정리 화면. 아직 없는 행은 null (버튼이 눌리지 않는다) */
  open: (() => void) | null
}

export function OpportunityCard({
  opportunities,
  settings,
  onOpenTrash
}: OpportunityCardProps): JSX.Element {
  const largeHint = settings ? `${formatBytes(settings.largeFileBytes, 0)} 이상` : '기준 크기 이상'
  const oldHint = settings ? `${settings.oldFileDays}일 넘게 손대지 않음` : '오래 손대지 않음'

  const rows: Row[] = opportunities
    ? [
        {
          key: 'duplicates',
          icon: <Copy className="size-3.5" />,
          label: '중복 후보',
          // 앞부분만 비교한 결과라는 걸 화면에서도 분명히 해둔다
          hint: '크기와 앞부분이 같은 파일. 지우기 전 전체 비교 필요',
          group: opportunities.duplicates,
          needsReview: false,
          // 후보가 하나도 없으면 열어도 빈 화면이다
          open: opportunities.duplicates.count > 0 ? onOpenTrash : null
        },
        {
          key: 'temp',
          icon: <Trash2 className="size-3.5" />,
          label: '임시파일 · 휴지통',
          hint: '임시 폴더와 휴지통',
          group: opportunities.temp,
          needsReview: false,
          open: null
        },
        {
          key: 'large',
          icon: <Weight className="size-3.5" />,
          label: '대용량',
          hint: largeHint,
          group: opportunities.large,
          needsReview: true,
          open: null
        },
        {
          key: 'old',
          icon: <Clock className="size-3.5" />,
          label: '오래된 파일',
          hint: oldHint,
          group: opportunities.old,
          needsReview: true,
          open: null
        }
      ]
    : []

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="text-muted-foreground size-4" />
          <div>
            <CardTitle>정리 기회</CardTitle>
            <CardDescription>
              {opportunities ? (
                <>
                  바로 확보 {formatBytes(opportunities.reclaimableBytes)} · 검토 대상{' '}
                  {formatBytes(opportunities.reviewBytes)}
                </>
              ) : (
                '스캔하면 확보 가능한 용량을 계산합니다'
              )}
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-1">
        {opportunities === null ? (
          <>
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </>
        ) : (
          rows.map((row) => (
            <div
              key={row.key}
              className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent"
            >
              <span className="text-muted-foreground">{row.icon}</span>

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium">{row.label}</span>
                  <span className="text-muted-foreground truncate text-[11px]">{row.hint}</span>
                </div>

                {row.group.samples.length > 0 && (
                  <p
                    className="text-muted-foreground truncate text-[11px]"
                    title={row.group.samples[0].path}
                  >
                    예: {truncatePath(row.group.samples[0].name, 36)}
                  </p>
                )}
              </div>

              <div className="shrink-0 text-right">
                <div className="text-xs font-medium tabular-nums">
                  {formatBytes(row.group.bytes)}
                </div>
                <div className="text-muted-foreground text-[11px] tabular-nums">
                  {formatCount(row.group.count)}개
                </div>
              </div>

              {/* 정리 화면이 있는 행만 눌린다. 화면을 열 뿐 — 파일은 그 화면에서 확인한 뒤에야 움직인다 */}
              <Button
                variant="outline"
                size="sm"
                disabled={row.open === null}
                onClick={row.open ?? undefined}
                title={
                  row.open
                    ? undefined
                    : row.group.count === 0
                      ? '해당하는 파일이 없습니다'
                      : '다음 단계에서 열립니다'
                }
              >
                {row.needsReview ? '검토' : '정리'}
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}
