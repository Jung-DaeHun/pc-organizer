import { useCallback, useEffect, useState, type JSX } from 'react'
import { Loader2, ScanLine } from 'lucide-react'
import type { DriveInfo, Settings } from '@shared/types'
import { Button } from '@/components/ui/button'
import { AppsCard } from '@/components/AppsCard'
import { DriveCard } from '@/components/DriveCard'
import { FolderSummaryCard } from '@/components/FolderSummaryCard'
import { OpportunityCard } from '@/components/OpportunityCard'
import { useScan } from '@/hooks/useScan'
import { formatCount, truncatePath } from '@/lib/format'

export default function Dashboard(): JSX.Element {
  const [drives, setDrives] = useState<DriveInfo[] | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)

  const { result, progress, isScanning, error, run } = useScan()

  useEffect(() => {
    let alive = true

    void window.api.listDrives().then((next) => {
      if (alive) setDrives(next)
    })
    void window.api.getSettings().then((next) => {
      if (alive) setSettings(next)
    })

    return () => {
      alive = false
    }
  }, [])

  const addFolder = useCallback(async () => {
    const picked = await window.api.pickFolder()
    if (!picked || !settings) return
    if (settings.watchedFolders.includes(picked)) return

    setSettings(
      await window.api.updateSettings({ watchedFolders: [...settings.watchedFolders, picked] })
    )
  }, [settings])

  const removeFolder = useCallback(
    async (path: string) => {
      if (!settings) return
      setSettings(
        await window.api.updateSettings({
          watchedFolders: settings.watchedFolders.filter((f) => f !== path)
        })
      )
    },
    [settings]
  )

  const canScan = !isScanning && (settings?.watchedFolders.length ?? 0) > 0

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

        <Button onClick={() => void run()} disabled={!canScan}>
          {isScanning ? <Loader2 className="animate-spin" /> : <ScanLine />}
          {isScanning ? '스캔 중' : '스캔'}
        </Button>
      </header>

      {error && (
        <div className="text-destructive border-b px-6 py-2 text-xs">스캔 실패: {error}</div>
      )}

      <main className="grid flex-1 grid-cols-1 content-start items-start gap-4 overflow-y-auto p-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <DriveCard drives={drives} />
          <AppsCard />
        </div>

        <div className="flex flex-col gap-4">
          <FolderSummaryCard
            settings={settings}
            result={result}
            isScanning={isScanning}
            onAddFolder={() => void addFolder()}
            onRemoveFolder={(path) => void removeFolder(path)}
          />
          <OpportunityCard opportunities={result?.opportunities ?? null} />
        </div>
      </main>
    </div>
  )
}
