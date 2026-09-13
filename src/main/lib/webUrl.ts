/**
 * 기본 브라우저로 넘겨도 되는 주소인가 — `http:`·`https:` 만.
 *
 * `setWindowOpenHandler` 에 오는 url 은 renderer 가 준 값이다(지금 UI 에는 `window.open`·외부 `href` 가
 * 없지만, 생기거나 renderer 가 뚫리면 여기로 온다). `file:` 은 로컬 파일을, `ms-settings:` 같은 앱 스킴은
 * 다른 프로그램을 여니 renderer 의 값으로는 열지 않는다 — 설정 열기는 main 의 상수(`WINDOWS_APPS_SETTINGS_URI`)로만.
 */
export function isWebUrl(url: string): boolean {
  let protocol: string
  try {
    protocol = new URL(url).protocol
  } catch {
    return false
  }
  return protocol === 'http:' || protocol === 'https:'
}
