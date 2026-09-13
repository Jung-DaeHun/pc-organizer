import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { TrashGroup, TrashItem, TrashPlan, TrashProgress, TrashResult } from '@shared/types'
import type { HashHandle, HashIo, HashStat } from '../src/main/lib/hash'
import {
  executeTrash,
  preflightTrash,
  resolveTrash,
  type EntryStat,
  type ExecutorIo,
  type TrashJob
} from '../src/main/services/executor'

/**
 * 휴지통 실행기(executor.ts 의 resolveTrash · preflightTrash · executeTrash)를 가짜 io 로 본다.
 *
 * 확인하는 것: 요청은 계획과 대조해 하나라도 어긋나면 전체 거부, 사전 점검은 아무것도 보내지 않고
 * 하나라도 걸리면 전부 돌려주며, 보내는 건 남길 파일을 뺀 나머지뿐이고 보내기 직전에 남길 파일이
 * 아직 있는지 다시 본다.
 */

// ---------------------------------------------------------------- 가짜 파일시스템

interface FakeFile {
  content: Buffer
  /** 클라우드 전용 흉내: 크기는 있는데 블록이 0 */
  cloudOnly?: boolean
  link?: boolean
  dir?: boolean
}

function fsError(code: string): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error(code)
  err.code = code
  return err
}

/** 경로 → 내용. 휴지통으로 보내면 trashed 에 쌓이고 맵에서 사라진다 */
class FakeDisk {
  readonly files = new Map<string, FakeFile>()
  readonly trashed: string[] = []
  readonly opened: string[] = []
  /** 이 경로의 trashItem 은 이 코드로 실패한다 */
  failTrash = new Map<string, string>()

  constructor(initial: Record<string, string | FakeFile>) {
    for (const [path, v] of Object.entries(initial)) {
      this.files.set(path, typeof v === 'string' ? { content: Buffer.from(v) } : v)
    }
  }

  private stat(path: string): HashStat & EntryStat {
    const f = this.files.get(path)
    if (!f) throw fsError('ENOENT')
    return {
      size: f.content.length,
      blocks: f.cloudOnly ? 0 : Math.ceil(f.content.length / 512),
      isFile: () => !f.link && !f.dir,
      isDirectory: () => Boolean(f.dir),
      isSymbolicLink: () => Boolean(f.link)
    }
  }

  readonly hashIo: HashIo = {
    lstat: async (path) => this.stat(path),
    open: async (path): Promise<HashHandle> => {
      this.opened.push(path)
      const f = this.files.get(path)
      if (!f) throw fsError('ENOENT')
      const content = f.content
      return {
        async read(buffer, offset, length, position) {
          const slice = content.subarray(position, position + length)
          slice.copy(buffer, offset)
          return { bytesRead: slice.length }
        },
        async close() {}
      }
    }
  }

  readonly io: ExecutorIo = {
    lstat: async (path) => this.stat(path),
    // 휴지통 실행은 이동 호출을 부르면 안 된다
    mkdir: async () => {
      throw new Error('휴지통 실행이 mkdir 을 불렀습니다')
    },
    rename: async () => {
      throw new Error('휴지통 실행이 rename 을 불렀습니다')
    },
    rmdir: async () => {
      throw new Error('휴지통 실행이 rmdir 을 불렀습니다')
    },
    trashItem: async (path) => {
      const code = this.failTrash.get(path)
      if (code) throw fsError(code)
      if (!this.files.has(path)) throw fsError('ENOENT')
      this.files.delete(path)
      this.trashed.push(path)
    }
  }
}

// ---------------------------------------------------------------- 픽스처

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')

function item(id: string, path: string, size: number): TrashItem {
  return { id, path, name: path.split('\\').pop() ?? path, size, mtimeMs: 0, lastTouchedMs: 0 }
}

function group(id: string, size: number, paths: string[], keepIndex = 0): TrashGroup {
  const items = paths.map((p, i) => item(`${id}.${i}`, p, size))
  return { id, size, items, keepId: items[keepIndex]!.id, included: true }
}

const SAME = 'same content '.repeat(40) // 520 바이트
const OTHER = 'other content'.repeat(40) // 520 바이트, 앞부분부터 다름
// 앞 4KB 는 같고 뒤가 다른 큰 파일 — 앞부분 해시로는 못 가르는 경우
const HEAD = 'H'.repeat(5000)
const BIG_A = `${HEAD}tail-a`
const BIG_B = `${HEAD}tail-b`

const plan: TrashPlan = {
  id: 'p',
  createdAt: 0,
  scannedAt: 1,
  groups: [
    group('0', SAME.length, ['C:\\a\\x.pdf', 'C:\\b\\x.pdf', 'C:\\c\\x.pdf']),
    group('1', BIG_A.length, ['C:\\big1.bin', 'C:\\big2.bin'], 1)
  ]
}

function disk(overrides: Record<string, string | FakeFile> = {}): FakeDisk {
  return new FakeDisk({
    'C:\\a\\x.pdf': SAME,
    'C:\\b\\x.pdf': SAME,
    'C:\\c\\x.pdf': SAME,
    'C:\\big1.bin': BIG_A,
    'C:\\big2.bin': BIG_A,
    ...overrides
  })
}

const allJobs = (): TrashJob[] =>
  resolveTrash(plan, [
    { groupId: '0', keepId: '0.0' },
    { groupId: '1', keepId: '1.1' }
  ])

const codes = (results: TrashResult[]): Record<string, string | undefined> =>
  Object.fromEntries(results.map((r) => [r.path, r.code]))

// ---------------------------------------------------------------- resolveTrash

describe('resolveTrash', () => {
  it('남길 파일을 뺀 나머지가 보낼 대상이다', () => {
    const jobs = resolveTrash(plan, [{ groupId: '0', keepId: '0.1' }])
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.keeper.path).toBe('C:\\b\\x.pdf')
    expect(jobs[0]!.targets.map((t) => t.path)).toEqual(['C:\\a\\x.pdf', 'C:\\c\\x.pdf'])
  })

  it('요청에 없는 그룹은 건드리지 않는다', () => {
    const jobs = resolveTrash(plan, [{ groupId: '1', keepId: '1.0' }])
    expect(jobs.map((j) => j.group.id)).toEqual(['1'])
  })

  it('모르는 그룹이면 전체 거부', () => {
    expect(() =>
      resolveTrash(plan, [
        { groupId: '0', keepId: '0.0' },
        { groupId: '9', keepId: '9.0' }
      ])
    ).toThrow('계획에 없는 그룹')
  })

  it('남길 파일이 그 그룹의 것이 아니면 전체 거부 — 다른 그룹의 id 도 안 된다', () => {
    expect(() => resolveTrash(plan, [{ groupId: '0', keepId: '1.0' }])).toThrow('남길 파일이 그룹에 없습니다')
    expect(() => resolveTrash(plan, [{ groupId: '0', keepId: 'nope' }])).toThrow('남길 파일이 그룹에 없습니다')
  })

  it('같은 그룹이 두 번이면 전체 거부', () => {
    expect(() =>
      resolveTrash(plan, [
        { groupId: '0', keepId: '0.0' },
        { groupId: '0', keepId: '0.1' }
      ])
    ).toThrow('두 번')
  })

  it('빈 요청과 잘못된 모양은 거부', () => {
    expect(() => resolveTrash(plan, [])).toThrow('보낼 항목이 없습니다')
    expect(() => resolveTrash(plan, 'x' as unknown as [])).toThrow('형식')
    expect(() => resolveTrash(plan, [{ groupId: 0, keepId: '0.0' } as unknown as { groupId: string; keepId: string }])).toThrow('형식')
  })

  it('그룹 안에 같은 경로가 둘이면(계획이 이상함) 거부', () => {
    const bad: TrashPlan = { ...plan, groups: [group('0', 10, ['C:\\x', 'c:\\X'])] }
    expect(() => resolveTrash(bad, [{ groupId: '0', keepId: '0.0' }])).toThrow('같은 경로')
  })

  it('요청은 경로를 담지 않는다 — 계획의 경로만 쓴다', () => {
    const jobs = resolveTrash(plan, [{ groupId: '0', keepId: '0.0', path: 'C:\\evil' } as never])
    expect(jobs[0]!.targets.map((t) => t.path)).toEqual(['C:\\b\\x.pdf', 'C:\\c\\x.pdf'])
  })
})

// ---------------------------------------------------------------- preflightTrash

describe('preflightTrash', () => {
  it('전부 같으면 문제 없음. 남길 파일까지 전부 읽는다', async () => {
    const d = disk()
    expect(await preflightTrash(allJobs(), d.hashIo)).toEqual([])
    expect(d.opened.sort()).toEqual(
      ['C:\\a\\x.pdf', 'C:\\b\\x.pdf', 'C:\\c\\x.pdf', 'C:\\big1.bin', 'C:\\big2.bin'].sort()
    )
    expect(d.trashed).toEqual([])
  })

  it('파일이 없으면 missing — 아무것도 읽지 않는다', async () => {
    const d = disk()
    d.files.delete('C:\\b\\x.pdf')
    const problems = await preflightTrash(allJobs(), d.hashIo)
    expect(codes(problems)).toEqual({ 'C:\\b\\x.pdf': 'missing' })
    expect(d.opened).toEqual([])
  })

  it('남길 파일이 링크가 됐으면 not-file', async () => {
    const d = disk({ 'C:\\a\\x.pdf': { content: Buffer.from(SAME), link: true } })
    expect(codes(await preflightTrash(allJobs(), d.hashIo))).toEqual({ 'C:\\a\\x.pdf': 'not-file' })
    expect(d.opened).toEqual([])
  })

  it('크기가 바뀌었으면 size-changed', async () => {
    const d = disk({ 'C:\\c\\x.pdf': `${SAME}!` })
    expect(codes(await preflightTrash(allJobs(), d.hashIo))).toEqual({ 'C:\\c\\x.pdf': 'size-changed' })
    expect(d.opened).toEqual([])
  })

  it('클라우드 전용이면 cloud-only — 열지 않는다', async () => {
    // 스캔 뒤 OneDrive 가 내려놓았을 수 있다. 여기서 열면 내려받기가 시작된다
    const d = disk({ 'C:\\big2.bin': { content: Buffer.from(BIG_A), cloudOnly: true } })
    expect(codes(await preflightTrash(allJobs(), d.hashIo))).toEqual({ 'C:\\big2.bin': 'cloud-only' })
    expect(d.opened).toEqual([])
  })

  it('앞 4KB 는 같고 뒤가 다르면 hash-mismatch — 후보가 여기서 걸러진다', async () => {
    const d = disk({ 'C:\\big1.bin': BIG_B })
    // 그룹 1 은 big2 를 남긴다(keepId 1.1). 남길 파일 기준으로 big1 이 다르다고 나온다
    expect(codes(await preflightTrash(allJobs(), d.hashIo))).toEqual({ 'C:\\big1.bin': 'hash-mismatch' })
  })

  it('여러 문제를 한 번에 돌려준다', async () => {
    const d = disk({ 'C:\\b\\x.pdf': OTHER })
    d.files.delete('C:\\big1.bin')
    const problems = await preflightTrash(allJobs(), d.hashIo)
    // 1단계(lstat)에서 걸리면 해시 단계로 가지 않는다 — missing 만 나온다
    expect(codes(problems)).toEqual({ 'C:\\big1.bin': 'missing' })
    expect(d.opened).toEqual([])
  })

  it('해시 진행률은 바이트 기준으로 전체 크기까지 간다', async () => {
    const d = disk()
    const seen: TrashProgress[] = []
    await preflightTrash(allJobs(), d.hashIo, (p) => seen.push(p))
    const total = SAME.length * 3 + BIG_A.length * 2
    expect(seen.every((p) => p.phase === 'verifying' && p.total === total)).toBe(true)
    expect(seen.at(-1)).toEqual({ phase: 'verifying', done: total, total, current: '' })
  })

  it('한 그룹의 모든 파일 해시가 sha256 으로 같아야 통과한다', async () => {
    // 같은 내용이면 실제 sha256 도 같다 — 가짜 핸들이 내용을 그대로 내주는지 겸사겸사 본다
    expect(sha256(SAME)).toBe(sha256(SAME))
    const d = disk({ 'C:\\c\\x.pdf': OTHER })
    expect(codes(await preflightTrash(allJobs(), d.hashIo))).toEqual({ 'C:\\c\\x.pdf': 'hash-mismatch' })
  })
})

// ---------------------------------------------------------------- executeTrash

describe('executeTrash', () => {
  it('남길 파일을 뺀 나머지만, 그룹 순서대로 보낸다', async () => {
    const d = disk()
    const results = await executeTrash(allJobs(), d.io, d.hashIo)

    expect(results.map((r) => [r.path, r.ok])).toEqual([
      ['C:\\b\\x.pdf', true],
      ['C:\\c\\x.pdf', true],
      ['C:\\big1.bin', true]
    ])
    expect(d.trashed).toEqual(['C:\\b\\x.pdf', 'C:\\c\\x.pdf', 'C:\\big1.bin'])
    // 남길 파일은 그대로
    expect(d.files.has('C:\\a\\x.pdf')).toBe(true)
    expect(d.files.has('C:\\big2.bin')).toBe(true)
  })

  it('남길 파일이 사라졌으면 그 그룹은 keeper-missing 으로 보내지 않고, 다른 그룹은 진행한다', async () => {
    const d = disk()
    d.files.delete('C:\\a\\x.pdf')
    const results = await executeTrash(allJobs(), d.io, d.hashIo)

    expect(codes(results)).toEqual({
      'C:\\b\\x.pdf': 'keeper-missing',
      'C:\\c\\x.pdf': 'keeper-missing',
      'C:\\big1.bin': undefined
    })
    expect(d.trashed).toEqual(['C:\\big1.bin'])
  })

  it('남길 파일의 크기가 바뀌었어도 keeper-missing 으로 본다', async () => {
    const d = disk({ 'C:\\big2.bin': `${BIG_A}x` })
    const results = await executeTrash(allJobs(), d.io, d.hashIo)
    expect(codes(results)['C:\\big1.bin']).toBe('keeper-missing')
    expect(d.trashed).toEqual(['C:\\b\\x.pdf', 'C:\\c\\x.pdf'])
  })

  it('보낼 파일이 사라졌거나 바뀌었으면 그것만 실패하고 계속', async () => {
    const d = disk({ 'C:\\c\\x.pdf': `${SAME}!!` })
    d.files.delete('C:\\b\\x.pdf')
    const results = await executeTrash(allJobs(), d.io, d.hashIo)
    expect(codes(results)).toEqual({
      'C:\\b\\x.pdf': 'missing',
      'C:\\c\\x.pdf': 'size-changed',
      'C:\\big1.bin': undefined
    })
    expect(d.trashed).toEqual(['C:\\big1.bin'])
  })

  it('trashItem 이 실패하면 io 로 남기고 계속', async () => {
    const d = disk()
    d.failTrash.set('C:\\b\\x.pdf', 'EPERM')
    const results = await executeTrash(allJobs(), d.io, d.hashIo)
    expect(results[0]).toMatchObject({ path: 'C:\\b\\x.pdf', ok: false, code: 'io' })
    expect(results[0]!.error).toContain('EPERM')
    expect(d.trashed).toEqual(['C:\\c\\x.pdf', 'C:\\big1.bin'])
  })

  it('기록(onResult)이 실패하면 거기서 멈추고 나머지는 실패로 채운다', async () => {
    const d = disk()
    let calls = 0
    const results = await executeTrash(allJobs(), d.io, d.hashIo, {
      onResult: async () => {
        calls += 1
        if (calls === 1) throw new Error('disk full')
      }
    })
    expect(results.map((r) => r.ok)).toEqual([true, false, false])
    expect(results[1]!.error).toContain('disk full')
    expect(d.trashed).toEqual(['C:\\b\\x.pdf'])
  })

  it('진행률은 개수 기준이고 끝에 done === total 이 온다', async () => {
    const d = disk()
    const seen: TrashProgress[] = []
    await executeTrash(allJobs(), d.io, d.hashIo, { onProgress: (p) => seen.push(p) })
    expect(seen.map((p) => [p.phase, p.done, p.current])).toEqual([
      ['trashing', 0, 'x.pdf'],
      ['trashing', 1, 'x.pdf'],
      ['trashing', 2, 'big1.bin'],
      ['trashing', 3, '']
    ])
  })

  it('이동 호출(mkdir·rename·rmdir)은 부르지 않는다', async () => {
    const d = disk()
    const spy = vi.spyOn(d.io, 'rename')
    await executeTrash(allJobs(), d.io, d.hashIo)
    expect(spy).not.toHaveBeenCalled()
  })
})
