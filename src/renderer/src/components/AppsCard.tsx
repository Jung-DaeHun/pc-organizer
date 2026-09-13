import { type JSX } from 'react'
import { ChevronRight, Package, Power } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useApps } from '@/hooks/useApps'
import { summarizeApps } from '@/lib/appsView'
import { formatBytes, formatCount } from '@/lib/format'

const TOP_APPS = 6

interface AppsCardProps {
  /** 설치된 앱 화면(전체 목록 · 제거 안내)을 연다 */
  onOpenApps: () => void
}

export function AppsCard({ onOpenApps }: AppsCardProps): JSX.Element {
  const { info, error } = useApps()

  // 용량을 보고하지 않는 앱이 많아서, 합계는 '알려진 것만'이라는 걸 밝혀둔다
  const summary = info ? summarizeApps(info.apps) : null
  const topApps = info?.apps.filter((app) => app.sizeBytes > 0).slice(0, TOP_APPS) ?? []

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Package className="text-muted-foreground size-4" />
          <div>
            <CardTitle>설치된 앱</CardTitle>
            <CardDescription>
              {summary
                ? `${formatCount(summary.count)}개 · 확인된 용량 ${formatBytes(summary.knownSizeBytes)}`
                : error
                  ? '목록을 읽지 못했습니다'
                  : '레지스트리에서 읽는 중'}
            </CardDescription>
          </div>
        </div>

        {info && (
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Power className="size-3.5" />
            시작 프로그램 {formatCount(info.startup.length)}개
          </div>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-2">
        {error ? (
          <p className="text-muted-foreground text-xs">설치된 앱 목록을 읽지 못했습니다.</p>
        ) : info === null ? (
          <>
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/5" />
          </>
        ) : (
          <>
            <ul className="flex flex-col gap-1.5">
              {topApps.map((app) => (
                <li key={`${app.name}@${app.version}`} className="flex items-center gap-2 text-xs">
                  <span className="truncate" title={app.publisher || app.name}>
                    {app.name}
                  </span>
                  <span className="text-muted-foreground ml-auto shrink-0 tabular-nums">
                    {formatBytes(app.sizeBytes)}
                  </span>
                </li>
              ))}
            </ul>

            {info.apps.length > topApps.length && (
              <p className="text-muted-foreground text-[11px]">
                용량이 큰 {topApps.length}개만 표시 · 나머지{' '}
                {formatCount(info.apps.length - topApps.length)}개는 용량 정보가 없거나 더 작습니다
              </p>
            )}

            {/* 화면을 열 뿐이다. 제거는 그 화면이 열어 주는 윈도우 설정에서 사용자가 한다 */}
            <Button variant="outline" size="sm" className="self-start" onClick={onOpenApps}>
              전체 목록 · 제거 안내
              <ChevronRight />
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
