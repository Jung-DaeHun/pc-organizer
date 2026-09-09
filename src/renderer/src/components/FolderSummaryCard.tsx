import type { JSX } from 'react'
import { FolderPlus, FolderOpen, X } from 'lucide-react'
import type { ScanResult, Settings } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CategoryChart } from '@/components/CategoryChart'
import { formatBytes, formatCount, truncatePath } from '@/lib/format'

interface FolderSummaryCardProps {
  settings: Settings | null
  result: ScanResult | null
  isScanning: boolean
  onAddFolder: () => void
  onRemoveFolder: (path: string) => void
}

export function FolderSummaryCard({
  settings,
  result,
  isScanning,
  onAddFolder,
  onRemoveFolder
}: FolderSummaryCardProps): JSX.Element {
  const folderStats = new Map(result?.folders.map((f) => [f.path, f]) ?? [])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <FolderOpen className="text-muted-foreground size-4" />
          <div>
            <CardTitle>감시 폴더</CardTitle>
            <CardDescription>
              {result
                ? `파일 ${formatCount(result.totalFiles)}개 · ${formatBytes(result.totalBytes)}`
                : '스캔하면 이 폴더들의 현황을 계산합니다'}
            </CardDescription>
          </div>
        </div>

        <Button variant="outline" size="sm" onClick={onAddFolder} disabled={isScanning}>
          <FolderPlus />
          폴더 추가
        </Button>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {settings === null ? (
          <Skeleton className="h-16 w-full" />
        ) : settings.watchedFolders.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            등록된 폴더가 없습니다. &lsquo;폴더 추가&rsquo;로 정리할 폴더를 지정해 주세요.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {settings.watchedFolders.map((path) => {
              const stats = folderStats.get(path)

              return (
                <li
                  key={path}
                  className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent"
                >
                  <span className="selectable truncate" title={path}>
                    {truncatePath(path, 40)}
                  </span>

                  <span className="text-muted-foreground ml-auto shrink-0 tabular-nums">
                    {stats
                      ? `${formatCount(stats.fileCount)}개 · ${formatBytes(stats.totalBytes)}`
                      : '-'}
                  </span>

                  {stats && stats.skippedCount > 0 && (
                    <span
                      className="text-muted-foreground shrink-0"
                      title="권한이 없거나 링크여서 건너뛴 항목"
                    >
                      (건너뜀 {formatCount(stats.skippedCount)})
                    </span>
                  )}

                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-5 shrink-0 opacity-0 group-hover:opacity-100"
                    disabled={isScanning}
                    onClick={() => onRemoveFolder(path)}
                    aria-label={`${path} 제거`}
                  >
                    <X className="size-3" />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}

        <div className="border-t pt-4">
          {result ? (
            <CategoryChart breakdown={result.byCategory} totalBytes={result.totalBytes} />
          ) : (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-2.5 w-full" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
