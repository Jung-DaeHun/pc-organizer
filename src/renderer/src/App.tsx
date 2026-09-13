import { useEffect, useState, type JSX } from 'react'
import type { Settings } from '@shared/types'
import { useScan } from '@/hooks/useScan'
import { applyTheme } from '@/lib/theme'
import Dashboard from '@/pages/Dashboard'
import PlanPage from '@/pages/PlanPage'
import SettingsPage from '@/pages/SettingsPage'
import TrashPage from '@/pages/TrashPage'

type View = 'dashboard' | 'plan' | 'trash' | 'settings'

/**
 * 화면은 넷뿐이라 라우터 없이 상태 하나로 고른다.
 *
 * 스캔 결과·설정·API 키 유무는 화면을 오가도 살아 있어야 하므로 여기서 들고 있는다.
 * (계획 화면은 스캔 결과의 scannedAt 으로 main 의 목록과 같은 스캔인지 확인한다)
 */
export default function App(): JSX.Element {
  const [view, setView] = useState<View>('dashboard')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null)
  const scan = useScan()

  useEffect(() => {
    let alive = true

    window.api
      .getSettings()
      .then((next) => {
        if (alive) setSettings(next)
      })
      .catch((err: unknown) => console.error('설정 읽기 실패', err))

    window.api
      .hasApiKey()
      .then((next) => {
        if (alive) setHasApiKey(next)
      })
      .catch((err: unknown) => {
        console.error('API 키 확인 실패', err)
        if (alive) setHasApiKey(false)
      })

    return () => {
      alive = false
    }
  }, [])

  // 테마는 설정의 일부다. 처음 읽었을 때와 설정 화면에서 바꿨을 때 모두 여기서 <html> 클래스를 맞춘다
  const theme = settings?.theme
  useEffect(() => {
    if (theme) applyTheme(theme)
  }, [theme])

  if (view === 'plan') {
    return (
      <PlanPage
        scan={scan}
        settings={settings}
        hasApiKey={hasApiKey}
        onBack={() => setView('dashboard')}
      />
    )
  }

  if (view === 'trash') {
    return <TrashPage scan={scan} onBack={() => setView('dashboard')} />
  }

  if (view === 'settings') {
    return (
      <SettingsPage
        settings={settings}
        onSettingsChange={setSettings}
        onBack={() => setView('dashboard')}
      />
    )
  }

  return (
    <Dashboard
      scan={scan}
      settings={settings}
      onSettingsChange={setSettings}
      hasApiKey={hasApiKey}
      onApiKeyChange={setHasApiKey}
      onOpenPlan={() => setView('plan')}
      onOpenTrash={() => setView('trash')}
      onOpenSettings={() => setView('settings')}
    />
  )
}
