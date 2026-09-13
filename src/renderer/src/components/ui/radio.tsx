import type * as React from 'react'
import { cn } from '@/lib/utils'

/** 네이티브 라디오에 테마 색만 입힌다 (checkbox.tsx 와 같은 방식) */
export function Radio({
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'>): React.JSX.Element {
  return (
    <input
      type="radio"
      data-slot="radio"
      className={cn(
        'accent-primary size-4 shrink-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}
