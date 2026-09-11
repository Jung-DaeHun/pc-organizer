import type { DragEvent, JSX, MouseEvent } from 'react'
import { File as FileIcon, Folder as FolderIcon, MoreHorizontal, X } from 'lucide-react'
import { CATEGORY_LABELS, type PlanItem, type PlanOrigin, type ProposedFolder } from '@shared/types'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/components/ui/menu'
import type { CardFields } from '@/hooks/useCardFields'
import { formatBytes, formatCount, formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'

export const ORIGIN_LABELS: Record<PlanOrigin, string> = { rule: '규칙', ai: 'AI', user: '직접' }

interface PlanCardProps {
  planItem: PlanItem
  fields: CardFields
  /** 이 카드가 들어 있는 열. null = 그대로 두기 */
  column: string | null
  folders: ProposedFolder[]
  selected: boolean
  /** 지금 드래그되는 카드 중 하나인지 (흐리게) */
  dragging: boolean
  disabled: boolean
  onClick: (id: string, e: MouseEvent) => void
  onDragStart: (id: string, e: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  onMove: (ids: string[], toFolder: string | null) => void
}

/**
 * 카드 하나. 드래그의 시작점이고, ✕ 로 '그대로 두기' 로 보내거나 ⋯ 메뉴로 다른 열로 옮긴다.
 * 파일을 지우는 동작은 어디에도 없다 — ✕ 의 뜻은 '옮기지 않기' 다.
 */
export function PlanCard({
  planItem,
  fields,
  column,
  folders,
  selected,
  dragging,
  disabled,
  onClick,
  onDragStart,
  onDragEnd,
  onMove
}: PlanCardProps): JSX.Element {
  const { item, reason, origin } = planItem
  const isDir = item.kind === 'dir'

  const meta: string[] = []
  if (fields.size) meta.push(formatBytes(item.size))
  if (fields.mtime) meta.push(formatDate(item.mtimeMs))
  if (fields.category) meta.push(isDir ? '폴더' : CATEGORY_LABELS[item.category])

  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      draggable={!disabled}
      onClick={(e) => onClick(item.id, e)}
      onDragStart={(e) => onDragStart(item.id, e)}
      onDragEnd={onDragEnd}
      className={cn(
        'group bg-card relative cursor-grab rounded-md border px-2.5 py-2 text-xs shadow-sm select-none',
        'hover:border-primary/40 focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]',
        selected && 'ring-primary ring-2',
        dragging && 'opacity-40',
        disabled && 'cursor-default'
      )}
      title={item.path}
    >
      <div className="flex items-start gap-1.5">
        {isDir ? (
          <FolderIcon className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
        ) : (
          <FileIcon className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
        {isDir && (
          <span className="text-muted-foreground shrink-0 text-[11px]">
            {formatCount(item.fileCount ?? 0)}개
          </span>
        )}

        {/* 호버·선택·포커스 때만 드러나는 조작 버튼 */}
        <div
          className={cn(
            'flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity',
            'group-hover:opacity-100 group-focus-within:opacity-100',
            selected && 'opacity-100'
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <Menu
            trigger={({ toggle, 'aria-expanded': expanded }) => (
              <button
                type="button"
                aria-label="옮길 곳 고르기"
                aria-expanded={expanded}
                onClick={toggle}
                disabled={disabled}
                className="hover:bg-accent text-muted-foreground rounded p-0.5"
              >
                <MoreHorizontal className="size-3.5" />
              </button>
            )}
          >
            {(close) => (
              <>
                <MenuLabel>폴더로 이동</MenuLabel>
                {folders.map((f) => (
                  <MenuItem
                    key={f.name}
                    disabled={column !== null && f.name === column}
                    onSelect={() => {
                      onMove([item.id], f.name)
                      close()
                    }}
                  >
                    <FolderIcon className="size-3.5" />
                    <span className="truncate">{f.name}</span>
                  </MenuItem>
                ))}
                {folders.length > 0 && <MenuSeparator />}
                <MenuItem
                  disabled={column === null}
                  onSelect={() => {
                    onMove([item.id], null)
                    close()
                  }}
                >
                  그대로 두기
                </MenuItem>
              </>
            )}
          </Menu>
          {column !== null && (
            <button
              type="button"
              aria-label="옮기지 않기"
              title="옮기지 않기 — 그대로 두기 열로 보냅니다"
              disabled={disabled}
              onClick={() => onMove([item.id], null)}
              className="hover:bg-accent text-muted-foreground rounded p-0.5"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {meta.length > 0 && (
        <div className="text-muted-foreground mt-1 truncate text-[11px] tabular-nums">
          {meta.join(' · ')}
        </div>
      )}

      {fields.reason && reason && (
        <div className="text-muted-foreground mt-1 flex items-start gap-1 text-[11px]">
          <span
            className={cn(
              'shrink-0 rounded px-1 text-[10px] leading-4',
              origin === 'ai' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
            )}
          >
            {ORIGIN_LABELS[origin]}
          </span>
          <span className="line-clamp-2">{reason}</span>
        </div>
      )}
    </div>
  )
}
