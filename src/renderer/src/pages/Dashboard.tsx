import { useCallback, useEffect, useState, type JSX } from 'react'
import { ListChecks, Loader2, ScanLine } from 'lucide-react'
import type { DriveInfo, Settings } from '@shared/types'
import { Button } from '@/components/ui/button'
import { ApiKeyCard } from '@/components/ApiKeyCard'
import { AppsCard } from '@/components/AppsCard'
import { DriveCard } from '@/components/DriveCard'
import { FolderSummaryCard } from '@/components/FolderSummaryCard'
import { OpportunityCard } from '@/components/OpportunityCard'
import { RecentRunCard } from '@/components/RecentRunCard'
import type { ScanState } from '@/hooks/useScan'
import { formatCount, truncatePath } from '@/lib/format'

interface DashboardProps {
  scan: ScanState
  settings: Settings | null
  onSettingsChange: (settings: Settings) => void
  hasApiKey: boolean | null
  onApiKeyChange: (hasKey: boolean) => void
  onOpenPlan: () => void
  /** 중복 후보 정리 화면 (읽기 전용 목록). 스캔 결과가 있어야 연다 */
  onOpenTrash: () => void
}

export default function Dashboard({
  scan,
  settings,
  onSettingsChange,
  hasApiKey,
  onApiKeyChange,
  onOpenPlan,
  onOpenTrash
}: DashboardProps): JSX.Element {
  const [drives, setDrives] = useState<DriveInfo[] | null>(null)
  const { result, progress, isScanning, error, run, invalidate } = scan

  useEffect(() => {
    let alive = true

    window.api
      .listDrives()
      .then((next) => {
        if (alive) setDrives(next)
      })
      .catch((err: unknown) => console.error('드라이브 조회 실패', err))

    return () => {
      alive = false
    }
  }, [])

  const addFolder = useCallback(async () => {
    const picked = await window.api.pickFolder()
    if (!picked || !settings) return
    if (settings.watchedFolders.includes(picked)) return

    onSettingsChange(
      await window.api.updateSettings({ watchedFolders: [...settings.watchedFolders, picked] })
    )
  }, [settings, onSettingsChange])

  const removeFolder = useCallback(
    async (path: string) => {
      if (!settings) return
      onSettingsChange(
        await window.api.updateSettings({
          watchedFolders: settings.watchedFolders.filter((f) => f !== path)
        })
      )
    },
    [settings, onSettingsChange]
  )

  const canScan = !isScanning && (settings?.watchedFolders.length ?? 0) > 0
  const canPlan = !isScanning && result !== null

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-6 py-4">
        <div className="min-w-0">
          <h1 className="text-base font-semibold">PC 정리 도구</h1>
          <p className="text-muted-foreground truncate text-xs">
            {isScanning && progress
              ? `${formatCount(progress.filesSeen)}개 확인 중 · ${truncatePath(progress.currentDir, 46)}`
              : isScanning
                ? '스캔을 시작하는 중'
                : result
                  ? `파일 ${formatCount(result.totalFiles)}개를 ${(result.durationMs / 1000).toFixed(1)}초에 훑었습니다`
                  : '등록된 폴더를 훑어 정리할 거리를 찾습니다'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={onOpenPlan}
            disabled={!canPlan}
            title={canPlan ? undefined : '스캔한 뒤에 계획을 세울 수 있습니다'}
          >
            <ListChecks />
            정리 계획
          </Button>
          <Button onClick={() => void run()} disabled={!canScan}>
            {isScanning ? <Loader2 className="animate-spin" /> : <ScanLine />}
            {isScanning ? '스캔 중' : '스캔'}
          </Button>
        </div>
      </header>

      {error && (
        <div className="text-destructive border-b px-6 py-2 text-xs">스캔 실패: {error}</div>
      )}

      <main className="grid flex-1 grid-cols-1 content-start items-start gap-4 overflow-y-auto p-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <DriveCard drives={drives} />
          <AppsCard />
          <ApiKeyCard hasKey={hasApiKey} onChange={onApiKeyChange} />
        </div>

        <div className="flex flex-col gap-4">
          <FolderSummaryCard
            settings={settings}
            result={result}
            isScanning={isScanning}
            onAddFolder={() => void addFolder()}
            onRemoveFolder={(path) => void removeFolder(path)}
          />
          <OpportunityCard
            opportunities={result?.opportunities ?? null}
            settings={settings}
            onOpenTrash={canPlan ? onOpenTrash : null}
          />
          <RecentRunCard scanning={isScanning} onFilesMoved={invalidate} />
        </div>
      </main>
    </div>
  )
}
