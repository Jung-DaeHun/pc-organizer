import { useCallback, useMemo, useState, type JSX } from 'react'
import { ArrowLeft, ListChecks, Loader2, Play, Sparkles } from 'lucide-react'
import type { AdvisorPreview, Settings, UndoEntry } from '@shared/types'
import { CardFieldsMenu } from '@/components/plan/CardFieldsMenu'
import { ExecuteDialog, type ExecuteState } from '@/components/plan/ExecuteDialog'
import { KanbanBoard } from '@/components/plan/KanbanBoard'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Select } from '@/components/ui/select'
import { useCardFields } from '@/hooks/useCardFields'
import { usePlan } from '@/hooks/usePlan'
import type { ScanState } from '@/hooks/useScan'
import { useUndo } from '@/hooks/useUndo'
import { formatBytes, formatCount, formatDate, truncatePath } from '@/lib/format'
import { summarize, toExecuteRequests } from '@/lib/planEdit'

interface PlanPageProps {
  scan: ScanState
  settings: Settings | null
  hasApiKey: boolean | null
  onBack: () => void
}

/**
 * 정리 계획 화면. 폴더 = 열, 항목 = 카드인 칸반 판이다.
 * 판에서는 계획을 세우고 고치기만 한다. 파일이 움직이는 건 푸터의 '실행' → 확인 다이얼로그에서
 * 사용자가 한 번 더 누른 뒤이고, 그 뒤에는 스캔 결과가 낡아 다시 스캔해야 한다.
 */
export default function PlanPage({ scan, settings, hasApiKey, onBack }: PlanPageProps): JSX.Element {
  const roots = useMemo(() => settings?.watchedFolders ?? [], [settings])
  // 사용자가 고르기 전에는 첫 감시 폴더. 설정이 늦게 와도 effect 없이 따라간다
  const [rootChoice, setRootChoice] = useState<string | null>(null)
  const root = rootChoice ?? roots[0] ?? ''

  const {
    plan,
    busy,
    error,
    progress,
    edited,
    build,
    preview,
    advise,
    execute,
    moveItems,
    addFolder,
    renameFolder,
    removeFolder,
    keepAll,
    clear
  } = usePlan()
  const [fields, setField] = useCardFields()
  const [consent, setConsent] = useState<AdvisorPreview | null>(null)
  const [exec, setExec] = useState<ExecuteState | null>(null)
  const undoState = useUndo()

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

  const stats = useMemo(() => (plan ? summarize(plan) : null), [plan])

  // ---------------------------------------------------------------- 실행

  const openExecute = useCallback(() => {
    if (plan) setExec({ phase: 'confirm', plan })
  }, [plan])

  const confirmExecute = useCallback(async () => {
    if (!plan) return
    setExec({ phase: 'running' })
    const outcome = await execute(toExecuteRequests(plan))
    if (!outcome) {
      // 호출 자체가 실패했다 (usePlan 의 error 에 문장이 있다). 아무것도 안 움직였으니 확인 화면으로
      setExec({ phase: 'confirm', plan })
      return
    }
    if (outcome.status === 'blocked') {
      setExec({ phase: 'blocked', problems: outcome.problems })
      return
    }
    // 파일이 움직였다. 대시보드의 스캔 결과도 더는 맞지 않는다
    scan.invalidate()
    setExec({ phase: 'done', entry: outcome.entry, journalError: outcome.journalError })
  }, [plan, execute, scan])

  const undoFromDialog = useCallback(
    async (entry: UndoEntry) => {
      // 기록 저장 실패 경고는 되돌리기가 실패해 결과 화면으로 돌아와도 그대로 보여야 한다
      const journalError = exec?.phase === 'done' ? exec.journalError : undefined
      setExec({ phase: 'undoing', entry, journalError })
      const outcome = await undoState.undo(entry.id)
      setExec(outcome ? { phase: 'undone', outcome } : { phase: 'done', entry, journalError })
    },
    [undoState, exec]
  )

  const rescan = useCallback(() => {
    setExec(null)
    onBack()
    void scan.run()
  }, [onBack, scan])

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="대시보드로">
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold">정리 계획</h1>
          <p className="text-muted-foreground truncate text-xs">
            카드를 폴더 열로 끌어 정리합니다. 아래 &lsquo;실행&rsquo;을 누르고 확인하기 전까지 파일은 움직이지 않습니다.
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

        <CardFieldsMenu fields={fields} onChange={setField} />
      </header>

      {scannedAt === 0 && (
        <div className="text-muted-foreground border-b px-6 py-2 text-xs">
          먼저 대시보드에서 스캔을 실행하세요. 계획은 스캔 결과를 바탕으로 세웁니다.
        </div>
      )}
      {error && <div className="text-destructive border-b px-6 py-2 text-xs">{error}</div>}

      <main className="flex min-h-0 flex-1 flex-col gap-3 p-6">
        {!plan || !stats ? (
          <p className="text-muted-foreground text-xs">
            &lsquo;규칙으로 계획&rsquo;을 누르면 확장자 기준의 초안이 판에 깔리고, 그 위에 AI 추천을 얹을 수 있습니다.
          </p>
        ) : (
          <>
            <section className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
              <span className="font-medium">
                옮길 항목 {formatCount(stats.moving)}개 · {formatBytes(stats.movingBytes)}
              </span>
              <span className="text-muted-foreground">그대로 {formatCount(stats.staying)}개</span>
              <span className="text-muted-foreground">제외 {formatCount(stats.skipped)}개</span>
              <span className="text-muted-foreground">새 폴더 {formatCount(stats.newFolders)}개</span>
              <span className="text-muted-foreground ml-auto">
                {formatDate(plan.createdAt)} 기준 · Ctrl+클릭 여러 장 · Delete 그대로 두기
              </span>
            </section>

            <div className="min-h-0 flex-1">
              <KanbanBoard
                plan={plan}
                fields={fields}
                disabled={busy !== null}
                onMove={moveItems}
                onAddFolder={addFolder}
                onRenameFolder={renameFolder}
                onRemoveFolder={removeFolder}
                onKeepAll={keepAll}
              />
            </div>

            {plan.skipped.length > 0 && (
              <details className="rounded-xl border px-4 py-2 text-xs">
                <summary className="cursor-pointer select-none">
                  제외한 항목 {formatCount(plan.skipped.length)}개 — 옮길 수 없거나 옮기면 안 되는 것
                </summary>
                <ul className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto">
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

            <footer className="flex items-center justify-end gap-2 border-t pt-3">
              {/* 여기서는 확인 다이얼로그만 연다. 실제 이동은 다이얼로그에서 한 번 더 누른 뒤 */}
              <Button
                onClick={openExecute}
                disabled={stats.moving === 0 || busy !== null}
                title={stats.moving === 0 ? '옮길 카드가 없습니다' : undefined}
              >
                <Play />
                {formatCount(stats.moving)}개 실행
              </Button>
            </footer>
          </>
        )}
      </main>

      <ExecuteDialog
        state={exec}
        progress={progress}
        error={exec?.phase === 'confirm' ? error : undoState.error}
        onConfirm={() => void confirmExecute()}
        onClose={() => setExec(null)}
        onUndo={(entry) => void undoFromDialog(entry)}
        onRescan={rescan}
      />

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
              {edited && ' 지금 판에서 옮기거나 만든 것은 추천 결과로 대체됩니다.'}
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
