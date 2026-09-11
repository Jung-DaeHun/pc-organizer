import type * as React from 'react'
import { cn } from '@/lib/utils'

/** 네이티브 체크박스에 테마 색만 입힌다. radix 를 끌어올 이유가 없는 수준이다 */
export function Checkbox({
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'>): React.JSX.Element {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        'accent-primary size-4 shrink-0 cursor-pointer rounded border disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}
