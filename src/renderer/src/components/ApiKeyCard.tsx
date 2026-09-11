import { useCallback, useState, type JSX } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { errorMessage } from '@/lib/format'

interface ApiKeyCardProps {
  hasKey: boolean | null
  onChange: (hasKey: boolean) => void
}

/**
 * Anthropic API 키 설정.
 *
 * 입력한 키는 main 이 암호화해 저장하고, 여기로 돌아오는 건 '있다/없다' 뿐이다.
 * 저장된 키를 다시 보여주는 기능은 일부러 없다.
 */
export function ApiKeyCard({ hasKey, onChange }: ApiKeyCardProps): JSX.Element {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await window.api.setApiKey(draft)
      // 입력란에 키가 남아 있으면 나중에 '키 삭제' 뒤 폼이 다시 열릴 때 그대로 보인다
      setDraft('')
      onChange(true)
    } catch (err) {
      setError(errorMessage(err, '키를 저장하지 못했습니다'))
    } finally {
      setBusy(false)
    }
  }, [draft, onChange])

  const clear = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await window.api.clearApiKey()
      onChange(false)
    } catch (err) {
      setError(errorMessage(err, '키를 지우지 못했습니다'))
    } finally {
      setBusy(false)
    }
  }, [onChange])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <KeyRound className="text-muted-foreground size-4" />
          <div>
            <CardTitle>AI 추천</CardTitle>
            <CardDescription>
              {hasKey === null
                ? '확인 중'
                : hasKey
                  ? 'API 키가 저장되어 있습니다 (암호화됨)'
                  : 'Anthropic API 키를 넣으면 정리 계획에서 AI 추천을 받을 수 있습니다'}
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-2">
        {hasKey ? (
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">
              보낼 때마다 무엇을 보내는지 먼저 보여주고 확인을 받습니다. 파일 내용은 보내지 않습니다.
            </span>
            <Button variant="outline" size="sm" onClick={() => void clear()} disabled={busy}>
              키 삭제
            </Button>
          </div>
        ) : (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-ant-..."
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy || hasKey === null}
              className="bg-background border-input h-8 min-w-0 flex-1 rounded-md border px-2 font-mono text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              aria-label="Anthropic API 키"
            />
            <Button type="submit" size="sm" disabled={busy || draft.trim().length === 0}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              저장
            </Button>
          </form>
        )}

        {error && <p className="text-destructive text-xs">{error}</p>}
      </CardContent>
    </Card>
  )
}
