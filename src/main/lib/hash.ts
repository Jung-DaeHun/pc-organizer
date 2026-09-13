import { createHash } from 'node:crypto'
import { lstat, open } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { isCloudOnly } from './cloudOnly'

/** 앞부분만 읽어 비교할 바이트 수. 중복 후보를 좁히는 데는 이 정도로 충분하다. */
export const HEAD_BYTES = 4096

/**
 * 파일 앞부분의 해시.
 *
 * 전체 해시는 비싸다. 크기가 같은 파일들끼리 앞 4KB만 비교해도 서로 다른 파일은 거의 걸러진다.
 * 실제로 지우기 전(B3)에는 `hashFull` 로 전체를 다시 확인해야 하며,
 * 그래서 대시보드에서는 이 결과를 '중복'이 아니라 '중복 후보'로 부른다.
 *
 * 주의: 클라우드 전용 파일에는 절대 부르면 안 된다. 읽는 순간 내려받기가 시작된다.
 * 부르는 쪽(`groupDuplicates`)이 `!isCloudOnly` 로 걸러낸 뒤에만 넘긴다.
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

// ---------------------------------------------------------------- 전체 해시

/** 전체 해시가 한 번에 읽는 크기 */
export const FULL_CHUNK_BYTES = 1024 * 1024

/** `hashFull` 이 보는 lstat 결과. node:fs 의 Stats 가 그대로 맞는다 */
export type HashStat = Pick<Stats, 'size' | 'blocks'> & {
  isFile(): boolean
  isSymbolicLink(): boolean
}

/** 열린 파일에서 필요한 것. node:fs/promises 의 FileHandle 이 그대로 맞는다 */
export interface HashHandle {
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number
  ): Promise<{ bytesRead: number }>
  close(): Promise<void>
}

/**
 * `hashFull` 이 쓰는 파일시스템. 테스트는 가짜를 넣어 "클라우드 전용이면 open 을 부르지 않는다"를
 * 확인하고, 실제로는 아래 `NODE_HASH_IO` 를 쓴다.
 */
export interface HashIo {
  /** 링크를 따라가지 않아야 한다 (stat 이 아니라 lstat) */
  lstat(path: string): Promise<HashStat>
  /** 읽기 전용으로 연다 */
  open(path: string): Promise<HashHandle>
}

export const NODE_HASH_IO: HashIo = {
  lstat,
  open: (path) => open(path, 'r')
}

/** 전체 해시를 내지 못한 이유 */
export type HashFullFailure = 'missing' | 'not-file' | 'cloud-only' | 'io'

export type HashFullResult =
  | {
      ok: true
      /** sha256, hex */
      hash: string
      /** 실제로 읽은 바이트 수. lstat 의 size 와 다르면 읽는 도중 파일이 바뀐 것이다 */
      size: number
    }
  | { ok: false; code: HashFullFailure }

/**
 * 파일 전체의 해시. 중복 후보를 휴지통으로 보내기 직전, 앞 4KB 비교를 전체 비교로 확정하는 데 쓴다.
 *
 * **열기 직전에 `lstat` 으로 클라우드 전용 여부를 다시 본다.** 스캔 때의 `FileEntry.isCloudOnly` 는
 * 믿지 않는다 — 스캔 뒤 OneDrive 가 '공간 확보'로 파일을 내려놓았을 수 있고, 그 파일을 여는 순간
 * 내려받기가 시작된다. 클라우드 전용이면 열지 않고 `cloud-only` 로 돌려준다.
 *
 * 링크와 일반 파일이 아닌 것도 열지 않는다. 읽기만 하고 아무것도 쓰지 않는다.
 *
 * @param onChunk 읽을 때마다 읽은 바이트 수. 여러 파일을 검증하는 화면이 진행률을 만드는 데 쓴다
 */
export async function hashFull(
  path: string,
  io: HashIo = NODE_HASH_IO,
  onChunk?: (bytes: number) => void
): Promise<HashFullResult> {
  let stats: HashStat
  try {
    stats = await io.lstat(path)
  } catch (err) {
    return { ok: false, code: errorCode(err) === 'ENOENT' ? 'missing' : 'io' }
  }

  if (stats.isSymbolicLink() || !stats.isFile()) return { ok: false, code: 'not-file' }
  if (isCloudOnly(stats)) return { ok: false, code: 'cloud-only' }

  let handle: HashHandle | undefined
  try {
    handle = await io.open(path)
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(FULL_CHUNK_BYTES)
    let position = 0

    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
      position += bytesRead
      onChunk?.(bytesRead)
    }

    return { ok: true, hash: hash.digest('hex'), size: position }
  } catch (err) {
    return { ok: false, code: errorCode(err) === 'ENOENT' ? 'missing' : 'io' }
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

const errorCode = (err: unknown): string | undefined =>
  typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code?: unknown }).code)
    : undefined
