import type { JSX } from 'react'
import { Trash2 } from 'lucide-react'
import type { TrashGroup } from '@shared/types'
import { Checkbox } from '@/components/ui/checkbox'
import { Radio } from '@/components/ui/radio'
import { formatAge, formatBytes, formatCount, formatDate, truncatePath } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * 경로에서 파일 이름을 뗀 폴더. 어느 사본을 남길지 고를 때 보는 건 이름(같다)이 아니라 폴더다.
 * path 는 main 이 join(dir, name) 으로 만든 값이라 뒤에서 name 길이만큼 자르면 된다 — renderer 에는
 * node:path 가 없다
 */
const folderOf = (path: string, name: string): string =>
  path.endsWith(name) ? path.slice(0, Math.max(0, path.length - name.length - 1)) : path

interface TrashGroupCardProps {
  group: TrashGroup
  disabled: boolean
  onChooseKeeper: (groupId: string, itemId: string) => void
  onInclude: (groupId: string, included: boolean) => void
}

/**
 * 중복 후보 그룹 하나. 파일마다 라디오 — 고른 하나를 **남기고** 나머지가 휴지통 대상이다.
 * 여기서 무엇을 골라도 파일은 움직이지 않는다. 지우는 건 화면 하단 버튼 → 확인 다이얼로그 뒤의 일이다.
 */
export function TrashGroupCard({
  group,
  disabled,
  onChooseKeeper,
  onInclude
}: TrashGroupCardProps): JSX.Element {
  const extras = group.items.length - 1
  const inactive = disabled || !group.included

  return (
    <section
      className={cn(
        'bg-card text-card-foreground rounded-xl border text-xs shadow-sm',
        !group.included && 'opacity-60'
      )}
    >
      <header className="flex items-center gap-3 border-b px-4 py-2.5">
        <Checkbox
          checked={group.included}
          disabled={disabled}
          onChange={(e) => onInclude(group.id, e.target.checked)}
          aria-label="이번 정리에 포함"
        />
        <span className="font-medium">
          같은 파일 {formatCount(group.items.length)}개 · {formatBytes(group.size)}씩
        </span>
        <span className="text-muted-foreground ml-auto tabular-nums">
          {group.included
            ? `휴지통으로 ${formatCount(extras)}개 · ${formatBytes(group.size * extras)}`
            : '이번에는 건너뜀'}
        </span>
      </header>

      <ul className="flex flex-col">
        {group.items.map((item) => {
          const keep = item.id === group.keepId
          return (
            <li
              key={item.id}
              className={cn(
                'flex items-center gap-3 px-4 py-2',
                keep ? 'bg-primary/5' : 'text-muted-foreground'
              )}
            >
              <Radio
                name={`keep-${group.id}`}
                checked={keep}
                disabled={inactive}
                onChange={() => onChooseKeeper(group.id, item.id)}
                aria-label={`${item.name} 남기기`}
              />
              <div className="min-w-0 flex-1">
                <div className={cn('truncate', keep && 'text-foreground font-medium')}>
                  {item.name}
                </div>
                <div className="selectable truncate font-mono text-[11px]" title={item.path}>
                  {truncatePath(folderOf(item.path, item.name), 72)}
                </div>
              </div>
              <span className="shrink-0 text-[11px] tabular-nums" title="수정일 · 마지막으로 손댄 때">
                {formatDate(item.mtimeMs)} · {formatAge(item.lastTouchedMs)}
              </span>
              <span
                className={cn(
                  'flex w-20 shrink-0 items-center justify-end gap-1 text-[11px]',
                  keep ? 'text-primary font-medium' : 'text-destructive'
                )}
              >
                {keep ? (
                  '남김'
                ) : (
                  <>
                    <Trash2 className="size-3" />
                    {group.included ? '휴지통으로' : '건너뜀'}
                  </>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
