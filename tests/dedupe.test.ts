import { lstat, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileEntry, TrashItem } from '@shared/types'

/**
 * 휴지통 계획(dedupe.ts). 남길 파일 규칙과 계획 모양은 순수 함수로, buildTrashPlan 은 scan.ts 의 조회만
 * 바꿔 끼워 "화면이 본 스캔과 같을 때만 응한다"를 본다 (plan.test.ts 와 같은 방식).
 * executeTrashApproved 는 실제 임시 디렉터리 + 실제 해시(NODE_HASH_IO) + 가짜 trashItem(옆 폴더로 rename)으로
 * 조율 순서를 본다 — "걸리면 아무것도 안 보낸다", "기록을 못 남기면 안 보낸다", "끝나면 목록을 버린다".
 */
const scanState = vi.hoisted(() => ({
  groups: [] as FileEntry[][],
  scannedAt: 0,
  staleCalls: 0
}))

vi.mock('../src/main/services/scan', () => ({
  getLastDuplicateGroups: () => scanState.groups,
  getLastScannedAt: () => scanState.scannedAt,
  markStale: () => {
    scanState.groups = []
    scanState.scannedAt = 0
    scanState.staleCalls += 1
  }
}))

import { NODE_HASH_IO } from '../src/main/lib/hash'
import { beginActivity, currentActivity } from '../src/main/services/activity'
import {
  buildTrashPlan,
  chooseKeeper,
  executeTrashApproved,
  getLastTrashPlan,
  reclaimableOf,
  toTrashPlan
} from '../src/main/services/dedupe'
import type { ExecutorIo } from '../src/main/services/executor'
import { readJournal } from '../src/main/services/journal'
import { undoExecution } from '../src/main/services/undo'

let base = ''
beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'pc-organizer-dedupe-'))
})
afterAll(async () => {
  // 테스트가 만든 임시 디렉터리만 지운다 (사용자 파일이 아니다)
  await rm(base, { recursive: true, force: true })
})
beforeEach(() => {
  scanState.staleCalls = 0
})

const NOW = new Date('2026-09-13T00:00:00Z').getTime()
const DAY = 86_400_000

function entry(path: string, overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    path,
    name: path.split(/[\\/]/).pop() ?? path,
    ext: '.bin',
    size: 100,
    mtimeMs: NOW,
    atimeMs: NOW,
    category: 'other',
    isCloudOnly: false,
    ...overrides
  }
}

function item(id: string, overrides: Partial<TrashItem> = {}): TrashItem {
  return { id, path: id, name: id, size: 100, mtimeMs: NOW, lastTouchedMs: NOW, ...overrides }
}

describe('chooseKeeper', () => {
  it('가장 최근에 손댄 것을 남긴다', () => {
    const items = [
      item('old', { lastTouchedMs: NOW - 30 * DAY }),
      item('fresh', { lastTouchedMs: NOW }),
      item('older', { lastTouchedMs: NOW - 90 * DAY })
    ]
    expect(chooseKeeper(items).id).toBe('fresh')
  })

  it('같으면 경로가 짧은 것 — 더 위 폴더에 있는 쪽', () => {
    const items = [
      item('a', { path: 'C:\\Users\\me\\Desktop\\deep\\copy\\x.pdf' }),
      item('b', { path: 'C:\\Users\\me\\Desktop\\x.pdf' }),
      item('c', { path: 'C:\\Users\\me\\Desktop\\other\\x.pdf' })
    ]
    expect(chooseKeeper(items).id).toBe('b')
  })

  it('그래도 같으면 앞의 것', () => {
    const items = [item('first'), item('secnd'), item('third')]
    expect(chooseKeeper(items).id).toBe('first')
  })

  it('빈 그룹은 거부한다', () => {
    expect(() => chooseKeeper([])).toThrow()
  })
})

describe('toTrashPlan', () => {
  const meta = { id: 'plan-1', now: NOW, scannedAt: 123 }

  it('그룹마다 남길 파일 하나를 고르고 전부 포함 상태로 시작한다', () => {
    const groups = [
      [
        entry('C:\\a\\x.pdf', { mtimeMs: NOW - DAY, atimeMs: NOW - DAY }),
        entry('C:\\b\\x.pdf', { mtimeMs: NOW, atimeMs: NOW - DAY })
      ]
    ]

    const plan = toTrashPlan(groups, meta)

    expect(plan).toMatchObject({ id: 'plan-1', createdAt: NOW, scannedAt: 123 })
    expect(plan.groups).toHaveLength(1)
    const group = plan.groups[0]!
    expect(group.items.map((it) => it.path)).toEqual(['C:\\a\\x.pdf', 'C:\\b\\x.pdf'])
    expect(group.keepId).toBe(group.items[1]!.id)
    expect(group.included).toBe(true)
    expect(group.size).toBe(100)
  })

  it('항목 id 는 계획 안에서 유일하고 그룹 id 를 접두로 갖는다', () => {
    const groups = [
      [entry('a1', { size: 10 }), entry('a2', { size: 10 })],
      [entry('b1', { size: 20 }), entry('b2', { size: 20 }), entry('b3', { size: 20 })]
    ]

    const plan = toTrashPlan(groups, meta)
    const ids = plan.groups.flatMap((g) => g.items.map((it) => it.id))

    expect(new Set(ids).size).toBe(ids.length)
    for (const g of plan.groups) {
      for (const it of g.items) expect(it.id.startsWith(`${g.id}.`)).toBe(true)
      expect(g.items.some((it) => it.id === g.keepId)).toBe(true)
    }
  })

  it('지울 수 있는 용량이 큰 그룹이 앞이다', () => {
    const groups = [
      [entry('small1', { size: 10 }), entry('small2', { size: 10 })],
      // 5 × 2개분 = 10 < 30 × 1개분 = 30 < 10 × 5개분 = 50
      [entry('many1', { size: 10 }), entry('many2', { size: 10 }), entry('many3', { size: 10 }),
        entry('many4', { size: 10 }), entry('many5', { size: 10 }), entry('many6', { size: 10 })],
      [entry('mid1', { size: 30 }), entry('mid2', { size: 30 })]
    ]

    const plan = toTrashPlan(groups, meta)

    expect(plan.groups.map(reclaimableOf)).toEqual([50, 30, 10])
  })

  it('둘 미만인 그룹은 버린다 — 지울 것이 없다', () => {
    const plan = toTrashPlan([[entry('alone')], [entry('p1'), entry('p2')]], meta)
    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0]!.items).toHaveLength(2)
  })

  it('lastTouchedMs 는 atime 과 mtime 중 큰 쪽이다', () => {
    const groups = [[entry('x', { atimeMs: NOW - 900 * DAY, mtimeMs: NOW - DAY }), entry('y')]]
    const plan = toTrashPlan(groups, meta)
    expect(plan.groups[0]!.items[0]!.lastTouchedMs).toBe(NOW - DAY)
  })

  it('경로·이름·크기·수정일만 옮겨 적는다 (FileEntry 를 통째로 펼치지 않는다)', () => {
    const plan = toTrashPlan([[entry('p1'), entry('p2')]], meta)
    expect(Object.keys(plan.groups[0]!.items[0]!).sort()).toEqual(
      ['id', 'lastTouchedMs', 'mtimeMs', 'name', 'path', 'size'].sort()
    )
  })
})

describe('buildTrashPlan', () => {
  it('화면이 본 스캔과 같을 때만 응하고 결과를 main 에 남긴다', () => {
    scanState.groups = [[entry('p1'), entry('p2')]]
    scanState.scannedAt = 1000

    const plan = buildTrashPlan(1000)

    expect(plan.scannedAt).toBe(1000)
    expect(plan.groups).toHaveLength(1)
    expect(getLastTrashPlan()).toBe(plan)
  })

  it('스캔 전이면 거부한다', () => {
    scanState.groups = []
    scanState.scannedAt = 0
    expect(() => buildTrashPlan(0)).toThrow('먼저 스캔')
  })

  it('화면의 스캔 결과가 낡았으면 거부한다', () => {
    scanState.groups = [[entry('p1'), entry('p2')]]
    scanState.scannedAt = 2000
    expect(() => buildTrashPlan(1000)).toThrow('최신이 아닙니다')
  })

  it('스캔·실행·실행취소가 도는 동안은 거부한다', () => {
    scanState.groups = [[entry('p1'), entry('p2')]]
    scanState.scannedAt = 3000
    const release = beginActivity('scan')
    try {
      expect(() => buildTrashPlan(3000)).toThrow('진행 중')
    } finally {
      release()
    }
    expect(buildTrashPlan(3000).groups).toHaveLength(1)
  })
})

// ---------------------------------------------------------------- 실행 (실제 파일시스템 + 가짜 휴지통)

/** 실제 FileEntry — 스캐너가 만드는 모양 그대로 */
async function realEntry(path: string): Promise<FileEntry> {
  const st = await stat(path)
  return {
    path,
    name: basename(path),
    ext: '.bin',
    size: st.size,
    mtimeMs: st.mtimeMs,
    atimeMs: st.atimeMs,
    category: 'other',
    isCloudOnly: false
  }
}

/**
 * 휴지통을 흉내 내는 io — trashItem 은 옆 폴더로 rename. 이동 호출은 부르면 안 되니 던진다.
 * (shell.trashItem 은 electron 이라 Vitest 에서 못 부른다. 실제 배선은 handlers.ts, 실앱 검증은 Playwright)
 */
function fakeTrashIo(trashDir: string): { io: ExecutorIo; trashed: string[] } {
  const trashed: string[] = []
  const io: ExecutorIo = {
    lstat,
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
      await rename(path, join(trashDir, `${trashed.length}-${basename(path)}`))
      trashed.push(path)
    }
  }
  return { io, trashed }
}

/** 임시 루트에 같은 내용 사본들을 만들고 scan 모듈 흉내를 그 그룹으로 채운다 */
async function fixture(name: string): Promise<{ root: string; trashDir: string; journalPath: string }> {
  const root = join(base, name)
  const trashDir = join(base, `${name}-trash`)
  await mkdir(join(root, 'backup', 'old'), { recursive: true })
  await mkdir(trashDir, { recursive: true })
  const big = 'A'.repeat(70_000)
  const small = 'b'.repeat(3_000)
  await writeFile(join(root, 'report.pdf'), big)
  await writeFile(join(root, 'backup', 'report.pdf'), big)
  await writeFile(join(root, 'backup', 'old', 'report.pdf'), big)
  await writeFile(join(root, 'img.jpg'), small)
  await writeFile(join(root, 'backup', 'img.jpg'), small)
  await writeFile(join(root, 'unique.txt'), 'only one')

  scanState.groups = [
    [
      await realEntry(join(root, 'report.pdf')),
      await realEntry(join(root, 'backup', 'report.pdf')),
      await realEntry(join(root, 'backup', 'old', 'report.pdf'))
    ],
    [await realEntry(join(root, 'img.jpg')), await realEntry(join(root, 'backup', 'img.jpg'))]
  ]
  scanState.scannedAt = Date.now()
  return { root, trashDir, journalPath: join(base, `${name}-journal.json`) }
}

const listing = async (dir: string): Promise<string[]> =>
  (await readdir(dir, { recursive: true })).map((p) => p.replace(/\\/g, '/')).sort()

describe('executeTrashApproved — 실제 파일시스템', () => {
  it('남길 파일을 뺀 나머지만 휴지통으로, 저널에 kind: trash 로 남기고, 목록을 버린다', async () => {
    const { root, trashDir, journalPath } = await fixture('roundtrip')
    const plan = buildTrashPlan(scanState.scannedAt)
    const { io, trashed } = fakeTrashIo(trashDir)
    // 그룹 0 은 backup/report.pdf 를 남기고, 그룹 1 은 기본값(가장 최근 손댄 것)을 남긴다
    const g0 = plan.groups.find((g) => g.size === 70_000)!
    const g1 = plan.groups.find((g) => g.size === 3_000)!
    const keep0 = g0.items.find((it) => it.path === join(root, 'backup', 'report.pdf'))!
    const keep1 = g1.items.find((it) => it.id === g1.keepId)!

    const progress: string[] = []
    const outcome = await executeTrashApproved(
      [
        { groupId: g0.id, keepId: keep0.id },
        { groupId: g1.id, keepId: keep1.id }
      ],
      { io, hashIo: NODE_HASH_IO, journalPath, onProgress: (p) => progress.push(p.phase) }
    )

    expect(outcome.status).toBe('done')
    if (outcome.status !== 'done') return
    expect(outcome.journalError).toBeUndefined()
    expect(outcome.entry.results.every((r) => r.ok)).toBe(true)
    expect(outcome.entry.results.map((r) => r.path).sort()).toEqual(
      [
        join(root, 'report.pdf'),
        join(root, 'backup', 'old', 'report.pdf'),
        g1.items.find((it) => it.id !== g1.keepId)!.path
      ].sort()
    )
    expect(outcome.entry.keptPaths.sort()).toEqual([keep0.path, keep1.path].sort())

    // 디스크: 남긴 둘 + unique 만 남고, 보낸 셋은 휴지통 폴더에
    const remaining = await listing(root)
    expect(remaining).toContain('backup/report.pdf')
    expect(remaining).toContain('unique.txt')
    expect(remaining.filter((p) => p.endsWith('report.pdf'))).toEqual(['backup/report.pdf'])
    expect(remaining.filter((p) => p.endsWith('img.jpg'))).toHaveLength(1)
    expect(trashed).toHaveLength(3)
    expect(await readdir(trashDir)).toHaveLength(3)

    // 진행률은 검증 → 보내기 순서
    expect(progress.indexOf('trashing')).toBeGreaterThan(progress.lastIndexOf('verifying'))

    // 저널
    const [saved] = await readJournal(journalPath)
    expect(saved).toMatchObject({ kind: 'trash', id: outcome.entry.id })
    expect(saved && saved.kind === 'trash' ? saved.results.length : 0).toBe(3)

    // 목록·계획은 버려졌고 자물쇠는 풀렸다
    expect(scanState.staleCalls).toBe(1)
    expect(getLastTrashPlan()).toBeNull()
    expect(currentActivity()).toBeNull()

    // 휴지통 기록은 되돌릴 수 없다 — 윈도우 휴지통에서
    await expect(undoExecution(outcome.entry.id, io, journalPath)).rejects.toThrow('휴지통에서 복원')
  })

  it('사본 하나의 뒷부분이 바뀌었으면(앞 4KB 는 같음) 아무것도 보내지 않는다', async () => {
    const { root, trashDir, journalPath } = await fixture('blocked')
    const plan = buildTrashPlan(scanState.scannedAt)
    const { io, trashed } = fakeTrashIo(trashDir)
    // 스캔 뒤에 내용이 바뀌었다 — 크기는 그대로, 앞 4KB 도 그대로
    const changed = join(root, 'backup', 'old', 'report.pdf')
    await writeFile(changed, 'A'.repeat(69_999) + 'Z')
    // 남길 파일은 루트의 것 — 바뀐 사본과 비교하면 그것 하나만 다르다고 나와야 한다
    const g0 = plan.groups.find((g) => g.size === 70_000)!
    const keep0 = g0.items.find((it) => it.path === join(root, 'report.pdf'))!

    const outcome = await executeTrashApproved(
      plan.groups.map((g) => ({ groupId: g.id, keepId: g.id === g0.id ? keep0.id : g.keepId })),
      { io, hashIo: NODE_HASH_IO, journalPath }
    )

    expect(outcome.status).toBe('blocked')
    if (outcome.status !== 'blocked') return
    expect(outcome.problems.map((p) => [p.path, p.code])).toEqual([[changed, 'hash-mismatch']])
    expect(trashed).toEqual([])
    expect(await readdir(trashDir)).toEqual([])
    expect((await listing(root)).filter((p) => p.endsWith('report.pdf'))).toHaveLength(3)
    // 기록도 없고, 계획은 그대로 살아 있어 걸린 그룹을 빼고 다시 할 수 있다
    expect(await readJournal(journalPath)).toEqual([])
    expect(getLastTrashPlan()).toBe(plan)
    expect(scanState.staleCalls).toBe(0)
  })

  it('파일이 움직인 뒤(스캔 목록이 낡음)에는 거부한다', async () => {
    const { trashDir, journalPath } = await fixture('stale')
    const plan = buildTrashPlan(scanState.scannedAt)
    scanState.scannedAt = 0 // markStale 이 한 일
    const { io, trashed } = fakeTrashIo(trashDir)

    await expect(
      executeTrashApproved([{ groupId: plan.groups[0]!.id, keepId: plan.groups[0]!.keepId }], {
        io,
        hashIo: NODE_HASH_IO,
        journalPath
      })
    ).rejects.toThrow('낡았습니다')
    expect(trashed).toEqual([])
  })

  it('기록을 남길 수 없으면 보내지 않는다', async () => {
    const { trashDir } = await fixture('nojournal')
    const plan = buildTrashPlan(scanState.scannedAt)
    const { io, trashed } = fakeTrashIo(trashDir)
    // 저널 경로의 부모가 파일이라 mkdir 이 실패한다
    const blocker = join(base, 'nojournal-blocker')
    await writeFile(blocker, 'x')

    await expect(
      executeTrashApproved([{ groupId: plan.groups[0]!.id, keepId: plan.groups[0]!.keepId }], {
        io,
        hashIo: NODE_HASH_IO,
        journalPath: join(blocker, 'journal.json')
      })
    ).rejects.toThrow('기록을 남길 수 없어')
    expect(trashed).toEqual([])
    expect(scanState.staleCalls).toBe(0)
    expect(getLastTrashPlan()).toBe(plan)
  })

  it('스캔·실행·실행취소가 도는 동안은 거부한다', async () => {
    const { trashDir, journalPath } = await fixture('locked')
    const plan = buildTrashPlan(scanState.scannedAt)
    const { io, trashed } = fakeTrashIo(trashDir)
    const release = beginActivity('scan')
    try {
      await expect(
        executeTrashApproved([{ groupId: plan.groups[0]!.id, keepId: plan.groups[0]!.keepId }], {
          io,
          hashIo: NODE_HASH_IO,
          journalPath
        })
      ).rejects.toThrow('진행 중')
    } finally {
      release()
    }
    expect(trashed).toEqual([])
  })

  it('요청이 계획과 어긋나면 전체 거부한다', async () => {
    const { trashDir, journalPath } = await fixture('mismatch')
    buildTrashPlan(scanState.scannedAt)
    const { io, trashed } = fakeTrashIo(trashDir)
    await expect(
      executeTrashApproved([{ groupId: 'nope', keepId: 'x' }], { io, hashIo: NODE_HASH_IO, journalPath })
    ).rejects.toThrow('계획에 없는 그룹')
    expect(trashed).toEqual([])
  })
})
