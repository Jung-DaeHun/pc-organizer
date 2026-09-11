import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type JSX,
  type MouseEvent
} from 'react'
import { Plus } from 'lucide-react'
import type { OrganizePlan } from '@shared/types'
import { Button } from '@/components/ui/button'
import type { CardFields } from '@/hooks/useCardFields'
import { groupByFolder } from '@/lib/planEdit'
import { cn } from '@/lib/utils'
import { COLUMN_WIDTH_CLASS, FolderColumn } from './FolderColumn'

/** '그대로 두기' 열의 드롭 대상 키. 폴더 이름과 겹치지 않게 */
const KEEP = '__keep__'
/** 판 가장자리 몇 px 안에서 끌면 자동으로 가로 스크롤할지 */
const EDGE = 60
const SCROLL_STEP = 14
/** dataTransfer 에 쓰는 우리만의 타입. 바깥에서 끌어온 파일과 섞이지 않게 */
const MIME = 'application/x-pc-organizer-cards'

interface KanbanBoardProps {
  plan: OrganizePlan
  fields: CardFields
  disabled: boolean
  onMove: (ids: string[], toFolder: string | null) => void
  /** 실패하면 화면에 보여줄 문장, 성공하면 null */
  onAddFolder: (name: string) => string | null
  onRenameFolder: (from: string, to: string) => string | null
  onRemoveFolder: (name: string) => string | null
  onKeepAll: (name: string) => void
}

/**
 * 칸반 판. 선택·드래그 상태와 가로 스크롤을 여기서 들고, 계획 자체는 부모(usePlan)가 바꾼다.
 *
 * 드래그는 HTML5 네이티브 DnD 다. 끌고 있는 카드 id 는 dataTransfer 에도 넣지만, 드롭 처리는
 * React 상태(dragging)를 쓴다 — dragover 중에는 dataTransfer 를 읽을 수 없기 때문이다.
 */
export function KanbanBoard({
  plan,
  fields,
  disabled,
  onMove,
  onAddFolder,
  onRenameFolder,
  onRemoveFolder,
  onKeepAll
}: KanbanBoardProps): JSX.Element {
  const groups = useMemo(() => groupByFolder(plan), [plan])
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [dragging, setDragging] = useState<string[] | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // 계획이 바뀌어(다시 세움, AI 추천) 없어진 id 는 선택에서 지운다
  const validIds = useMemo(() => new Set(plan.items.map((p) => p.item.id)), [plan])
  const liveSelected = useMemo(
    () => new Set([...selected].filter((id) => validIds.has(id))),
    [selected, validIds]
  )

  // ---------------------------------------------------------------- 선택

  const onCardClick = useCallback((id: string, e: MouseEvent) => {
    setSelected((current) => {
      if (e.ctrlKey || e.metaKey) {
        const next = new Set(current)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }
      return new Set([id])
    })
  }, [])

  const clearSelection = useCallback(() => setSelected(new Set()), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // 입력란에서 치는 키는 판의 단축키가 아니다
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (e.key === 'Escape') clearSelection()
      if (e.key === 'Delete' && liveSelected.size > 0 && !disabled) {
        onMove([...liveSelected], null)
        clearSelection()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clearSelection, disabled, liveSelected, onMove])

  // ---------------------------------------------------------------- 드래그

  const onCardDragStart = useCallback(
    (id: string, e: DragEvent<HTMLDivElement>) => {
      const ids = liveSelected.has(id) ? [...liveSelected] : [id]
      setDragging(ids)
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData(MIME, ids.join('\n'))

      if (ids.length > 1) {
        // 여러 장을 끌 때는 카드 대신 개수 배지를 보여준다
        const badge = document.createElement('div')
        badge.textContent = `${ids.length}개`
        badge.style.cssText =
          'position:fixed;top:-100px;left:-100px;padding:4px 10px;border-radius:6px;' +
          'background:#1e293b;color:#f8fafc;font-size:12px;font-weight:600;'
        document.body.appendChild(badge)
        e.dataTransfer.setDragImage(badge, 12, 12)
        setTimeout(() => badge.remove(), 0)
      }
    },
    [liveSelected]
  )

  const onCardDragEnd = useCallback(() => {
    setDragging(null)
    setDropTarget(null)
  }, [])

  const columnOf = (e: DragEvent<HTMLElement>): string | null =>
    (e.currentTarget as HTMLElement).dataset.column ?? null

  const onColumnDragOver = useCallback(
    (e: DragEvent<HTMLElement>) => {
      if (!dragging || disabled) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const column = columnOf(e)
      if (column !== dropTarget) setDropTarget(column)
    },
    [dragging, disabled, dropTarget]
  )

  const onColumnDragLeave = useCallback((e: DragEvent<HTMLElement>) => {
    // 자식 요소 사이를 오갈 때도 dragleave 가 오므로, 진짜로 열을 벗어났을 때만 지운다
    const next = e.relatedTarget as Node | null
    if (next && (e.currentTarget as HTMLElement).contains(next)) return
    setDropTarget((current) => (current === columnOf(e) ? null : current))
  }, [])

  const onColumnDrop = useCallback(
    (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      const column = columnOf(e)
      const ids = dragging ?? e.dataTransfer.getData(MIME).split('\n').filter(Boolean)
      setDragging(null)
      setDropTarget(null)
      if (ids.length === 0 || column === null || disabled) return
      onMove(ids, column === KEEP ? null : column)
      clearSelection()
    },
    [dragging, disabled, onMove, clearSelection]
  )

  /** 판 가장자리 근처에서 끌면 가로로 밀어준다. dragover 는 멈춰 있어도 계속 오므로 이걸로 충분하다 */
  const onBoardDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (e.clientX < rect.left + EDGE) el.scrollLeft -= SCROLL_STEP
    else if (e.clientX > rect.right - EDGE) el.scrollLeft += SCROLL_STEP
  }, [])

  // ---------------------------------------------------------------- 그리기

  const columnProps = {
    folders: plan.folders,
    fields,
    selected: liveSelected,
    dragging,
    disabled,
    onCardClick,
    onCardDragStart,
    onCardDragEnd,
    onDragOver: onColumnDragOver,
    onDragLeave: onColumnDragLeave,
    onDrop: onColumnDrop,
    onMove
  }

  return (
    <div
      ref={scrollRef}
      role="listbox"
      aria-multiselectable="true"
      aria-label="정리 계획 판"
      onDragOver={onBoardDragOver}
      onClick={(e) => {
        // 카드 밖(열 여백, 판 여백)을 누르면 선택 해제
        if (e.target === e.currentTarget || (e.target as HTMLElement).closest('[role=option]') === null) {
          clearSelection()
        }
      }}
      className="flex h-full min-h-0 gap-3 overflow-x-auto overflow-y-hidden pb-2"
    >
      {/* 그대로 두기 열은 가로 스크롤해도 왼쪽에 남는다 — 카드를 언제든 놓을 수 있게 */}
      <div className="bg-background sticky left-0 z-10 -mr-3 h-full shrink-0 pr-3">
        <FolderColumn
          variant="keep"
          items={groups.keep}
          isDropTarget={dropTarget === KEEP}
          {...columnProps}
        />
      </div>

      {groups.columns.map(({ folder, items }) => (
        <FolderColumn
          key={folder.name}
          variant="folder"
          folder={folder}
          items={items}
          isDropTarget={dropTarget === folder.name}
          onRename={onRenameFolder}
          onRemove={onRemoveFolder}
          onKeepAll={onKeepAll}
          {...columnProps}
        />
      ))}

      <NewFolderColumn disabled={disabled} onAdd={onAddFolder} />
    </div>
  )
}

interface NewFolderColumnProps {
  disabled: boolean
  onAdd: (name: string) => string | null
}

/** 판 오른쪽 끝. 누르면 입력란이 열리고, 만들면 새 열이 바로 왼쪽에 생긴다 */
function NewFolderColumn({ disabled, onAdd }: NewFolderColumnProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = (): void => {
    const message = onAdd(draft)
    if (message) {
      setError(message)
      return
    }
    setDraft('')
    setError(null)
    setOpen(false)
  }

  return (
    <section
      className={cn(
        COLUMN_WIDTH_CLASS,
        'flex h-full shrink-0 flex-col rounded-xl border border-dashed p-3'
      )}
    >
      {open ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setOpen(false)
                setError(null)
              }
            }}
            placeholder="새 폴더 이름"
            aria-label="새 폴더 이름"
            className="bg-background border-input h-8 rounded-md border px-2 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          {error && <p className="text-destructive text-[11px]">{error}</p>}
          <div className="flex justify-end gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button type="submit" size="sm" disabled={draft.trim().length === 0}>
              만들기
            </Button>
          </div>
        </form>
      ) : (
        <Button
          variant="ghost"
          className="text-muted-foreground h-auto justify-start py-2"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          <Plus />
          새 폴더
        </Button>
      )}
    </section>
  )
}
