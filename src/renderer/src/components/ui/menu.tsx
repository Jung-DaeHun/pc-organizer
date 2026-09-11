import { useEffect, useId, useRef, useState, type JSX, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface MenuProps {
  /** 누르면 메뉴가 열리는 요소. 버튼 하나를 넘긴다 */
  trigger: (props: { open: boolean; toggle: () => void; 'aria-expanded': boolean }) => ReactNode
  children: (close: () => void) => ReactNode
  /** 목록이 트리거의 어느 쪽에 붙을지 */
  align?: 'left' | 'right'
  className?: string
}

/**
 * 의존성 없는 드롭다운. Dialog 와 같은 결 — 바깥 클릭·Esc 로 닫힌다.
 * 항목은 MenuItem 으로 넣는다. 포커스 순환 같은 건 없다; 항목이 서너 개인 메뉴에 쓴다.
 */
export function Menu({ trigger, children, align = 'right', className }: MenuProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      {trigger({ open, toggle: () => setOpen((v) => !v), 'aria-expanded': open })}
      {open && (
        <div
          role="menu"
          id={id}
          className={cn(
            'bg-popover text-popover-foreground absolute z-40 mt-1 min-w-44 rounded-md border p-1 shadow-lg',
            align === 'right' ? 'right-0' : 'left-0'
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

interface MenuItemProps {
  onSelect: () => void
  disabled?: boolean
  destructive?: boolean
  children: ReactNode
}

export function MenuItem({ onSelect, disabled, destructive, children }: MenuItemProps): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs',
        'hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50',
        destructive && 'text-destructive'
      )}
    >
      {children}
    </button>
  )
}

export function MenuLabel({ children }: { children: ReactNode }): JSX.Element {
  return <div className="text-muted-foreground px-2 py-1 text-[11px]">{children}</div>
}

export function MenuSeparator(): JSX.Element {
  return <div className="bg-border my-1 h-px" />
}
