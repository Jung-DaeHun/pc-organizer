import type * as React from 'react'
import { HardDrive } from 'lucide-react'
import type { DriveInfo } from '@shared/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ProgressBar } from '@/components/ui/progress-bar'
import { Skeleton } from '@/components/ui/skeleton'
import { formatBytes, formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'

interface DriveCardProps {
  drives: DriveInfo[] | null
}

/** 여유 공간이 얼마 안 남았으면 막대 색으로 먼저 알린다 */
function usageTone(usedRatio: number): { bar: string; text: string } {
  if (usedRatio >= 0.9) return { bar: 'bg-red-500', text: 'text-red-400' }
  if (usedRatio >= 0.75) return { bar: 'bg-amber-500', text: 'text-amber-400' }
  return { bar: 'bg-sky-500', text: 'text-muted-foreground' }
}

export function DriveCard({ drives }: DriveCardProps): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <HardDrive className="text-muted-foreground size-4" />
          <CardTitle>드라이브 용량</CardTitle>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {drives === null ? (
          <>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </>
        ) : drives.length === 0 ? (
          <p className="text-muted-foreground text-xs">드라이브 정보를 읽지 못했습니다.</p>
        ) : (
          drives.map((drive) => {
            const usedBytes = drive.totalBytes - drive.freeBytes
            const usedRatio = drive.totalBytes > 0 ? usedBytes / drive.totalBytes : 0
            const tone = usageTone(usedRatio)

            return (
              <div key={drive.letter} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">
                    {drive.letter}
                    {drive.label && (
                      <span className="text-muted-foreground ml-1.5 font-normal">
                        {drive.label}
                      </span>
                    )}
                  </span>
                  <span className={cn('text-xs tabular-nums', tone.text)}>
                    {formatPercent(usedRatio)} 사용
                  </span>
                </div>

                <ProgressBar value={usedRatio} indicatorClassName={tone.bar} />

                <div className="text-muted-foreground flex justify-between text-xs tabular-nums">
                  <span>여유 {formatBytes(drive.freeBytes)}</span>
                  <span>전체 {formatBytes(drive.totalBytes)}</span>
                </div>
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
