import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  FULL_CHUNK_BYTES,
  NODE_HASH_IO,
  hashFull,
  type HashHandle,
  type HashIo,
  type HashStat
} from '../src/main/lib/hash'

const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex')

function stat(overrides: Partial<HashStat> = {}): HashStat {
  return {
    size: 5_000,
    blocks: 16,
    isFile: () => true,
    isSymbolicLink: () => false,
    ...overrides
  }
}

/**
 * 메모리 버퍼를 파일처럼 내주는 가짜 핸들. `chunk` 로 한 번에 내주는 최대 크기를 줄여
 * 여러 번 읽는 루프를 작은 데이터로도 태울 수 있다.
 */
function fakeHandle(content: Buffer, chunk = content.length): HashHandle & { closed: boolean } {
  const handle = {
    closed: false,
    async read(buffer: Buffer, offset: number, length: number, position: number) {
      const slice = content.subarray(position, Math.min(position + length, position + chunk))
      slice.copy(buffer, offset)
      return { bytesRead: slice.length }
    },
    async close() {
      handle.closed = true
    }
  }
  return handle
}

function fakeIo(stats: HashStat | Error, handle?: HashHandle): HashIo & { open: ReturnType<typeof vi.fn> } {
  return {
    lstat: async () => {
      if (stats instanceof Error) throw stats
      return stats
    },
    open: vi.fn(async () => {
      if (!handle) throw new Error('open 이 불리면 안 된다')
      return handle
    })
  }
}

const enoent = (): Error => Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })

describe('hashFull', () => {
  it('클라우드 전용이면 열지 않는다', async () => {
    // 스캔 뒤 OneDrive 가 '공간 확보'로 파일을 내려놓았을 수 있다. 열기 직전의 lstat 이 마지막 벽이고,
    // 여기서 열어 버리면 그 파일 크기만큼 내려받기가 시작된다.
    const io = fakeIo(stat({ size: 5_000_000, blocks: 0 }))

    const result = await hashFull('cloud.bin', io)

    expect(result).toEqual({ ok: false, code: 'cloud-only' })
    expect(io.open).not.toHaveBeenCalled()
  })

  it('링크는 열지 않는다', async () => {
    const io = fakeIo(stat({ isSymbolicLink: () => true }))

    expect(await hashFull('link', io)).toEqual({ ok: false, code: 'not-file' })
    expect(io.open).not.toHaveBeenCalled()
  })

  it('일반 파일이 아니면 열지 않는다', async () => {
    const io = fakeIo(stat({ isFile: () => false }))

    expect(await hashFull('dir', io)).toEqual({ ok: false, code: 'not-file' })
    expect(io.open).not.toHaveBeenCalled()
  })

  it('없는 파일은 missing', async () => {
    const io = fakeIo(enoent())

    expect(await hashFull('gone', io)).toEqual({ ok: false, code: 'missing' })
    expect(io.open).not.toHaveBeenCalled()
  })

  it('lstat 의 그 밖의 실패는 io', async () => {
    const io = fakeIo(Object.assign(new Error('EPERM'), { code: 'EPERM' }))

    expect(await hashFull('locked', io)).toEqual({ ok: false, code: 'io' })
  })

  it('여러 번 나눠 읽어도 전체 해시와 읽은 크기가 맞고, 진행률이 합계와 같다', async () => {
    const content = Buffer.from('0123456789'.repeat(100)) // 1000 바이트
    const handle = fakeHandle(content, 333)
    const io = fakeIo(stat({ size: content.length }), handle)
    const chunks: number[] = []

    const result = await hashFull('file.bin', io, (n) => chunks.push(n))

    expect(result).toEqual({ ok: true, hash: sha256(content), size: content.length })
    expect(chunks).toEqual([333, 333, 333, 1])
    expect(handle.closed).toBe(true)
  })

  it('1KB 이하의 작은 파일은 블록이 0 이어도 읽는다 (resident file)', async () => {
    const content = Buffer.from('tiny')
    const io = fakeIo(stat({ size: content.length, blocks: 0 }), fakeHandle(content))

    const result = await hashFull('tiny.txt', io)

    expect(result).toEqual({ ok: true, hash: sha256(content), size: 4 })
  })

  it('읽다가 실패하면 io 로 돌려주고 핸들은 닫는다', async () => {
    const handle = fakeHandle(Buffer.alloc(10))
    handle.read = async () => {
      throw Object.assign(new Error('EIO'), { code: 'EIO' })
    }
    const io = fakeIo(stat({ size: 10 }), handle)

    expect(await hashFull('bad', io)).toEqual({ ok: false, code: 'io' })
    expect(handle.closed).toBe(true)
  })

  it('열 때 ENOENT 면 missing (lstat 과 open 사이에 지워짐)', async () => {
    const io: HashIo = {
      lstat: async () => stat(),
      open: async () => {
        throw enoent()
      }
    }

    expect(await hashFull('race', io)).toEqual({ ok: false, code: 'missing' })
  })
})

// 실제 fs 픽스처. 테스트가 만든 임시 폴더만 만지고 끝에 지운다
const root = await mkdtemp(join(tmpdir(), 'pc-organizer-hash-'))
const bigContent = Buffer.alloc(FULL_CHUNK_BYTES + 12_345, 7)
await writeFile(join(root, 'big.bin'), bigContent)

describe('hashFull — 실제 파일', () => {
  afterAll(() => rm(root, { recursive: true, force: true }))

  it('청크 경계를 넘는 파일의 해시가 sha256 과 같다', async () => {
    const result = await hashFull(join(root, 'big.bin'), NODE_HASH_IO)

    expect(result).toEqual({ ok: true, hash: sha256(bigContent), size: bigContent.length })
  })

  it('없는 파일은 missing', async () => {
    expect(await hashFull(join(root, 'nope.bin'), NODE_HASH_IO)).toEqual({
      ok: false,
      code: 'missing'
    })
  })

  it('폴더는 not-file', async () => {
    expect(await hashFull(root, NODE_HASH_IO)).toEqual({ ok: false, code: 'not-file' })
  })
})
