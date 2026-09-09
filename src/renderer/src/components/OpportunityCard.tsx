import type { JSX } from 'react'
import { Copy, Clock, Sparkles, Trash2, Weight } from 'lucide-react'
import type { Opportunities, OpportunityGroup } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatBytes, formatCount, truncatePath } from '@/lib/format'

interface OpportunityCardProps {
  opportunities: Opportunities | null
}

interface Row {
  key: string
  icon: JSX.Element
  label: string
  hint: string
  group: OpportunityGroup
  /** true면 사람이 하나씩 봐야 하는 항목. 확보 가능 용량에 더하지 않는다 */
  needsReview: boolean
}

export function OpportunityCard({ opportunities }: OpportunityCardProps): JSX.Element {
  const rows: Row[] = opportunities
    ? [
        {
          key: 'duplicates',
          icon: <Copy className="size-3.5" />,
          label: '중복 후보',
          // 앞부분만 비교한 결과라는 걸 화면에서도 분명히 해둔다
          hint: '크기와 앞부분이 같은 파일. 지우기 전 전체 비교 필요',
          group: opportunities.duplicates,
          needsReview: false
        },
        {
          key: 'temp',
          icon: <Trash2 className="size-3.5" />,
          label: '임시파일 · 휴지통',
          hint: '임시 폴더와 휴지통',
          group: opportunities.temp,
          needsReview: false
        },
        {
          key: 'large',
          icon: <Weight className="size-3.5" />,
          label: '대용량',
          hint: '100MB 이상',
          group: opportunities.large,
          needsReview: true
        },
        {
          key: 'old',
          icon: <Clock className="size-3.5" />,
          label: '오래된 파일',
          hint: '180일 넘게 손대지 않음',
          group: opportunities.old,
          needsReview: true
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

              {/*
                2단계에서 실제 정리 화면으로 이어질 자리.
                지금은 파일을 건드리는 기능이 하나도 없어 눌리지 않게 둔다.
              */}
              <Button variant="outline" size="sm" disabled title="2단계에서 열립니다">
                {row.needsReview ? '검토' : '정리'}
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}
