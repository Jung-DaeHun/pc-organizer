import { lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecuteRequest, FileEntry, OrganizePlan } from '@shared/types'
import { defaultRules } from '@shared/rules'

/**
 * 조율 층(plan.executeApproved · undo.undoExecution · activity)의 테스트.
 *
 * 실행기(executor.ts)의 규칙은 tests/executor.test.ts 가 가짜 io 로 본다. 여기서 보는 건 그 위의 순서다 —
 * "사전 점검에 걸리면 아무것도 안 옮긴다", "기록을 남길 수 없으면 실행하지 않는다", "끝나면 계획과 스캔
 * 목록을 버린다", "실행취소는 한 번만", "스캔·실행·실행취소는 겹치지 않는다".
 *
 * store.ts 는 electron(app.getPath) 을 import 하고, scan.ts 의 목록은 실제 스캔으로만 채워진다.
 * 조율 층이 두 모듈에서 보는 건 getSettings 와 목록 조회뿐이라 그것만 바꿔 끼운다.
 */
const { settings, scanState } = vi.hoisted(() => ({
  settings: { watchedFolders: [] as string[], excludedDirNames: [] as string[], largeFileBytes: 0, oldFileDays: 0 },
  scanState: { entries: [] as FileEntry[], scannedAt: 0, staleCalls: 0 }
}))

vi.mock('../src/main/services/store', () => ({
  // 분류 규칙은 기본값 — a.pdf 는 '문서', b.zip 은 '압축' 으로 가야 아래 시나리오가 성립한다
  getSettings: async () => ({ ...settings, rules: defaultRules(), theme: 'dark' as const })
}))

vi.mock('../src/main/services/scan', () => ({
  getLastEntries: () => scanState.entries,
  getLastScannedAt: () => scanState.scannedAt,
  markStale: () => {
    scanState.entries = []
    scanState.scannedAt = 0
    scanState.staleCalls += 1
  }
}))

import { beginActivity, currentActivity } from '../src/main/services/activity'
import type { ExecutorIo } from '../src/main/services/executor'
import { readJournal } from '../src/main/services/journal'
import { buildPlan, executeApproved, getLastPlan } from '../src/main/services/plan'
import { undoExecution } from '../src/main/services/undo'

let base = ''
beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'pc-organizer-plan-'))
})
afterAll(async () => {
  // 테스트가 만든 임시 디렉터리만 지운다 (사용자 파일이 아니다)
  await rm(base, { recursive: true, force: true })
})

beforeEach(() => {
  scanState.staleCalls = 0
})

// ---------------------------------------------------------------- 픽스처

/** 쓰기 호출을 log 에 남기는 실제 io. "아무것도 옮기지 않았다"를 log 로 확인한다 */
function spyIo(): { io: ExecutorIo; log: string[] } {
  const log: string[] = []
  const io: ExecutorIo = {
    lstat,
    mkdir: async (p) => {
      log.push(`mkdir ${p}`)
      await mkdir(p)
    },
    rename: async (from, to) => {
      log.push(`rename ${from} -> ${to}`)
      await rename(from, to)
    },
    rmdir: async (p) => {
      log.push(`rmdir ${p}`)
      await rmdir(p)
    },
    // 이동·실행취소는 휴지통을 부르면 안 된다
    trashItem: async (p) => {
      log.push(`trashItem ${p}`)
      throw new Error('이동 실행이 trashItem 을 불렀습니다')
    }
  }
  return { io, log }
}

function fileEntry(root: string, name: string): FileEntry {
  return {
    path: join(root, name),
    name,
    ext: '',
    size: 1,
    mtimeMs: 0,
    atimeMs: 0,
    category: 'other',
    isCloudOnly: false
  }
}

/** 루트에 a.pdf · b.zip · stay.txt 를 만들고 그 루트로 계획까지 세운다 */
async function setUp(label: string): Promise<{ root: string; plan: OrganizePlan; journalPath: string }> {
  const root = join(base, label, 'root')
  await mkdir(root, { recursive: true })
  for (const name of ['a.pdf', 'b.zip', 'stay.txt']) await writeFile(join(root, name), name)

  settings.watchedFolders = [root]
  scanState.entries = ['a.pdf', 'b.zip', 'stay.txt'].map((name) => fileEntry(root, name))
  scanState.scannedAt = 1000

  const plan = await buildPlan(root, 1000)
  return { root, plan, journalPath: join(base, label, 'journal.json') }
}

function requestsFor(plan: OrganizePlan, names: Record<string, string>): ExecuteRequest[] {
  return plan.items
    .filter((p) => names[p.item.name] !== undefined)
    .map((p) => ({ id: p.item.id, toFolder: names[p.item.name] as string }))
}

// ---------------------------------------------------------------- 실행

describe('executeApproved — 실행의 조율', () => {
  it('옮기고 기록을 남긴 뒤 계획과 스캔 목록을 버린다', async () => {
    const { root, plan, journalPath } = await setUp('done')
    const { io, log } = spyIo()
    const progress: number[] = []

    const outcome = await executeApproved(requestsFor(plan, { 'a.pdf': '문서', 'b.zip': '압축' }), {
      io,
      journalPath,
      onProgress: (p) => progress.push(p.done)
    })

    expect(outcome.status).toBe('done')
    if (outcome.status !== 'done') return
    expect(outcome.entry.results.map((r) => [r.name, r.ok])).toEqual([
      ['a.pdf', true],
      ['b.zip', true]
    ])
    expect(outcome.entry.createdFolders).toEqual(['문서', '압축'])
    expect(outcome.journalError).toBeUndefined()
    expect(log.filter((l) => l.startsWith('rename'))).toHaveLength(2)
    expect(progress).toEqual([0, 1, 2])

    expect((await readdir(root)).sort()).toEqual(['stay.txt', '문서', '압축'].sort())
    expect(await readFile(join(root, '문서', 'a.pdf'), 'utf8')).toBe('a.pdf')

    // 저널에는 화면과 같은 결과가 남아 있다
    const [saved] = await readJournal(journalPath)
    expect(saved).toMatchObject({ id: outcome.entry.id, root, createdFolders: ['문서', '압축'] })
    expect(saved?.results).toHaveLength(2)

    // 파일이 움직였다 — 계획도 스캔 목록도 더는 맞지 않는다
    expect(getLastPlan()).toBeNull()
    expect(scanState.staleCalls).toBe(1)
    expect(currentActivity()).toBeNull()
  })

  it('사전 점검에 걸리면 아무것도 옮기지 않고(blocked) 계획·기록·스캔 목록을 그대로 둔다', async () => {
    const { root, plan, journalPath } = await setUp('blocked')
    // 목적지에 같은 이름이 이미 있다 — 덮어쓰지 않는다
    await mkdir(join(root, '문서'))
    await writeFile(join(root, '문서', 'a.pdf'), 'other')
    const { io, log } = spyIo()

    const outcome = await executeApproved(requestsFor(plan, { 'a.pdf': '문서', 'b.zip': '문서' }), {
      io,
      journalPath
    })

    expect(outcome.status).toBe('blocked')
    if (outcome.status !== 'blocked') return
    expect(outcome.problems.map((p) => [p.name, p.code])).toEqual([['a.pdf', 'exists']])
    // b.zip 은 문제가 없었지만 a.pdf 가 걸렸으니 그것도 옮기지 않는다
    expect(log).toEqual([])
    expect(await readFile(join(root, 'b.zip'), 'utf8')).toBe('b.zip')

    expect(await readJournal(journalPath)).toEqual([])
    expect(getLastPlan()).toBe(plan)
    expect(scanState.staleCalls).toBe(0)
    expect(currentActivity()).toBeNull()
  })

  it('기록을 남길 수 없으면 실행하지 않는다', async () => {
    const { root, plan } = await setUp('no-journal')
    // 저널 디렉터리 자리에 파일이 있어 mkdir 이 실패한다
    const blocker = join(base, 'no-journal', 'blocker')
    await writeFile(blocker, 'x')
    const { io, log } = spyIo()

    await expect(
      executeApproved(requestsFor(plan, { 'a.pdf': '문서' }), { io, journalPath: join(blocker, 'journal.json') })
    ).rejects.toThrow('실행 기록을 남길 수 없어 실행하지 않았습니다')

    expect(log).toEqual([])
    expect(await readFile(join(root, 'a.pdf'), 'utf8')).toBe('a.pdf')
    expect(getLastPlan()).toBe(plan)
    expect(scanState.staleCalls).toBe(0)
    expect(currentActivity()).toBeNull()
  })

  it('계획과 어긋난 요청은 전체를 거부하고 자물쇠를 놓는다', async () => {
    const { plan, journalPath } = await setUp('mismatch')
    const { io, log } = spyIo()

    await expect(
      executeApproved([...requestsFor(plan, { 'a.pdf': '문서' }), { id: '99', toFolder: '문서' }], {
        io,
        journalPath
      })
    ).rejects.toThrow('계획에 없는 항목')

    expect(log).toEqual([])
    expect(getLastPlan()).toBe(plan)
    expect(currentActivity()).toBeNull()
  })

  it('감시 폴더에서 빠진 루트는 실행하지 않는다', async () => {
    const { plan, journalPath } = await setUp('unwatched')
    settings.watchedFolders = []
    const { io, log } = spyIo()

    await expect(
      executeApproved(requestsFor(plan, { 'a.pdf': '문서' }), { io, journalPath })
    ).rejects.toThrow('감시 폴더로 등록된 경로가 아닙니다')
    expect(log).toEqual([])
    expect(currentActivity()).toBeNull()
  })
})

// ---------------------------------------------------------------- 실행취소

describe('undoExecution — 실행취소의 조율', () => {
  it('저널의 기록을 되돌리고 undoneAt 을 찍는다. 두 번은 안 된다', async () => {
    const { root, plan, journalPath } = await setUp('undo')
    const { io } = spyIo()
    const done = await executeApproved(requestsFor(plan, { 'a.pdf': '문서', 'b.zip': '문서' }), {
      io,
      journalPath
    })
    if (done.status !== 'done') throw new Error('실행이 done 이어야 한다')
    scanState.staleCalls = 0

    const outcome = await undoExecution(done.entry.id, io, journalPath)
    expect(outcome.results.map((r) => [r.name, r.ok])).toEqual([
      ['b.zip', true],
      ['a.pdf', true]
    ])
    expect(outcome.removedFolders).toEqual(['문서'])
    expect(outcome.keptFolders).toEqual([])
    expect((await readdir(root)).sort()).toEqual(['a.pdf', 'b.zip', 'stay.txt'])

    // 저널에 되돌린 결과가 남고, 남긴 폴더 목록도 같이 적힌다 (화면이 createdFolders 로 계산하지 않게)
    const [saved] = await readJournal(journalPath)
    expect(saved).toMatchObject({ removedFolders: ['문서'], keptFolders: [] })
    expect(saved && saved.kind !== 'trash' ? saved.undoneAt : undefined).toBeTypeOf('number')

    expect(scanState.staleCalls).toBe(1)
    expect(currentActivity()).toBeNull()

    await expect(undoExecution(done.entry.id, io, journalPath)).rejects.toThrow('이미 되돌린 기록입니다')
    expect(currentActivity()).toBeNull()
  })

  it('없는 기록이면 예외이고 스캔 목록은 건드리지 않는다', async () => {
    const { io, log } = spyIo()
    await expect(undoExecution('nope', io, join(base, 'undo-missing.json'))).rejects.toThrow(
      '그런 실행 기록이 없습니다'
    )
    expect(log).toEqual([])
    expect(scanState.staleCalls).toBe(0)
    expect(currentActivity()).toBeNull()
  })
})

// ---------------------------------------------------------------- 스캔 · 실행 · 실행취소는 겹치지 않는다

describe('activity — 한 번에 하나만', () => {
  it('스캔 중에는 실행·실행취소·계획 세우기를 전부 거부한다', async () => {
    const { root, plan, journalPath } = await setUp('locked')
    const { io, log } = spyIo()

    const release = beginActivity('scan')
    try {
      await expect(
        executeApproved(requestsFor(plan, { 'a.pdf': '문서' }), { io, journalPath })
      ).rejects.toThrow('스캔이 진행 중입니다')
      await expect(undoExecution('any', io, journalPath)).rejects.toThrow('스캔이 진행 중입니다')
      await expect(buildPlan(root, 1000)).rejects.toThrow('스캔이 진행 중입니다')
      expect(log).toEqual([])
      // 거부당한 쪽이 남의 자물쇠를 놓지 않는다
      expect(currentActivity()).toBe('scan')
    } finally {
      release()
    }
    expect(currentActivity()).toBeNull()
  })

  it('같은 작업을 두 번 잡으면 "이미 진행 중", 다른 작업이면 "끝난 뒤에"', () => {
    const release = beginActivity('execute')
    try {
      expect(() => beginActivity('execute')).toThrow('실행이 이미 진행 중입니다')
      expect(() => beginActivity('scan')).toThrow('실행이 진행 중입니다. 끝난 뒤에 스캔하세요')
      expect(() => beginActivity('undo')).toThrow('끝난 뒤에 되돌리세요')
    } finally {
      release()
    }
    expect(currentActivity()).toBeNull()
  })
})
