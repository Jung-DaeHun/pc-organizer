/**
 * '같은 파일인가'를 비교할 때 쓰는 키.
 *
 * 윈도우 파일시스템은 대소문자를 구분하지 않아 `C:\Users\Me\Desktop`과
 * `c:\users\me\desktop`은 같은 곳이다. 문자열 그대로 비교하면 같은 파일이 두 개로 보인다.
 * 소문자로 접는 건 윈도우에서만 한다. 대소문자를 구분하는 파일시스템에서는 실제로 다른 파일이다.
 */
export function pathKey(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}
