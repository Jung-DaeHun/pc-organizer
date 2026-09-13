import { THEMES, type Theme } from '@shared/types'

/**
 * 화면 테마 적용.
 *
 * 진짜 값은 settings.json(main 의 store.ts)이다. localStorage 는 그 사본으로, 다음 실행의 **첫 페인트**를
 * 저장된 테마로 시작하기 위한 힌트일 뿐이다 — 설정 IPC 가 돌아오기 전에 index.html 의 class="dark" 로 한 번
 * 그려지면 라이트 사용자는 켤 때마다 어두운 화면이 번쩍인다. 설정이 오면 그 값으로 덮어쓴다.
 */
const STORAGE_KEY = 'theme'

const isTheme = (v: unknown): v is Theme =>
  typeof v === 'string' && (THEMES as readonly string[]).includes(v)

/** <html class="dark"> 를 켜고 끈다 (index.css 의 .dark 변수와 @custom-variant dark 가 이걸 본다) */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // 저장소가 막혀 있어도 화면은 바뀐다. 다음 실행의 첫 페인트만 기본값(dark)으로 시작한다
  }
}

/** 첫 렌더 전에 부른다. 저장된 힌트가 없으면 index.html 의 기본(dark)을 그대로 둔다 */
export function applyCachedTheme(): void {
  let cached: unknown = null
  try {
    cached = localStorage.getItem(STORAGE_KEY)
  } catch {
    // 위와 같다
  }
  if (isTheme(cached)) document.documentElement.classList.toggle('dark', cached === 'dark')
}
