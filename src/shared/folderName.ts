/**
 * 폴더 이름 규칙. main(AI 응답 검증)과 renderer(사용자가 직접 만든 폴더)가 같은 규칙을 써야
 * 화면에서 통과한 이름이 실행 단계에서 거부되는 일이 없다. Node 의존성 없음.
 */

export const MAX_FOLDER_NAME_LENGTH = 60

/** 윈도우 파일 이름에 못 쓰는 문자. 확장자(rules.ts)도 파일 이름의 일부라 같은 검사를 쓴다 */
export const FORBIDDEN_CHARS = /[\\/:*?"<>|]/
/** 제어 문자(0x00-0x1f)도 못 쓴다. 정규식에 넣으면 no-control-regex 에 걸려 따로 본다 */
export const hasControlChar = (s: string): boolean =>
  [...s].some((ch) => ch.charCodeAt(0) < 0x20)
/** 확장자를 떼고 봐도 예약어면 안 된다 ('CON.txt' 도 못 만든다) */
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** 폴더 이름으로 쓸 수 있게 다듬는다. 못 쓰면 null */
export function sanitizeFolderName(raw: string): string | null {
  const name = raw.trim()
  if (!name || name.length > MAX_FOLDER_NAME_LENGTH) return null
  if (name === '.' || name === '..') return null
  if (FORBIDDEN_CHARS.test(name) || hasControlChar(name)) return null
  // 앞뒤의 점·공백은 윈도우가 잘라내 버려 다른 이름이 된다
  if (/^[. ]|[. ]$/.test(name)) return null
  if (RESERVED_NAMES.test(name.split('.')[0] ?? '')) return null
  return name
}

/**
 * '같은 폴더인가' 비교 키. 윈도우 파일시스템은 대소문자를 구분하지 않으므로 소문자로 접는다.
 * (main 의 pathKey 와 같은 뜻이지만 이 앱은 윈도우 전용이라 플랫폼 분기 없이 쓴다)
 */
export function folderKey(name: string): string {
  return name.toLowerCase()
}
