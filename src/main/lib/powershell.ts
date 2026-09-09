import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * PowerShell 스크립트를 돌려 JSON 결과를 받는다.
 *
 * 드라이브 용량과 설치된 앱 목록은 Node 표준 API로는 얻을 수 없어서
 * Windows에 기본 탑재된 PowerShell을 한 번씩 호출한다. 전부 조회 전용이다.
 *
 * 실패하면 예외를 던지지 않고 null을 돌려준다. 카드 하나가 비는 것이
 * 앱 전체가 죽는 것보다 낫기 때문이다.
 */
export async function runPowerShellJson<T>(script: string, timeoutMs = 20_000): Promise<T | null> {
  // 한글 볼륨명/앱 이름이 깨지지 않도록 출력 인코딩을 UTF-8로 고정한다
  const wrapped = `$OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${script}`

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', wrapped],
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8', windowsHide: true }
    )

    const text = stdout.trim()
    if (!text) return null
    return JSON.parse(text) as T
  } catch (err) {
    console.error('[powershell] 조회 실패:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * ConvertTo-Json 은 항목이 하나뿐이면 배열이 아니라 객체를 내놓는다.
 * 호출부가 매번 신경 쓰지 않도록 여기서 배열로 맞춰준다.
 */
export function toArray<T>(value: T | T[] | null): T[] {
  if (value === null || value === undefined) return []
  return Array.isArray(value) ? value : [value]
}
