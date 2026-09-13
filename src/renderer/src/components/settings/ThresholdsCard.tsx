import { useState, type JSX } from 'react'
import { Loader2, Save, SlidersHorizontal } from 'lucide-react'
import type { Settings, Thresholds } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { parsePositiveInteger } from '@/lib/settingsEdit'
import { cn } from '@/lib/utils'

const MB = 1024 * 1024

interface ThresholdsCardProps {
  settings: Settings
  busy: boolean
  error: string | null
  onSave: (patch: Thresholds) => void
}

const INPUT_CLASS =
  'bg-background border-input h-7 w-24 rounded-md border px-2 text-right text-xs tabular-nums outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50'

/**
 * 대용량·오래된 파일의 기준. 다음 스캔부터 쓰이고, 대시보드 '정리 기회' 카드는 그 스캔에 쓴 값을
 * 힌트로 보여준다(Opportunities.thresholds) — 여기서 바꿔도 이미 낸 수치의 문구는 바뀌지 않는다
 */
export function ThresholdsCard({ settings, busy, error, onSave }: ThresholdsCardProps): JSX.Element {
  // 화면은 정수 MB 만 저장하지만 settings.json 을 손으로 고쳐 1 MB 미만을 넣었을 수 있다 — 아무것도 안 쳤는데
  // "0" 과 오류 표시로 시작하지 않게 1 로 올려 보여준다
  const savedMb = String(Math.max(1, Math.round(settings.largeFileBytes / MB)))
  const savedDays = String(settings.oldFileDays)

  const [mb, setMb] = useState(savedMb)
  const [days, setDays] = useState(savedDays)
  // 저장이 끝나 저장된 값이 바뀌면 입력란을 그 값으로 다시 맞춘다 (RulesCard 와 같은 관례 — 값으로 비교해야
  // 다른 카드를 저장할 때 여기 입력이 날아가지 않는다)
  const [baseline, setBaseline] = useState({ mb: savedMb, days: savedDays })
  if (baseline.mb !== savedMb || baseline.days !== savedDays) {
    setBaseline({ mb: savedMb, days: savedDays })
    setMb(savedMb)
    setDays(savedDays)
  }

  const mbValue = parsePositiveInteger(mb)
  const daysValue = parsePositiveInteger(days)
  const dirty = mb.trim() !== savedMb || days.trim() !== savedDays
  const canSave = dirty && mbValue !== null && daysValue !== null && !busy

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="text-muted-foreground size-4" />
          <div>
            <CardTitle>판정 기준</CardTitle>
            <CardDescription>
              &lsquo;정리 기회&rsquo;의 대용량·오래된 파일을 가르는 값. 다음 스캔부터 적용됩니다.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 text-xs">
        <label className="flex items-center gap-2">
          <span className="w-24 shrink-0">대용량</span>
          <input
            inputMode="numeric"
            value={mb}
            onChange={(e) => setMb(e.target.value)}
            disabled={busy}
            aria-label="대용량 기준 (MB)"
            aria-invalid={mbValue === null}
            className={cn(INPUT_CLASS, mbValue === null && 'border-destructive')}
          />
          <span className="text-muted-foreground">MB 이상</span>
        </label>

        <label className="flex items-center gap-2">
          <span className="w-24 shrink-0">오래된 파일</span>
          <input
            inputMode="numeric"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            disabled={busy}
            aria-label="오래된 파일 기준 (일)"
            aria-invalid={daysValue === null}
            className={cn(INPUT_CLASS, daysValue === null && 'border-destructive')}
          />
          <span className="text-muted-foreground">일 넘게 손대지 않음</span>
        </label>

        {(mbValue === null || daysValue === null) && (
          <p className="text-destructive text-[11px]">1 이상의 정수를 입력하세요</p>
        )}
      </CardContent>

      <CardFooter className="justify-end gap-2 border-t pt-4">
        {error && <span className="text-destructive text-xs">{error}</span>}
        <Button
          size="sm"
          disabled={!canSave}
          onClick={() => {
            if (mbValue !== null && daysValue !== null) {
              onSave({ largeFileBytes: mbValue * MB, oldFileDays: daysValue })
            }
          }}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Save />}
          저장
        </Button>
      </CardFooter>
    </Card>
  )
}
