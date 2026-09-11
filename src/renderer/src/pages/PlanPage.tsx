import { useCallback, useMemo, useState, type JSX } from 'react'
import {
  ArrowLeft,
  File as FileIcon,
  Folder as FolderIcon,
  ListChecks,
  Loader2,
  Sparkles
} from 'lucide-react'
import { CATEGORY_LABELS, type AdvisorPreview, type PlanItem, type Settings } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog } from '@/components/ui/dialog'
import { Select } from '@/components/ui/select'
import type { ScanState } from '@/hooks/useScan'
import { usePlan } from '@/hooks/usePlan'
import { formatBytes, formatCount, formatDate, truncatePath } from '@/lib/format'

/** 표에 그리는 행 상한. 최상위 항목이라 보통 수십 개지만, 그래도 화면이 멈추지는 않게 */
const ROW_LIMIT = 2000

const KEEP = '' // select 에서 '그대로 두기' 를 뜻하는 값

interface PlanPageProps {
  scan: ScanState
  settings: Settings | null
  hasApiKey: boolean | null
  onBack: () => void
}

export default function PlanPage({ scan, settings, hasApiKey, onBack }: PlanPageProps): JSX.Element {
  const roots = useMemo(() => settings?.watchedFolders ?? [], [settings])
  // 사용자가 고르기 전에는 첫 감시 폴더. 설정이 늦게 와도 effect 없이 따라간다
  const [rootChoice, setRootChoice] = useState<string | null>(null)
  const root = rootChoice ?? roots[0] ?? ''
  const { plan, busy, error, edited, build, preview, advise, patchItem, clear } = usePlan()
  const [consent, setConsent] = useState<AdvisorPreview | null>(null)

  const scannedAt = scan.result?.scannedAt ?? 0
  const canBuild = Boolean(root) && scannedAt > 0 && !scan.isScanning && busy === null

  const onBuild = useCallback(() => {
    if (!canBuild) return
    void build(root, scannedAt)
  }, [build, canBuild, root, scannedAt])

  const onChangeRoot = useCallback(
    (next: string) => {
      setRootChoice(next)
      clear()
    },
    [clear]
  )

  const openConsent = useCallback(async () => {
    const summary = await preview()
    if (summary) setConsent(summary)
  }, [preview])

  const sendToAi = useCallback(async () => {
    setConsent(null)
    await advise()
  }, [advise])

  // 목적지 후보 = 제안 폴더 (root 바로 아래). 경로는 main 이 만든 것을 그대로 쓴다
  const destinations = useMemo(
    () => (plan ? plan.folders.map((f) => ({ name: f.name, dir: f.dir })) : []),
    [plan]
  )

  const stats = useMemo(() => {
    if (!plan) return null
    const moving = plan.items.filter((p) => p.approved && p.toDir)
    return {
      moving: moving.length,
      movingBytes: moving.reduce((sum, p) => sum + p.item.size, 0),
      staying: plan.items.length - moving.length,
      skipped: plan.skipped.length,
      newFolders: plan.folders.filter((f) => !f.existing).length
    }
  }, [plan])

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="대시보드로">
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold">정리 계획</h1>
          <p className="text-muted-foreground truncate text-xs">
            계획을 세우고 고치기만 합니다. 이 화면에서는 파일이 움직이지 않습니다.
          </p>
        </div>

        <Select
          value={root}
          onChange={(e) => onChangeRoot(e.target.value)}
          disabled={busy !== null}
          aria-label="정리할 폴더"
          className="max-w-64"
        >
          {roots.map((r) => (
            <option key={r} value={r}>
              {truncatePath(r, 40)}
            </option>
          ))}
        </Select>

        <Button variant="outline" onClick={onBuild} disabled={!canBuild}>
          {busy === 'build' ? <Loader2 className="animate-spin" /> : <ListChecks />}
          규칙으로 계획
        </Button>

        <Button
          onClick={() => void openConsent()}
          disabled={!plan || busy !== null || hasApiKey !== true}
          title={hasApiKey ? undefined : '대시보드에서 API 키를 먼저 저장하세요'}
        >
          {busy === 'advise' || busy === 'preview' ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Sparkles />
          )}
          AI 추천 받기
        </Button>
      </header>

      {scannedAt === 0 && (
        <div className="text-muted-foreground border-b px-6 py-2 text-xs">
          먼저 대시보드에서 스캔을 실행하세요. 계획은 스캔 결과를 바탕으로 세웁니다.
        </div>
      )}
      {error && <div className="text-destructive border-b px-6 py-2 text-xs">{error}</div>}

      <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
        {!plan ? (
          <p className="text-muted-foreground text-xs">
            &lsquo;규칙으로 계획&rsquo;을 누르면 확장자 기준의 초안이 생기고, 그 위에 AI 추천을 얹을 수 있습니다.
          </p>
        ) : (
          <>
            {stats && (
              <section className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
                <span className="font-medium">
                  옮길 항목 {formatCount(stats.moving)}개 · {formatBytes(stats.movingBytes)}
                </span>
                <span className="text-muted-foreground">그대로 {formatCount(stats.staying)}개</span>
                <span className="text-muted-foreground">제외 {formatCount(stats.skipped)}개</span>
                <span className="text-muted-foreground">새 폴더 {formatCount(stats.newFolders)}개</span>
                <span className="text-muted-foreground ml-auto">
                  {formatDate(plan.createdAt)} 기준
                </span>
              </section>
            )}

            {plan.folders.length > 0 && (
              <section className="flex flex-wrap gap-2">
                {plan.folders.map((f) => (
                  <span
                    key={f.name}
                    className="bg-secondary text-secondary-foreground inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs"
                    title={f.description || undefined}
                  >
                    <FolderIcon className="size-3.5" />
                    {f.name}
                    {f.existing && <span className="text-muted-foreground">(기존)</span>}
                  </span>
                ))}
              </section>
            )}

            <section className="overflow-x-auto rounded-xl border">
              {/*
                table-fixed: 이름이 긴 항목이 '이유' 열을 찌그러뜨리지 않게 열 너비를 고정한다.
                항목 열만 너비를 안 정해 나머지를 다 가져간다.
              */}
              <table className="w-full table-fixed text-xs">
                <thead className="text-muted-foreground bg-muted/40 text-left">
                  <tr>
                    <th className="w-10 px-3 py-2" />
                    <th className="px-2 py-2">항목</th>
                    <th className="w-24 px-2 py-2 text-right">크기</th>
                    <th className="w-44 px-2 py-2">목적지</th>
                    <th className="w-[30%] px-2 py-2">이유</th>
                    <th className="w-14 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {plan.items.slice(0, ROW_LIMIT).map((p) => (
                    <PlanRow
                      key={p.item.id}
                      planItem={p}
                      destinations={destinations}
                      disabled={busy !== null}
                      onPatch={patchItem}
                    />
                  ))}
                </tbody>
              </table>
              {plan.items.length > ROW_LIMIT && (
                <p className="text-muted-foreground border-t px-3 py-2 text-[11px]">
                  {formatCount(plan.items.length - ROW_LIMIT)}개는 표시하지 않았습니다.
                </p>
              )}
              {plan.items.length === 0 && (
                <p className="text-muted-foreground px-3 py-4 text-center text-xs">
                  정리할 항목이 없습니다.
                </p>
              )}
            </section>

            {plan.skipped.length > 0 && (
              <details className="rounded-xl border px-4 py-3 text-xs">
                <summary className="cursor-pointer select-none">
                  제외한 항목 {formatCount(plan.skipped.length)}개
                </summary>
                <ul className="mt-2 flex flex-col gap-1">
                  {plan.skipped.map((s) => (
                    <li key={s.path} className="flex gap-3">
                      <span className="selectable truncate" title={s.path}>
                        {s.name}
                      </span>
                      <span className="text-muted-foreground ml-auto shrink-0">{s.why}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <footer className="flex items-center justify-end gap-2 border-t pt-4">
              {/*
                B 단계에서 실행이 열리는 자리. 지금은 파일을 옮기는 채널 자체가 없다.
              */}
              <Button disabled title="다음 단계에서 열립니다">
                선택 항목 실행
              </Button>
            </footer>
          </>
        )}
      </main>

      <Dialog
        open={consent !== null}
        title="AI 에게 보낼 내용"
        onClose={() => setConsent(null)}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setConsent(null)}>
              취소
            </Button>
            <Button size="sm" onClick={() => void sendToAi()}>
              보내기
            </Button>
          </>
        }
      >
        {consent && (
          <div className="flex flex-col gap-3">
            <p>
              항목 {formatCount(consent.itemCount)}개의 <b>이름·종류·확장자·크기·수정일</b>만 Anthropic
              API 로 보냅니다. 파일 내용, 전체 경로, 사용자 이름은 보내지 않습니다.
            </p>
            <p className="text-muted-foreground">
              요청 {consent.chunkCount}회 · 입력 약 {formatCount(consent.approxInputTokens)} 토큰
            </p>
            <p className="text-muted-foreground">
              추천 결과는 규칙 초안 위에 얹힙니다.
              {edited && ' 지금 화면에서 고친 체크·목적지는 추천 결과로 대체됩니다.'}
            </p>
            {consent.sampleNames.length > 0 && (
              <div>
                <p className="text-muted-foreground mb-1">예를 들면</p>
                <ul className="bg-muted/40 max-h-40 overflow-y-auto rounded-md px-3 py-2 font-mono text-[11px]">
                  {consent.sampleNames.map((name) => (
                    <li key={name} className="truncate">
                      {name}
                    </li>
                  ))}
                  {consent.itemCount > consent.sampleNames.length && (
                    <li className="text-muted-foreground">
                      … 외 {formatCount(consent.itemCount - consent.sampleNames.length)}개
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  )
}

interface PlanRowProps {
  planItem: PlanItem
  destinations: { name: string; dir: string }[]
  disabled: boolean
  onPatch: (id: string, patch: Partial<Pick<PlanItem, 'approved' | 'toDir'>>) => void
}

function PlanRow({ planItem, destinations, disabled, onPatch }: PlanRowProps): JSX.Element {
  const { item, toDir, reason, origin, approved } = planItem
  const isDir = item.kind === 'dir'

  // 현재 목적지가 제안 폴더 목록에 없으면(예: 규칙 폴더가 AI 병합에서 빠짐) 목록에 임시로 보여준다
  const options = useMemo(() => {
    if (toDir && !destinations.some((d) => d.dir === toDir)) {
      return [...destinations, { name: baseName(toDir), dir: toDir }]
    }
    return destinations
  }, [destinations, toDir])

  return (
    <tr className="hover:bg-accent/50 border-t">
      <td className="px-3 py-1.5">
        <Checkbox
          checked={approved && toDir !== null}
          disabled={disabled || toDir === null}
          onChange={(e) => onPatch(item.id, { approved: e.target.checked })}
          aria-label={`${item.name} 실행 대상`}
        />
      </td>
      <td className="overflow-hidden px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          {isDir ? (
            <FolderIcon className="text-muted-foreground size-3.5 shrink-0" />
          ) : (
            <FileIcon className="text-muted-foreground size-3.5 shrink-0" />
          )}
          <span className="selectable truncate" title={item.path}>
            {item.name}
          </span>
          <span className="text-muted-foreground shrink-0 text-[11px]">
            {isDir ? `${formatCount(item.fileCount ?? 0)}개` : CATEGORY_LABELS[item.category]}
          </span>
        </div>
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">{formatBytes(item.size)}</td>
      <td className="px-2 py-1.5">
        <Select
          value={toDir ?? KEEP}
          disabled={disabled}
          onChange={(e) => {
            const next = e.target.value === KEEP ? null : e.target.value
            onPatch(item.id, { toDir: next, approved: next !== null })
          }}
          aria-label={`${item.name} 목적지`}
          className="w-full"
        >
          <option value={KEEP}>그대로 두기</option>
          {options.map((d) => (
            <option key={d.dir} value={d.dir}>
              {d.name}
            </option>
          ))}
        </Select>
      </td>
      <td className="text-muted-foreground px-2 py-1.5">
        <span className="line-clamp-2" title={reason}>
          {reason}
        </span>
      </td>
      <td className="px-2 py-1.5">
        <span
          className={
            origin === 'ai'
              ? 'bg-primary text-primary-foreground rounded px-1.5 py-0.5 text-[10px]'
              : 'bg-secondary text-secondary-foreground rounded px-1.5 py-0.5 text-[10px]'
          }
        >
          {origin === 'ai' ? 'AI' : '규칙'}
        </span>
      </td>
    </tr>
  )
}

/** 표시용. renderer 는 경로를 조립하지 않고 main 이 준 경로에서 이름만 뽑는다 */
function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}
