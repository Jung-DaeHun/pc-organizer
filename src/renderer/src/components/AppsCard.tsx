import { useEffect, useState, type JSX } from 'react'
import { Package, Power } from 'lucide-react'
import type { AppsInfo } from '@shared/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatBytes, formatCount } from '@/lib/format'

const TOP_APPS = 6

export function AppsCard(): JSX.Element {
  const [info, setInfo] = useState<AppsInfo | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true

    window.api
      .listApps()
      .then((next) => {
        if (alive) setInfo(next)
      })
      .catch((err: unknown) => {
        console.error('설치 앱 조회 실패', err)
        if (alive) setFailed(true)
      })

    return () => {
      alive = false
    }
  }, [])

  // 용량을 보고하지 않는 앱이 많아서, 합계는 '알려진 것만'이라는 걸 밝혀둔다
  const knownSizeTotal = info?.apps.reduce((sum, app) => sum + app.sizeBytes, 0) ?? 0
  const topApps = info?.apps.filter((app) => app.sizeBytes > 0).slice(0, TOP_APPS) ?? []

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Package className="text-muted-foreground size-4" />
          <div>
            <CardTitle>설치된 앱</CardTitle>
            <CardDescription>
              {info
                ? `${formatCount(info.apps.length)}개 · 확인된 용량 ${formatBytes(knownSizeTotal)}`
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
        {failed ? (
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
          </>
        )}
      </CardContent>
    </Card>
  )
}
