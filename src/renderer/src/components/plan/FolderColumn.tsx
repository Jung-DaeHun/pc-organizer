import { useRef, useState, type DragEvent, type JSX, type MouseEvent } from 'react'
import { Folder as FolderIcon, MoreHorizontal, PauseCircle, Pencil } from 'lucide-react'
import type { PlanItem, ProposedFolder } from '@shared/types'
import { Menu, MenuItem } from '@/components/ui/menu'
import type { CardFields } from '@/hooks/useCardFields'
import { formatBytes, formatCount } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ORIGIN_LABELS, PlanCard } from './PlanCard'

/** 열 너비. 카드 이름이 한 줄에 20자쯤 들어가고, 1280px 화면에 네 열이 보이는 값 */
export const COLUMN_WIDTH_CLASS = 'w-[280px]'

interface ColumnBaseProps {
  items: PlanItem[]
  folders: ProposedFolder[]
  fields: CardFields
  selected: Set<string>
  dragging: string[] | null
  isDropTarget: boolean
  disabled: boolean
  onCardClick: (id: string, e: MouseEvent) => void
  onCardDragStart: (id: string, e: DragEvent<HTMLDivElement>) => void
  onCardDragEnd: () => void
  onDragOver: (e: DragEvent<HTMLElement>) => void
  onDragLeave: (e: DragEvent<HTMLElement>) => void
  onDrop: (e: DragEvent<HTMLElement>) => void
  onMove: (ids: string[], toFolder: string | null) => void
}

interface KeepColumnProps extends ColumnBaseProps {
  variant: 'keep'
}

interface FolderColumnProps extends ColumnBaseProps {
  variant: 'folder'
  folder: ProposedFolder
  onRename: (from: string, to: string) => string | null
  onRemove: (name: string) => string | null
  onKeepAll: (name: string) => void
}

type Props = KeepColumnProps | FolderColumnProps

/**
 * 열 하나. '그대로 두기' 열과 폴더 열이 같은 몸통을 쓰고 머리만 다르다.
 * 드롭 존이기도 해서 dragover/drop 을 보드에서 받아 처리한다.
 */
export function FolderColumn(props: Props): JSX.Element {
  const { items, isDropTarget, dragging, onDragOver, onDragLeave, onDrop } = props
  const columnName = props.variant === 'folder' ? props.folder.name : null
  const totalBytes = items.reduce((sum, p) => sum + p.item.size, 0)

  // 끌고 있는 카드가 전부 이 열에 있으면 여기 놓아봐야 의미가 없다
  const draggingFromHere =
    dragging !== null && dragging.every((id) => items.some((p) => p.item.id === id))

  return (
    <section
      data-column={columnName ?? '__keep__'}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        COLUMN_WIDTH_CLASS,
        'flex h-full shrink-0 flex-col rounded-xl border transition-shadow',
        props.variant === 'keep' ? 'bg-muted/30' : 'bg-card/60',
        isDropTarget && !draggingFromHere && 'ring-primary/60 ring-2',
        draggingFromHere && 'opacity-60'
      )}
    >
      {props.variant === 'keep' ? (
        <header className="flex flex-col gap-1 px-3 pt-3 pb-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <PauseCircle className="text-muted-foreground size-3.5" />
            그대로 두기
          </div>
          <div className="text-muted-foreground text-[11px]">
            {items.length === 0 ? '카드를 여기로 끌면 옮기지 않습니다' : `${formatCount(items.length)}개 · 이번엔 안 옮김`}
          </div>
        </header>
      ) : (
        <FolderHeader
          folder={props.folder}
          count={items.length}
          bytes={totalBytes}
          disabled={props.disabled}
          onRename={props.onRename}
          onRemove={props.onRemove}
          onKeepAll={props.onKeepAll}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-2">
        {items.length === 0 && (
          <div className="text-muted-foreground/70 rounded-md border border-dashed px-2 py-6 text-center text-[11px]">
            비어 있음
          </div>
        )}
        {items.map((p) => (
          <PlanCard
            key={p.item.id}
            planItem={p}
            fields={props.fields}
            column={columnName}
            folders={props.folders}
            selected={props.selected.has(p.item.id)}
            dragging={dragging?.includes(p.item.id) ?? false}
            disabled={props.disabled}
            onClick={props.onCardClick}
            onDragStart={props.onCardDragStart}
            onDragEnd={props.onCardDragEnd}
            onMove={props.onMove}
          />
        ))}
      </div>
    </section>
  )
}

interface FolderHeaderProps {
  folder: ProposedFolder
  count: number
  bytes: number
  disabled: boolean
  onRename: (from: string, to: string) => string | null
  onRemove: (name: string) => string | null
  onKeepAll: (name: string) => void
}

function FolderHeader({
  folder,
  count,
  bytes,
  disabled,
  onRename,
  onRemove,
  onKeepAll
}: FolderHeaderProps): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(folder.name)
  const [error, setError] = useState<string | null>(null)
  // 입력란을 닫기로 한 뒤 언마운트되며 오는 blur 를 무시하기 위한 표시.
  // (Escape 로 버린 초안을 blur 가 도로 커밋하면 안 된다)
  const closed = useRef(true)

  const canRename = !folder.existing && !disabled

  const startEdit = (): void => {
    if (!canRename) return
    closed.current = false
    setDraft(folder.name)
    setError(null)
    setEditing(true)
  }

  const close = (message: string | null): void => {
    closed.current = true
    setEditing(false)
    setError(message)
  }

  /** Enter. 실패하면 입력란을 열어 둔 채 이유를 보여줘 고칠 수 있게 한다 */
  const commit = (): void => {
    const message = onRename(folder.name, draft)
    if (message) setError(message)
    else close(null)
  }

  const cancel = (): void => close(null)

  /**
   * 밖을 눌러 나가는 길. 통하면 반영하고, 아니면 초안을 버리고 닫되 이유는 남긴다 —
   * 실패한 채로 열어 두면 blur 가 올 때마다 같은 오류만 되풀이되고 Escape 말고는 빠져나갈 수 없다
   */
  const onBlur = (): void => {
    if (closed.current) return
    close(onRename(folder.name, draft))
  }

  return (
    <header className="flex flex-col gap-1 px-3 pt-3 pb-2">
      <div className="flex items-start gap-1.5">
        <FolderIcon className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />

        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') cancel()
            }}
            onBlur={onBlur}
            aria-label="폴더 이름"
            className="bg-background border-input h-6 min-w-0 flex-1 rounded border px-1.5 text-xs font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        ) : (
          <button
            type="button"
            onClick={startEdit}
            disabled={!canRename}
            title={folder.existing ? '이미 있는 폴더라 이름을 바꿀 수 없습니다' : '클릭해서 이름 바꾸기'}
            className={cn(
              'group/name flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-semibold',
              canRename && 'hover:underline'
            )}
          >
            <span className="truncate">{folder.name}</span>
            {canRename && (
              <Pencil className="text-muted-foreground size-3 shrink-0 opacity-0 group-hover/name:opacity-100" />
            )}
          </button>
        )}

        <Menu
          trigger={({ toggle, 'aria-expanded': expanded }) => (
            <button
              type="button"
              aria-label="폴더 메뉴"
              aria-expanded={expanded}
              onClick={toggle}
              disabled={disabled}
              className="hover:bg-accent text-muted-foreground shrink-0 rounded p-0.5"
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem
                disabled={count === 0}
                onSelect={() => {
                  onKeepAll(folder.name)
                  close()
                }}
              >
                이 폴더 전부 그대로 두기
              </MenuItem>
              <MenuItem
                disabled={count > 0}
                onSelect={() => {
                  const message = onRemove(folder.name)
                  if (message) setError(message)
                  close()
                }}
              >
                빈 열 지우기
              </MenuItem>
            </>
          )}
        </Menu>
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-[11px]">
        <span
          className={cn(
            'rounded px-1 text-[10px] leading-4',
            folder.existing ? 'bg-secondary text-secondary-foreground' : 'bg-primary/15 text-foreground'
          )}
        >
          {folder.existing ? '기존 폴더' : '새 폴더'}
        </span>
        <span>{ORIGIN_LABELS[folder.origin]}</span>
        <span className="ml-auto tabular-nums">
          {formatCount(count)}개{bytes > 0 && ` · ${formatBytes(bytes)}`}
        </span>
      </div>

      {folder.description && (
        <p className="text-foreground/80 line-clamp-2 text-[11px]" title={folder.description}>
          {folder.description}
        </p>
      )}

      {error && <p className="text-destructive text-[11px]">{error}</p>}
    </header>
  )
}
