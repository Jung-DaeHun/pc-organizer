import { useCallback, useMemo, useState, type JSX } from 'react'
import { Loader2, RotateCcw, Save, Tags } from 'lucide-react'
import type { CategoryRule, RuleCategory } from '@shared/types'
import { defaultRules, rulesEqual } from '@shared/rules'
import { RuleRow } from '@/components/settings/RuleRow'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import {
  addExtension,
  canSaveRules,
  removeExtension,
  ruleProblems,
  setEnabled,
  setFolderName,
  toSaveable
} from '@/lib/settingsEdit'

interface RulesCardProps {
  /** 저장된 규칙. 저장이 끝나면 새 값이 들어오고 초안이 거기에 맞춰진다 */
  saved: CategoryRule[]
  busy: boolean
  error: string | null
  onSave: (rules: CategoryRule[]) => void
}

/**
 * 분류 규칙 편집. 초안은 화면 사본이고 '저장'을 누르기 전까지 아무것도 바뀌지 않는다.
 * 편집 규칙은 lib/settingsEdit.ts 의 순수 함수에 있다.
 */
export function RulesCard({ saved, busy, error, onSave }: RulesCardProps): JSX.Element {
  const [draft, setDraft] = useState<CategoryRule[]>(saved)
  // 저장이 끝나 saved 의 **내용**이 바뀌면 초안을 그 값으로 다시 맞춘다 (props 변화에 맞춰 state 를 고치는 React
  // 관례). 참조로 비교하면 다른 카드(판정 기준)를 저장할 때마다 설정 객체가 새로 와서 여기 초안이 날아간다
  const [baseline, setBaseline] = useState(saved)
  if (!rulesEqual(baseline, saved)) {
    setBaseline(saved)
    setDraft(saved)
  }

  const problems = useMemo(() => ruleProblems(draft), [draft])
  const dirty = !rulesEqual(draft, saved)
  const canSave = canSaveRules(draft, saved) && !busy
  const isDefault = rulesEqual(draft, defaultRules())

  const onAdd = useCallback(
    (category: RuleCategory, raw: string) => {
      const result = addExtension(draft, category, raw)
      if (!result.error) setDraft(result.rules)
      return { error: result.error, movedFrom: result.movedFrom }
    },
    [draft]
  )

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Tags className="text-muted-foreground size-4" />
          <div>
            <CardTitle>분류 규칙</CardTitle>
            <CardDescription>
              확장자로 파일 종류를 정하고, &lsquo;규칙으로 계획&rsquo;이 종류마다 아래 폴더로 보냅니다. 한 확장자는 한
              종류에만 속하며, 종류를 끄면 그 파일은 그대로 둡니다. 저장 뒤 집계에 반영하려면 다시 스캔하세요.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <ul className="flex flex-col gap-2">
          {draft.map((rule) => (
            <RuleRow
              key={rule.category}
              rule={rule}
              problem={problems[rule.category] ?? null}
              disabled={busy}
              onFolderName={(name) => setDraft(setFolderName(draft, rule.category, name))}
              onEnabled={(enabled) => setDraft(setEnabled(draft, rule.category, enabled))}
              onAddExtension={(raw) => onAdd(rule.category, raw)}
              onRemoveExtension={(ext) => setDraft(removeExtension(draft, rule.category, ext))}
            />
          ))}
        </ul>
      </CardContent>

      <CardFooter className="justify-between gap-2 border-t pt-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDraft(defaultRules())}
          disabled={busy || isDefault}
          title="일곱 종류의 기본 확장자·폴더 이름으로 되돌립니다 (저장을 눌러야 반영)"
        >
          <RotateCcw />
          기본값으로
        </Button>

        <div className="flex items-center gap-2">
          {error && <span className="text-destructive text-xs">{error}</span>}
          {dirty && !error && (
            <span className="text-muted-foreground text-xs">저장하지 않은 변경이 있습니다</span>
          )}
          <Button variant="outline" size="sm" onClick={() => setDraft(saved)} disabled={busy || !dirty}>
            변경 취소
          </Button>
          <Button size="sm" onClick={() => onSave(toSaveable(draft))} disabled={!canSave}>
            {busy ? <Loader2 className="animate-spin" /> : <Save />}
            저장
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}
