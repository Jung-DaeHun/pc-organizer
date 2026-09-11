import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/format'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * 렌더 중 예외가 나면 React 는 트리 전체를 내려 창이 텅 비어 버린다. 그 대신 무슨 일인지 적고
 * 다시 그릴 길을 준다. 에러 경계는 아직 클래스 컴포넌트로만 만들 수 있다.
 * 계획·스캔 결과는 main 이 들고 있으므로 다시 그려도 잃는 건 화면 상태뿐이다.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('화면을 그리다 실패', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm font-semibold">화면을 그리다 문제가 생겼습니다</p>
        <p className="text-muted-foreground selectable max-w-xl text-xs break-all">
          {errorMessage(error, '알 수 없는 오류')}
        </p>
        <Button variant="outline" size="sm" onClick={() => this.setState({ error: null })}>
          다시 그리기
        </Button>
      </div>
    )
  }
}
