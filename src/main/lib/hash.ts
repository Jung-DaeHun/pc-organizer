import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'

/** 앞부분만 읽어 비교할 바이트 수. 중복 후보를 좁히는 데는 이 정도로 충분하다. */
export const HEAD_BYTES = 4096

/**
 * 파일 앞부분의 해시.
 *
 * 전체 해시는 비싸다. 크기가 같은 파일들끼리 앞 4KB만 비교해도 서로 다른 파일은 거의 걸러진다.
 * 실제로 지우기 전(2단계)에는 전체 해시로 다시 확인해야 하며,
 * 그래서 1단계 화면에서는 이 결과를 '중복'이 아니라 '중복 후보'로 부른다.
 *
 * 주의: 클라우드 전용 파일에는 절대 부르면 안 된다. 읽는 순간 내려받기가 시작된다.
 */
export async function hashHead(path: string, bytes = HEAD_BYTES): Promise<string | null> {
  let handle
  try {
    handle = await open(path, 'r')
    const buffer = Buffer.allocUnsafe(bytes)
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0)

    return createHash('sha1')
      .update(buffer.subarray(0, bytesRead))
      .digest('hex')
  } catch {
    // 잠긴 파일이거나 권한이 없다. 중복 후보에서 빠질 뿐이라 조용히 넘어간다.
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}
