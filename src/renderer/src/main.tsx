import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

// 탐색기에서 끌어온 파일을 창 어디에 놓아도 Chromium 이 그 파일로 이동하지 않게 막는다.
// 놓기(drop)의 기본 동작이 '파일 열기' 라, dragover 와 drop 둘 다 막아야 한다.
// 판의 카드 DnD 는 열의 핸들러가 먼저 처리하고 여기까지 올라오므로 영향이 없다.
// (main 의 will-navigate 가 두 번째 벽이다)
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

const container = document.getElementById('root')
if (!container) throw new Error('#root 엘리먼트를 찾지 못했습니다')

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
