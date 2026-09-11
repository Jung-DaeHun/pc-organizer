import { useEffect, type JSX, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface DialogProps {
  open: boolean
  title: string
  /** 닫기 요청 (배경 클릭, Esc). 진행 중이면 무시할 수 있다 */
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  className?: string
}

/**
 * 의존성 없는 단순 모달.
 *
 * 이 앱에서 모달이 하는 일은 하나다 — "지금 무엇을 하려는지" 를 한 번 더 보여주고
 * 사용자가 누르게 하는 것. 그래서 포커스 트랩 같은 건 넣지 않고 Esc 와 배경 클릭만 처리한다.
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  className
}: DialogProps): JSX.Element | null {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'bg-card text-card-foreground flex w-full max-w-lg flex-col gap-4 rounded-xl border p-5 shadow-lg',
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="text-xs">{children}</div>
        {footer && <div className="flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}
