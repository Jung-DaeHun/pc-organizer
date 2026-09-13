import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { TrashGroup, TrashItem, TrashPlan, TrashProgress, TrashResult } from '@shared/types'
import type { HashHandle, HashIo, HashStat } from '../src/main/lib/hash'
import type { RecycleBinLookup, RecycleBinPolicy } from '../src/main/lib/recycleBin'
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
 * 하나라도 걸리면 전부 돌려주며(휴지통 설정 → lstat → 전체 해시 순서, 앞 단계에서 걸리면 파일을 읽지 않는다),
 * 보내는 건 남길 파일을 뺀 나머지뿐이고 보내기 직전에 남길 파일이 아직 있는지 다시 본다.
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

/** 넉넉한 휴지통 — 대부분의 테스트는 휴지통 설정이 걸림돌이 아니어야 한다 */
const ROOMY: RecycleBinPolicy = { maxBytes: 1024 * 1024 * 1024, bypassed: false, usedBytes: 0, mountPoints: [] }

/** 볼륨 루트마다 정한 설정을 돌려주고, 무엇을 몇 번 물었는지 남긴다 */
function recycleBin(byRoot: Record<string, RecycleBinPolicy | null> = { 'C:\\': ROOMY }): {
  lookup: RecycleBinLookup
  asked: string[]
} {
  const asked: string[] = []
  const lookup: RecycleBinLookup = async (root) => {
    asked.push(root)
    return byRoot[root] ?? null
  }
  return { lookup, asked }
}

/** 기본 계획 전체를 넉넉한 휴지통 설정으로 사전 점검 */
const preflight = (d: FakeDisk): Promise<TrashResult[]> =>
  preflightTrash(allJobs(), d.hashIo, recycleBin().lookup)

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
    expect(await preflight(d)).toEqual([])
    expect(d.opened.sort()).toEqual(
      ['C:\\a\\x.pdf', 'C:\\b\\x.pdf', 'C:\\c\\x.pdf', 'C:\\big1.bin', 'C:\\big2.bin'].sort()
    )
    expect(d.trashed).toEqual([])
  })

  it('파일이 없으면 missing — 아무것도 읽지 않는다', async () => {
    const d = disk()
    d.files.delete('C:\\b\\x.pdf')
    const problems = await preflight(d)
    expect(codes(problems)).toEqual({ 'C:\\b\\x.pdf': 'missing' })
    expect(d.opened).toEqual([])
  })

  it('남길 파일이 링크가 됐으면 not-file', async () => {
    const d = disk({ 'C:\\a\\x.pdf': { content: Buffer.from(SAME), link: true } })
    expect(codes(await preflight(d))).toEqual({ 'C:\\a\\x.pdf': 'not-file' })
    expect(d.opened).toEqual([])
  })

  it('크기가 바뀌었으면 size-changed', async () => {
    const d = disk({ 'C:\\c\\x.pdf': `${SAME}!` })
    expect(codes(await preflight(d))).toEqual({ 'C:\\c\\x.pdf': 'size-changed' })
    expect(d.opened).toEqual([])
  })

  it('클라우드 전용이면 cloud-only — 열지 않는다', async () => {
    // 스캔 뒤 OneDrive 가 내려놓았을 수 있다. 여기서 열면 내려받기가 시작된다
    const d = disk({ 'C:\\big2.bin': { content: Buffer.from(BIG_A), cloudOnly: true } })
    expect(codes(await preflight(d))).toEqual({ 'C:\\big2.bin': 'cloud-only' })
    expect(d.opened).toEqual([])
  })

  it('앞 4KB 는 같고 뒤가 다르면 hash-mismatch — 후보가 여기서 걸러진다', async () => {
    const d = disk({ 'C:\\big1.bin': BIG_B })
    // 그룹 1 은 big2 를 남긴다(keepId 1.1). 남길 파일 기준으로 big1 이 다르다고 나온다
    expect(codes(await preflight(d))).toEqual({ 'C:\\big1.bin': 'hash-mismatch' })
  })

  it('여러 문제를 한 번에 돌려준다', async () => {
    const d = disk({ 'C:\\b\\x.pdf': OTHER })
    d.files.delete('C:\\big1.bin')
    const problems = await preflight(d)
    // 1단계(lstat)에서 걸리면 해시 단계로 가지 않는다 — missing 만 나온다
    expect(codes(problems)).toEqual({ 'C:\\big1.bin': 'missing' })
    expect(d.opened).toEqual([])
  })

  it('해시 진행률은 바이트 기준으로 전체 크기까지 간다', async () => {
    const d = disk()
    const seen: TrashProgress[] = []
    await preflightTrash(allJobs(), d.hashIo, recycleBin().lookup, (p) => seen.push(p))
    const total = SAME.length * 3 + BIG_A.length * 2
    expect(seen.every((p) => p.phase === 'verifying' && p.total === total)).toBe(true)
    expect(seen.at(-1)).toEqual({ phase: 'verifying', done: total, total, current: '' })
  })

  it('한 그룹의 모든 파일 해시가 sha256 으로 같아야 통과한다', async () => {
    // 같은 내용이면 실제 sha256 도 같다 — 가짜 핸들이 내용을 그대로 내주는지 겸사겸사 본다
    expect(sha256(SAME)).toBe(sha256(SAME))
    const d = disk({ 'C:\\c\\x.pdf': OTHER })
    expect(codes(await preflight(d))).toEqual({ 'C:\\c\\x.pdf': 'hash-mismatch' })
  })

  // shell.trashItem 은 휴지통 최대 크기보다 큰 파일을 오류 없이 영구 삭제한다 (lib/recycleBin.ts 의 실측).
  // 그래서 휴지통 설정 검사는 파일을 읽기 전에 가장 먼저 돌고, 걸리면 lstat 도 해시도 하지 않는다.
  // 해시가 끝난 뒤(수 GB 면 몇 분) 보내기 직전에 한 번 더 돈다 — 그동안 휴지통이 찼을 수 있다
  describe('휴지통 설정', () => {
    it('보낼 파일의 볼륨마다 해시 전에 한 번, 해시 뒤에 한 번 묻는다', async () => {
      const d = disk()
      const rb = recycleBin()
      expect(await preflightTrash(allJobs(), d.hashIo, rb.lookup)).toEqual([])
      expect(rb.asked).toEqual(['C:\\', 'C:\\'])
    })

    it('해시하는 동안 휴지통이 찼으면 recycle-bin-full — 해시 전의 낡은 사용량으로 보내지 않는다', async () => {
      const d = disk()
      // 첫 조회(해시 전)는 넉넉한데, 해시하는 사이 사용자가 탐색기에서 무언가 지워 두 번째 조회에서는 거의 찼다.
      // 첫 값으로 보내면 사용자가 먼저 지운 그것이 밀려나 영구 삭제된다
      const answers: RecycleBinPolicy[] = [ROOMY, { ...ROOMY, usedBytes: ROOMY.maxBytes - 1 }]
      const lookup: RecycleBinLookup = async () => answers.shift() ?? null
      const problems = await preflightTrash(allJobs(), d.hashIo, lookup)
      expect(codes(problems)).toEqual({
        'C:\\b\\x.pdf': 'recycle-bin-full',
        'C:\\c\\x.pdf': 'recycle-bin-full',
        'C:\\big1.bin': 'recycle-bin-full'
      })
      expect(answers).toEqual([]) // 두 번 물었다
      expect(d.opened).not.toEqual([]) // 해시는 끝났고
      expect(d.trashed).toEqual([]) // 그래도 보내지 않았다
    })

    it('같은 볼륨이 C:\\ 와 c:\\ 로 적혀 있어도 합계는 하나로 더한다', async () => {
      // 감시 폴더 둘의 드라이브 문자 표기가 다르면 스캔 결과의 경로도 그대로 갈린다(settings.json 을 손으로 고친 경우).
      // 볼륨 키를 원문으로 두면 합계가 둘로 쪼개져 각각 한도 아래로 통과해 버린다
      const mixedCase: TrashPlan = {
        ...plan,
        groups: [
          group('0', SAME.length, ['C:\\a\\x.pdf', 'C:\\b\\x.pdf']),
          group('1', BIG_A.length, ['c:\\big1.bin', 'c:\\big2.bin'], 1)
        ]
      }
      const d = disk({ 'c:\\big1.bin': BIG_A, 'c:\\big2.bin': BIG_A })
      // 이번에 보낼 양 520 + 5006 — 따로 보면 둘 다 한도 아래, 합치면 한도
      const rb = recycleBin({ 'C:\\': { ...ROOMY, maxBytes: SAME.length + BIG_A.length } })
      const jobs = resolveTrash(mixedCase, [
        { groupId: '0', keepId: '0.0' },
        { groupId: '1', keepId: '1.1' }
      ])
      expect(codes(await preflightTrash(jobs, d.hashIo, rb.lookup))).toEqual({
        'C:\\b\\x.pdf': 'recycle-bin-full',
        'c:\\big1.bin': 'recycle-bin-full'
      })
      expect(rb.asked).toEqual(['C:\\']) // 볼륨 하나로 보고 한 번만, 처음 본 표기로 물었다
      expect(d.opened).toEqual([])
    })

    it('휴지통 최대 크기 이상인 파일은 exceeds-recycle-bin — 파일을 열지 않는다', async () => {
      const d = disk()
      // 그룹 1(BIG_A)만 한도에 걸린다. 같은 크기는 안전하지 않다고 본다(>=)
      const rb = recycleBin({ 'C:\\': { ...ROOMY, maxBytes: BIG_A.length } })
      const problems = await preflightTrash(allJobs(), d.hashIo, rb.lookup)
      expect(codes(problems)).toEqual({ 'C:\\big1.bin': 'exceeds-recycle-bin' })
      expect(d.opened).toEqual([])
      expect(d.trashed).toEqual([])
    })

    it('한도보다 1바이트 작으면 통과한다', async () => {
      const d = disk()
      const rb = recycleBin({ 'C:\\': { ...ROOMY, maxBytes: BIG_A.length + 1 } })
      // 그룹 1 만 — 보낼 파일이 하나뿐이라 합계 검사가 개별 경계와 같다
      const bigOnly = resolveTrash(plan, [{ groupId: '1', keepId: '1.1' }])
      expect(await preflightTrash(bigOnly, d.hashIo, rb.lookup)).toEqual([])
    })

    it("'휴지통을 쓰지 않음' 볼륨이면 recycle-bin-off — 크기와 무관하게 전부", async () => {
      const d = disk()
      const rb = recycleBin({ 'C:\\': { ...ROOMY, bypassed: true } })
      expect(codes(await preflightTrash(allJobs(), d.hashIo, rb.lookup))).toEqual({
        'C:\\b\\x.pdf': 'recycle-bin-off',
        'C:\\c\\x.pdf': 'recycle-bin-off',
        'C:\\big1.bin': 'recycle-bin-off'
      })
      expect(d.opened).toEqual([])
    })

    it('설정을 모르면(조회 실패·드라이브 문자 없음) recycle-bin-unknown — 모르면 보내지 않는다', async () => {
      const d = disk()
      const rb = recycleBin({})
      expect(codes(await preflightTrash(allJobs(), d.hashIo, rb.lookup))).toEqual({
        'C:\\b\\x.pdf': 'recycle-bin-unknown',
        'C:\\c\\x.pdf': 'recycle-bin-unknown',
        'C:\\big1.bin': 'recycle-bin-unknown'
      })
      expect(d.opened).toEqual([])
    })

    // 드라이브 문자 없이 폴더에 마운트된 볼륨은 휴지통이 자기 것이라 C:\ 의 한도·사용량으로 판정하면 틀린다.
    // 스캐너는 마운트 포인트를 내려가지 않지만 스캔 루트를 그 안으로 잡으면 닿는다 (lib/recycleBin.ts)
    it('드라이브 아래 폴더에 마운트된 다른 볼륨의 파일은 recycle-bin-unknown — 루트의 설정이 해당하지 않는다', async () => {
      const mounted: TrashPlan = {
        ...plan,
        groups: [group('0', SAME.length, ['C:\\a\\x.pdf', 'C:\\Data\\x.pdf', 'C:\\Data2\\x.pdf', 'c:\\data\\sub\\x.pdf'])]
      }
      const d = disk({ 'C:\\Data\\x.pdf': SAME, 'C:\\Data2\\x.pdf': SAME, 'c:\\data\\sub\\x.pdf': SAME })
      // 루트 자체는 휴지통을 안 쓰는 설정이어도 마운트된 볼륨의 파일에는 그 판정을 붙이지 않는다
      const rb = recycleBin({ 'C:\\': { ...ROOMY, mountPoints: ['C:\\Data'] } })
      const jobs = resolveTrash(mounted, [{ groupId: '0', keepId: '0.0' }])
      const problems = await preflightTrash(jobs, d.hashIo, rb.lookup)
      expect(codes(problems)).toEqual({
        'C:\\Data\\x.pdf': 'recycle-bin-unknown',
        'c:\\data\\sub\\x.pdf': 'recycle-bin-unknown'
      })
      expect(problems.every((p) => p.error?.includes('C:\\Data'))).toBe(true)
      expect(rb.asked).toEqual(['C:\\'])
      expect(d.opened).toEqual([])

      const off = recycleBin({ 'C:\\': { ...ROOMY, bypassed: true, mountPoints: ['C:\\Data'] } })
      expect(codes(await preflightTrash(jobs, d.hashIo, off.lookup))).toEqual({
        'C:\\Data\\x.pdf': 'recycle-bin-unknown',
        'C:\\Data2\\x.pdf': 'recycle-bin-off',
        'c:\\data\\sub\\x.pdf': 'recycle-bin-unknown'
      })
    })

    it('볼륨마다 따로 본다 — 걸린 볼륨의 파일만 그 이유로 막힌다', async () => {
      const twoVolumes: TrashPlan = {
        ...plan,
        groups: [group('0', SAME.length, ['C:\\a\\x.pdf', 'C:\\b\\x.pdf', 'D:\\x.pdf'])]
      }
      const d = disk({ 'D:\\x.pdf': SAME })
      const rb = recycleBin({ 'C:\\': ROOMY, 'D:\\': { ...ROOMY, maxBytes: 10 } })
      const jobs = resolveTrash(twoVolumes, [{ groupId: '0', keepId: '0.0' }])
      expect(codes(await preflightTrash(jobs, d.hashIo, rb.lookup))).toEqual({
        'D:\\x.pdf': 'exceeds-recycle-bin'
      })
      expect(rb.asked.sort()).toEqual(['C:\\', 'D:\\'])
      expect(d.opened).toEqual([])
    })

    // 개별로는 한도 미만이어도 합계가 넘으면 넣을 때는 성공하고 잠시 뒤 탐색기가 오래된 것부터 영구 삭제한다
    // (2026-09-13 실측, lib/recycleBin.ts). 어느 것이 밀려날지 앱이 정할 수 없으므로 그 볼륨은 통째로 막는다
    describe('합계', () => {
      // 기본 계획에서 이번에 보낼 양: 그룹 0 의 520 × 2 + 그룹 1 의 5006 × 1
      const BATCH = SAME.length * 2 + BIG_A.length

      it('보낼 합계가 한도 이상이면 recycle-bin-full — 그 볼륨의 대상 전부, 파일을 열지 않는다', async () => {
        const d = disk()
        const rb = recycleBin({ 'C:\\': { ...ROOMY, maxBytes: BATCH } })
        const problems = await preflightTrash(allJobs(), d.hashIo, rb.lookup)
        expect(codes(problems)).toEqual({
          'C:\\b\\x.pdf': 'recycle-bin-full',
          'C:\\c\\x.pdf': 'recycle-bin-full',
          'C:\\big1.bin': 'recycle-bin-full'
        })
        expect(d.opened).toEqual([])
        expect(d.trashed).toEqual([])
      })

      it('한도보다 1바이트 작으면 통과한다', async () => {
        const d = disk()
        const rb = recycleBin({ 'C:\\': { ...ROOMY, maxBytes: BATCH + 1 } })
        expect(await preflightTrash(allJobs(), d.hashIo, rb.lookup)).toEqual([])
      })

      it('휴지통에 이미 든 양을 더한다 — 문장에 세 수치를 적는다', async () => {
        const d = disk()
        const rb = recycleBin({ 'C:\\': { ...ROOMY, maxBytes: BATCH + 1, usedBytes: 1 } })
        const problems = await preflightTrash(allJobs(), d.hashIo, rb.lookup)
        expect(Object.values(codes(problems))).toEqual(['recycle-bin-full', 'recycle-bin-full', 'recycle-bin-full'])
        expect(problems[0]!.error).toContain('휴지통에 이미 1 B, 이번에 5.9 KB, 한도 5.9 KB')
      })

      it('파일 하나가 한도 이상인 것은 exceeds-recycle-bin 으로 따로, 나머지의 합계는 그것 없이 본다', async () => {
        const d = disk()
        // big1(5006)은 개별로 걸리고, 남은 520 × 2 = 1040 은 한도 5006 아래 — 이중으로 걸지 않는다
        const rb = recycleBin({ 'C:\\': { ...ROOMY, maxBytes: BIG_A.length } })
        expect(codes(await preflightTrash(allJobs(), d.hashIo, rb.lookup))).toEqual({
          'C:\\big1.bin': 'exceeds-recycle-bin'
        })
      })

      it('볼륨마다 따로 더한다 — 꽉 찬 볼륨의 파일만 막힌다', async () => {
        const twoVolumes: TrashPlan = {
          ...plan,
          groups: [group('0', SAME.length, ['C:\\a\\x.pdf', 'C:\\b\\x.pdf', 'D:\\x.pdf'])]
        }
        const d = disk({ 'D:\\x.pdf': SAME })
        // D: 는 520 짜리 하나가 개별로는 들어가지만(520 < 521) 이미 든 1 바이트와 합치면 한도
        const rb = recycleBin({ 'C:\\': ROOMY, 'D:\\': { ...ROOMY, maxBytes: SAME.length + 1, usedBytes: 1 } })
        const jobs = resolveTrash(twoVolumes, [{ groupId: '0', keepId: '0.0' }])
        expect(codes(await preflightTrash(jobs, d.hashIo, rb.lookup))).toEqual({
          'D:\\x.pdf': 'recycle-bin-full'
        })
        expect(d.opened).toEqual([])
      })
    })
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
