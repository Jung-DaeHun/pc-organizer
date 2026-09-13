import { useCallback, useState, type JSX } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { Settings } from '@shared/types'
import { RulesCard } from '@/components/settings/RulesCard'
import { ThemeCard } from '@/components/settings/ThemeCard'
import { ThresholdsCard } from '@/components/settings/ThresholdsCard'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/format'

interface SettingsPageProps {
  settings: Settings | null
  onSettingsChange: (settings: Settings) => void
  onBack: () => void
}

type Section = 'theme' | 'rules' | 'thresholds'

/**
 * 설정 화면 — 화면 테마, 분류 규칙, 판정 기준.
 *
 * 여기서 바꾸는 건 전부 settings.json 이다. 파일은 건드리지 않고, 새 IPC 채널도 없다 — 감시 폴더와 같은
 * updateSettings 하나로 간다. 저장이 돌아오면 App 의 settings 를 갈아 끼워 대시보드 카드 문구·테마가 따라간다.
 */
export default function SettingsPage({
  settings,
  onSettingsChange,
  onBack
}: SettingsPageProps): JSX.Element {
  const [busy, setBusy] = useState<Section | null>(null)
  const [error, setError] = useState<{ section: Section; message: string } | null>(null)

  const save = useCallback(
    async (section: Section, patch: Partial<Settings>) => {
      setBusy(section)
      setError(null)
      try {
        onSettingsChange(await window.api.updateSettings(patch))
      } catch (err) {
        setError({ section, message: errorMessage(err, '저장하지 못했습니다') })
      } finally {
        setBusy(null)
      }
    },
    [onSettingsChange]
  )

  const errorOf = (section: Section): string | null =>
    error?.section === section ? error.message : null

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="대시보드로">
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold">설정</h1>
          <p className="text-muted-foreground truncate text-xs">
            화면 테마와 정리 규칙. 여기서 바꾸는 것은 파일을 건드리지 않습니다.
          </p>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {settings === null ? (
            <>
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-96 w-full" />
            </>
          ) : (
            <>
              <ThemeCard
                theme={settings.theme}
                busy={busy === 'theme'}
                onChange={(theme) => void save('theme', { theme })}
              />
              {errorOf('theme') && <p className="text-destructive text-xs">{errorOf('theme')}</p>}

              <RulesCard
                saved={settings.rules}
                busy={busy === 'rules'}
                error={errorOf('rules')}
                onSave={(rules) => void save('rules', { rules })}
              />

              <ThresholdsCard
                settings={settings}
                busy={busy === 'thresholds'}
                error={errorOf('thresholds')}
                onSave={(patch) => void save('thresholds', patch)}
              />
            </>
          )}
        </div>
      </main>
    </div>
  )
}
