import { useCallback, useEffect, useState, type JSX } from 'react'
import { ListChecks, Loader2, ScanLine, Settings as SettingsIcon } from 'lucide-react'
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
  /** 설정 화면 (테마 · 분류 규칙 · 판정 기준) */
  onOpenSettings: () => void
  /** 설치된 앱 화면 (전체 목록 · 제거 안내 — 제거는 윈도우 설정에서) */
  onOpenApps: () => void
}

export default function Dashboard({
  scan,
  settings,
  onSettingsChange,
  hasApiKey,
  onApiKeyChange,
  onOpenPlan,
  onOpenTrash,
  onOpenSettings,
  onOpenApps
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
          <Button variant="ghost" size="icon" onClick={onOpenSettings} aria-label="설정" title="설정">
            <SettingsIcon />
          </Button>
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

      {/*
        3열 (wide, 기본 창 크기부터): 드라이브 용량 | 감시 폴더 | 정리 기회 — 위 줄이 현황, 아래 줄(설치된 앱 | 최근 실행 |
        AI 추천)이 부가. 열마다 카드를 세로로 붙여 쌓는다 (한 줄로 묶으면 짧은 카드 아래가 비어 보인다).
        2열 (창을 줄였을 때, 최소 창 폭 1024): 열 셋 중 마지막이 아래로 접힌다. DOM 순서를 감시 폴더 → 정리 기회 →
        드라이브로 두고 wide 에서만 order 로 드라이브를 앞에 세워, 접혔을 때 아래로 가는 건 정리 흐름이 아니라 현황이다
      */}
      <main className="grid flex-1 grid-cols-2 content-start items-start gap-4 overflow-y-auto p-6 wide:grid-cols-3">
        <div className="flex flex-col gap-4 wide:order-2">
          <FolderSummaryCard
            settings={settings}
            result={result}
            isScanning={isScanning}
            onAddFolder={() => void addFolder()}
            onRemoveFolder={(path) => void removeFolder(path)}
          />
          <RecentRunCard scanning={isScanning} onFilesMoved={invalidate} />
        </div>

        <div className="flex flex-col gap-4 wide:order-3">
          <OpportunityCard
            opportunities={result?.opportunities ?? null}
            onOpenTrash={canPlan ? onOpenTrash : null}
          />
          <ApiKeyCard hasKey={hasApiKey} onChange={onApiKeyChange} />
        </div>

        <div className="flex flex-col gap-4 wide:order-1">
          <DriveCard drives={drives} />
          <AppsCard onOpenApps={onOpenApps} />
        </div>
      </main>
    </div>
  )
}
