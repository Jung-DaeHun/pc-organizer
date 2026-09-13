import { useMemo, useState, type JSX } from 'react'
import { ArrowLeft, ExternalLink, Loader2, Package, Power, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import type { AppsState } from '@/hooks/useApps'
import {
  APP_SORTS,
  APP_SORT_LABELS,
  filterApps,
  parseInstallDate,
  sortApps,
  summarizeApps,
  type AppSort
} from '@/lib/appsView'
import { errorMessage, formatBytes, formatCount, formatDate } from '@/lib/format'

interface AppsPageProps {
  /** App 이 한 번 읽어 내려보낸 목록. '다시 읽기'는 여기의 refresh */
  apps: AppsState
  onBack: () => void
}

const INPUT_CLASS =
  'bg-background border-input h-7 w-56 rounded-md border py-1 pr-2 pl-7 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'

/**
 * 설치된 앱 화면 — 제거 안내.
 *
 * 목록은 main 이 '프로그램 추가/제거'와 같은 레지스트리 키를 **읽은** 것이고, 이 화면은 검색·정렬로 훑어보게
 * 할 뿐이다. 제거는 이 앱이 하지 않는다: 오른쪽 위 버튼이 윈도우 설정의 '앱 > 설치된 앱'을 열어 주면 거기서
 * 사용자가 한다. 어떤 앱을 지우라고 고르지도 않는다 — 오래 전에 설치했다고 안 쓰는 앱이 아니고 크다고
 * 지워도 되는 앱이 아니라, 용량과 설치일을 그대로 보여주고 판단은 사용자에게 둔다.
 */
export default function AppsPage({ apps, onBack }: AppsPageProps): JSX.Element {
  const { info, loading, error, refresh } = apps
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<AppSort>('size')
  const [openError, setOpenError] = useState<string | null>(null)

  const summary = useMemo(() => (info ? summarizeApps(info.apps) : null), [info])
  const rows = useMemo(
    () => (info ? sortApps(filterApps(info.apps, query), sort) : []),
    [info, query, sort]
  )

  const openSettings = async (): Promise<void> => {
    setOpenError(null)
    try {
      await window.api.openAppsSettings()
    } catch (err) {
      setOpenError(errorMessage(err, '윈도우 설정을 열지 못했습니다'))
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="대시보드로">
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold">설치된 앱</h1>
          <p className="text-muted-foreground truncate text-xs">
            {summary
              ? `${formatCount(summary.count)}개 · 확인된 용량 ${formatBytes(summary.knownSizeBytes)}` +
                (summary.unknownSizeCount > 0
                  ? ` · 용량 정보 없음 ${formatCount(summary.unknownSizeCount)}개`
                  : '') +
                (info ? ` · 시작 프로그램 ${formatCount(info.startup.length)}개` : '')
              : loading
                ? '레지스트리에서 읽는 중'
                : '목록을 읽지 못했습니다'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="다시 읽기"
            title="다시 읽기 — 윈도우 설정에서 제거하고 돌아왔을 때"
          >
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          </Button>
          {/* 제거는 여기서 하지 않는다. 윈도우 설정을 열어 줄 뿐이고 URI 는 main 에 고정돼 있다 */}
          <Button variant="outline" onClick={() => void openSettings()}>
            <ExternalLink />
            윈도우 설정에서 제거
          </Button>
        </div>
      </header>

      {(error || openError) && (
        <div className="text-destructive border-b px-6 py-2 text-xs">{error ?? openError}</div>
      )}

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          <p className="text-muted-foreground bg-muted/40 rounded-md border px-3 py-2 text-xs">
            이 앱은 프로그램을 제거하지 않습니다. 제거는 윈도우 설정 &gt; 앱 &gt; 설치된 앱에서 합니다. 목록은
            &lsquo;프로그램 추가/제거&rsquo;가 읽는 레지스트리 기준이라 Microsoft Store 앱은 없고, 용량은 각 앱이
            스스로 등록한 추정치라 없거나 실제와 다를 수 있습니다.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="이름 · 게시자 검색"
                aria-label="앱 검색"
                className={INPUT_CLASS}
              />
            </label>
            <Select
              value={sort}
              onChange={(e) => setSort(e.target.value as AppSort)}
              aria-label="정렬"
            >
              {APP_SORTS.map((key) => (
                <option key={key} value={key}>
                  {APP_SORT_LABELS[key]}
                </option>
              ))}
            </Select>
            {info && (
              <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                {query.trim() ? `${formatCount(rows.length)}개 일치` : `${formatCount(rows.length)}개`}
              </span>
            )}
          </div>

          {info === null ? (
            loading ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-4/5" />
              </div>
            ) : (
              <p className="text-muted-foreground flex items-center gap-2 text-xs">
                <Package className="size-3.5" />
                설치된 앱 목록을 읽지 못했습니다.
              </p>
            )
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {query.trim() ? `'${query.trim()}'에 해당하는 앱이 없습니다.` : '설치된 앱이 없습니다.'}
            </p>
          ) : (
            <div className="rounded-md border">
              <div className="text-muted-foreground grid grid-cols-[minmax(0,1fr)_7rem_6rem_6rem] gap-3 border-b px-3 py-1.5 text-[11px]">
                <span>이름 · 게시자</span>
                <span>버전</span>
                <span className="text-right">설치일</span>
                <span className="text-right">용량</span>
              </div>
              <ul>
                {rows.map((app) => {
                  const installedAt = parseInstallDate(app.installDate)
                  return (
                    <li
                      key={`${app.name}@${app.version}`}
                      className="hover:bg-accent grid grid-cols-[minmax(0,1fr)_7rem_6rem_6rem] items-center gap-3 border-b px-3 py-1.5 text-xs last:border-b-0"
                    >
                      <div className="min-w-0">
                        <div className="truncate" title={app.installLocation || app.name}>
                          {app.name}
                        </div>
                        {app.publisher && (
                          <div className="text-muted-foreground truncate text-[11px]">
                            {app.publisher}
                          </div>
                        )}
                      </div>
                      <span className="text-muted-foreground truncate tabular-nums" title={app.version}>
                        {app.version || '-'}
                      </span>
                      <span className="text-muted-foreground text-right tabular-nums">
                        {installedAt === null ? '-' : formatDate(installedAt)}
                      </span>
                      <span className="text-right tabular-nums">
                        {app.sizeBytes > 0 ? formatBytes(app.sizeBytes) : '-'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {/* 시작 프로그램은 개수만 센다. 켜고 끄기는 레지스트리에 써야 해서 이 앱의 범위 밖이다 (CLAUDE.md) */}
          {info && info.startup.length > 0 && (
            <p className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
              <Power className="size-3.5" />
              시작 프로그램 {formatCount(info.startup.length)}개. 켜고 끄기는 이 앱에서 하지 않습니다 — 작업
              관리자의 &lsquo;시작 앱&rsquo;에서 합니다.
            </p>
          )}
        </div>
      </main>
    </div>
  )
}
