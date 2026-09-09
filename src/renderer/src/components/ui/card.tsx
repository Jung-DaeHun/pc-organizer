import type * as React from 'react'
import { cn } from '@/lib/utils'

export function Card({ className, ...props }: React.ComponentProps<'section'>): React.JSX.Element {
  return (
    <section
      data-slot="card"
      className={cn(
        'bg-card text-card-foreground flex flex-col gap-4 rounded-xl border py-5 shadow-sm',
        className
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: React.ComponentProps<'header'>): React.JSX.Element {
  return (
    <header
      data-slot="card-header"
      className={cn('flex items-start justify-between gap-2 px-5', className)}
      {...props}
    />
  )
}

export function CardTitle({ className, ...props }: React.ComponentProps<'h2'>): React.JSX.Element {
  return (
    <h2
      data-slot="card-title"
      className={cn('text-sm font-semibold tracking-tight', className)}
      {...props}
    />
  )
}

export function CardDescription({
  className,
  ...props
}: React.ComponentProps<'p'>): React.JSX.Element {
  return (
    <p
      data-slot="card-description"
      className={cn('text-muted-foreground text-xs', className)}
      {...props}
    />
  )
}

export function CardContent({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return <div data-slot="card-content" className={cn('px-5', className)} {...props} />
}

export function CardFooter({ className, ...props }: React.ComponentProps<'footer'>): React.JSX.Element {
  return (
    <footer
      data-slot="card-footer"
      className={cn('flex items-center px-5', className)}
      {...props}
    />
  )
}
