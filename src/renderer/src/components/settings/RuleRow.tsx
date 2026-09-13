import { useState, type JSX } from 'react'
import { Plus, X } from 'lucide-react'
import { CATEGORY_LABELS, type CategoryRule, type RuleCategory } from '@shared/types'
import { CATEGORY_COLOR } from '@/components/CategoryChart'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'

interface RuleRowProps {
  rule: CategoryRule
  /** 폴더 이름이 저장에서 거부될 이유. null 이면 괜찮다 */
  problem: string | null
  disabled: boolean
  onFolderName: (name: string) => void
  onEnabled: (enabled: boolean) => void
  /** 넣지 못했으면 이유를 돌려준다. 다른 카테고리에서 옮겨 왔으면 그 카테고리 */
  onAddExtension: (raw: string) => { error: string | null; movedFrom: RuleCategory | null }
  onRemoveExtension: (ext: string) => void
}

const INPUT_CLASS =
  'bg-background border-input rounded-md border px-2 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50'

/** 카테고리 하나의 규칙 줄 — 켜기, 폴더 이름, 확장자 목록 */
export function RuleRow({
  rule,
  problem,
  disabled,
  onFolderName,
  onEnabled,
  onAddExtension,
  onRemoveExtension
}: RuleRowProps): JSX.Element {
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const label = CATEGORY_LABELS[rule.category]

  const add = (): void => {
    if (!draft.trim()) return
    const { error, movedFrom } = onAddExtension(draft)
    if (error) {
      setNotice({ text: error, error: true })
      return
    }
    setDraft('')
    setNotice(
      movedFrom ? { text: `'${CATEGORY_LABELS[movedFrom]}'에서 옮겨 왔습니다`, error: false } : null
    )
  }

  return (
    <li className={cn('flex flex-col gap-2 rounded-lg border p-3', !rule.enabled && 'opacity-70')}>
      <div className="flex items-center gap-3">
        <Checkbox
          checked={rule.enabled}
          disabled={disabled}
          onChange={(e) => onEnabled(e.target.checked)}
          aria-label={`${label} 규칙으로 옮기기`}
          title="끄면 이 종류의 파일은 규칙으로 옮기지 않습니다 (집계에는 그대로 잡힙니다)"
        />
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: CATEGORY_COLOR[rule.category] }}
        />
        <span className="w-14 shrink-0 text-xs font-medium">{label}</span>

        <label className="flex min-w-0 flex-1 items-center gap-2 text-xs">
          <span className="text-muted-foreground shrink-0">폴더</span>
          <input
            value={rule.folderName}
            onChange={(e) => onFolderName(e.target.value)}
            disabled={disabled}
            spellCheck={false}
            aria-label={`${label} 폴더 이름`}
            aria-invalid={problem !== null}
            className={cn(INPUT_CLASS, 'h-7 min-w-0 flex-1', problem && 'border-destructive')}
          />
        </label>
      </div>

      {problem && <p className="text-destructive pl-9 text-[11px]">{problem}</p>}

      <div className="flex flex-wrap items-center gap-1.5 pl-9">
        {rule.extensions.map((ext) => (
          <span
            key={ext}
            className="bg-secondary text-secondary-foreground inline-flex h-6 items-center gap-1 rounded-md pr-1 pl-2 font-mono text-[11px]"
          >
            {ext}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRemoveExtension(ext)}
              aria-label={`${ext} 제거`}
              className="hover:bg-accent rounded p-0.5 disabled:opacity-50"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}

        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            add()
          }}
        >
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setNotice(null)
            }}
            disabled={disabled}
            placeholder="확장자 추가"
            spellCheck={false}
            autoComplete="off"
            aria-label={`${label}에 확장자 추가`}
            className={cn(INPUT_CLASS, 'h-6 w-24 font-mono')}
          />
          <Button
            type="submit"
            variant="ghost"
            size="icon"
            className="size-6"
            disabled={disabled || !draft.trim()}
            aria-label="추가"
          >
            <Plus className="size-3.5" />
          </Button>
        </form>
      </div>

      {notice && (
        <p className={cn('pl-9 text-[11px]', notice.error ? 'text-destructive' : 'text-muted-foreground')}>
          {notice.text}
        </p>
      )}
    </li>
  )
}
