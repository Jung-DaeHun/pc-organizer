import type * as React from 'react'
import { cn } from '@/lib/utils'

interface ProgressBarProps extends React.ComponentProps<'div'> {
  /** 0 ~ 1 */
  value: number
  /** 막대 색. 용량 경고처럼 상황에 따라 바꾼다 */
  indicatorClassName?: string
}

/**
 * 의존성 없는 단순 진행 막대.
 * radix를 끌어오지 않아도 되는 수준이라 직접 그린다.
 */
export function ProgressBar({
  value,
  className,
  indicatorClassName,
  ...props
}: ProgressBarProps): React.JSX.Element {
  const clamped = Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 1)

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      className={cn('bg-secondary h-2 w-full overflow-hidden rounded-full', className)}
      {...props}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-500', indicatorClassName)}
        style={{ width: `${clamped * 100}%` }}
      />
    </div>
  )
}
