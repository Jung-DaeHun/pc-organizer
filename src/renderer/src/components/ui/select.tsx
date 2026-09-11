import type * as React from 'react'
import { cn } from '@/lib/utils'

/** 네이티브 select. 목적지 폴더처럼 항목이 열 개 남짓인 곳에 쓴다 */
export function Select({ className, ...props }: React.ComponentProps<'select'>): React.JSX.Element {
  return (
    <select
      data-slot="select"
      className={cn(
        'bg-background border-input h-7 rounded-md border px-2 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}
