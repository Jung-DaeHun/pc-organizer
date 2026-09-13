import type { JSX } from 'react'
import { Moon, Palette, Sun } from 'lucide-react'
import type { Theme } from '@shared/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface ThemeCardProps {
  theme: Theme
  busy: boolean
  onChange: (theme: Theme) => void
}

const OPTIONS: { value: Theme; label: string; icon: JSX.Element }[] = [
  { value: 'dark', label: '다크', icon: <Moon className="size-3.5" /> },
  { value: 'light', label: '라이트', icon: <Sun className="size-3.5" /> }
]

/** 화면 테마. 누르는 즉시 저장되고 적용된다 (App 이 settings.theme 을 보고 <html> 클래스를 맞춘다) */
export function ThemeCard({ theme, busy, onChange }: ThemeCardProps): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Palette className="text-muted-foreground size-4" />
          <div>
            <CardTitle>화면 테마</CardTitle>
            <CardDescription>고르면 바로 적용되고 다음 실행에도 유지됩니다</CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div role="radiogroup" aria-label="화면 테마" className="bg-muted inline-flex rounded-md p-0.5">
          {OPTIONS.map((option) => {
            const active = option.value === theme
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={busy}
                onClick={() => {
                  if (!active) onChange(option.value)
                }}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50',
                  active
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {option.icon}
                {option.label}
              </button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
