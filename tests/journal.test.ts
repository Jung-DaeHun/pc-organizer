import { lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { OrganizePlan, TrashEntry, UndoEntry } from '@shared/types'
import {
  executeMoves,
  preflight,
  resolveMoves,
  undoMoves,
  type ExecutorIo
} from '../src/main/services/executor'
import { findEntry, JOURNAL_LIMIT, readJournal, saveEntry } from '../src/main/services/journal'

let base = ''
beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'pc-organizer-journal-'))
})
afterAll(async () => {
  // 테스트가 만든 임시 디렉터리만 지운다 (사용자 파일이 아니다)
  await rm(base, { recursive: true, force: true })
})

function entry(id: string, executedAt: number, extra: Partial<UndoEntry> = {}): UndoEntry {
  return { id, executedAt, root: 'C:\\r', results: [], createdFolders: [], ...extra }
}

describe('journal — 실행 기록 저장', () => {
  it('없는 파일은 빈 목록, 저장하면 최근 것이 앞', async () => {
    const path = join(base, 'a', 'journal.json')
    expect(await readJournal(path)).toEqual([])

    await saveEntry(path, entry('old', 1000))
    await saveEntry(path, entry('new', 2000))
    expect((await readJournal(path)).map((e) => e.id)).toEqual(['new', 'old'])
  })

  it('같은 id 는 갈아 끼운다 (실행 도중 항목마다 저장)', async () => {
    const path = join(base, 'b', 'journal.json')
    await saveEntry(path, entry('e', 1000))
    await saveEntry(path, entry('e', 1000, { createdFolders: ['문서'] }))
    const all = await readJournal(path)
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ createdFolders: ['문서'] })
    expect(await findEntry(path, 'e')).toMatchObject({ createdFolders: ['문서'] })
    expect(await findEntry(path, 'nope')).toBeNull()
  })

  it('최근 JOURNAL_LIMIT 개만 남긴다', async () => {
    const path = join(base, 'c', 'journal.json')
    for (let i = 0; i < JOURNAL_LIMIT + 5; i += 1) await saveEntry(path, entry(`e${i}`, i))
    const all = await readJournal(path)
    expect(all).toHaveLength(JOURNAL_LIMIT)
    expect(all[0]?.id).toBe(`e${JOURNAL_LIMIT + 4}`)
  })

  it('꽉 찬 저널에 기존 항목보다 과거 시각으로 저장해도 방금 저장한 항목은 남는다 (시계가 뒤로 간 뒤)', async () => {
    const path = join(base, 'c2', 'journal.json')
    const future = 10_000
    for (let i = 0; i < JOURNAL_LIMIT; i += 1) await saveEntry(path, entry(`f${i}`, future + i))

    // 시각으로 정렬한 뒤 잘랐다면 이 항목이 맨 끝이라 잘려 나가 "기록 없는 실행"이 된다
    await saveEntry(path, entry('now', 5))
    const all = await readJournal(path)
    expect(all).toHaveLength(JOURNAL_LIMIT)
    expect(await findEntry(path, 'now')).toMatchObject({ id: 'now' })
    // 밀려난 건 나머지 중 가장 오래된 것
    expect(await findEntry(path, 'f0')).toBeNull()

    // 실행 도중 같은 id 로 다시 저장해도 그대로 남는다
    await saveEntry(path, entry('now', 5, { createdFolders: ['문서'] }))
    expect(await findEntry(path, 'now')).toMatchObject({ createdFolders: ['문서'] })
    expect(await readJournal(path)).toHaveLength(JOURNAL_LIMIT)
  })

  it('깨진 파일이나 모양이 틀린 항목은 버리고 계속 간다', async () => {
    const path = join(base, 'd', 'journal.json')
    await mkdir(join(base, 'd'), { recursive: true })
    await writeFile(path, '{ not json', 'utf8')
    expect(await readJournal(path)).toEqual([])

    await writeFile(path, JSON.stringify([entry('ok', 1), { id: 'bad' }, 42]), 'utf8')
    expect((await readJournal(path)).map((e) => e.id)).toEqual(['ok'])
  })

  it('results 원소나 폴더 목록의 모양이 틀린 항목도 버린다 (실행취소가 그 경로를 그대로 rename 한다)', async () => {
    const path = join(base, 'd2', 'journal.json')
    await mkdir(join(base, 'd2'), { recursive: true })
    const result: UndoEntry['results'][number] = {
      id: '0',
      name: 'a.pdf',
      kind: 'file',
      from: join('C:\\r', 'a.pdf'),
      to: join('C:\\r', '문서', 'a.pdf'),
      ok: true
    }
    await writeFile(
      path,
      JSON.stringify([
        entry('good', 1, { results: [result], undoResults: [result], removedFolders: ['문서'], keptFolders: [] }),
        entry('null-result', 2, { results: [null as unknown as UndoEntry['results'][number]] }),
        entry('path-not-string', 3, { results: [{ ...result, to: 42 } as unknown as UndoEntry['results'][number]] }),
        entry('bad-kind', 4, { results: [{ ...result, kind: 'link' } as unknown as UndoEntry['results'][number]] }),
        entry('bad-folders', 5, { createdFolders: [1] as unknown as string[] }),
        entry('bad-undone', 6, { undoneAt: 'yesterday' as unknown as number })
      ]),
      'utf8'
    )
    expect((await readJournal(path)).map((e) => e.id)).toEqual(['good'])
  })

  it('kind 가 없는 옛 기록은 이동으로 읽고, 휴지통 기록은 kind: trash 로 섞여 시간순으로 온다', async () => {
    const path = join(base, 'f', 'journal.json')
    await mkdir(join(base, 'f'), { recursive: true })
    const trash: TrashEntry = {
      kind: 'trash',
      id: 't',
      executedAt: 2,
      results: [{ id: '0.1', name: 'x.pdf', path: 'C:\\r\\b\\x.pdf', size: 10, ok: true }],
      keptPaths: ['C:\\r\\a\\x.pdf']
    }
    // 옛 파일 그대로: kind 없는 이동 기록 하나 + 휴지통 기록 하나
    await writeFile(path, JSON.stringify([entry('old-move', 1), trash]), 'utf8')

    const all = await readJournal(path)
    expect(all.map((e) => [e.id, e.kind])).toEqual([
      ['t', 'trash'],
      ['old-move', undefined]
    ])
    expect(all[0]).toEqual(trash)

    // 갈아 끼우기와 찾기도 두 종류를 가리지 않는다
    await saveEntry(path, { ...trash, results: [] })
    expect(await findEntry(path, 't')).toMatchObject({ kind: 'trash', results: [] })
    expect(await findEntry(path, 'old-move')).toMatchObject({ id: 'old-move' })
  })

  it('모양이 틀린 휴지통 기록은 버린다', async () => {
    const path = join(base, 'f2', 'journal.json')
    await mkdir(join(base, 'f2'), { recursive: true })
    await writeFile(
      path,
      JSON.stringify([
        { kind: 'trash', id: 'no-kept', executedAt: 1, results: [] },
        { kind: 'trash', id: 'bad-result', executedAt: 2, results: [{ id: 'x' }], keptPaths: [] },
        { kind: 'trash', id: 'ok', executedAt: 3, results: [], keptPaths: [] },
        // 이동 기록에 kind: 'trash' 를 붙여도 휴지통 모양이 아니면 버린다
        { ...entry('move-as-trash', 4), kind: 'trash' }
      ]),
      'utf8'
    )
    expect((await readJournal(path)).map((e) => e.id)).toEqual(['ok'])
  })

  it('임시 파일을 남기지 않는다 (임시 파일에 쓰고 rename)', async () => {
    const path = join(base, 'e', 'journal.json')
    await saveEntry(path, entry('e', 1))
    expect(await readdir(join(base, 'e'))).toEqual(['journal.json'])
    expect(JSON.parse(await readFile(path, 'utf8'))).toHaveLength(1)
  })
})

// ---------------------------------------------------------------- 실제 파일시스템 통합

/** handlers.ts 가 만드는 것과 같은 모양의 실제 io */
const realIo: ExecutorIo = {
  lstat,
  mkdir: (p) => mkdir(p),
  rename,
  rmdir: (p) => rmdir(p),
  // 이동·실행취소는 휴지통을 부르면 안 된다
  trashItem: async () => {
    throw new Error('이동 실행이 trashItem 을 불렀습니다')
  }
}

describe('실행기 + 실제 파일시스템 (임시 디렉터리)', () => {
  it('파일 둘과 폴더 하나를 옮기고 실행취소로 원상복구한다', async () => {
    const root = join(base, 'root')
    await mkdir(join(root, 'proj', 'src'), { recursive: true })
    await writeFile(join(root, 'a.pdf'), 'a')
    await writeFile(join(root, 'b.zip'), 'b')
    await writeFile(join(root, 'proj', 'src', 'x.ts'), 'x')
    await writeFile(join(root, 'stay.txt'), 's')

    const item = (
      id: string,
      name: string,
      kind: 'file' | 'dir'
    ): OrganizePlan['items'][number] => ({
      item: { id, path: join(root, name), name, kind, ext: '', size: 1, mtimeMs: 0, category: 'other' },
      toFolder: null,
      reason: '',
      origin: 'rule'
    })
    const plan: OrganizePlan = {
      id: 'p',
      createdAt: 0,
      root,
      folders: [],
      items: [item('0', 'a.pdf', 'file'), item('1', 'b.zip', 'file'), item('2', 'proj', 'dir'), item('3', 'stay.txt', 'file')],
      skipped: []
    }
    const moves = resolveMoves(plan, [
      { id: '0', toFolder: '문서' },
      { id: '1', toFolder: '문서' },
      { id: '2', toFolder: '프로젝트' }
    ])

    expect(await preflight(moves, realIo)).toEqual([])
    const report = await executeMoves(moves, realIo)
    expect(report.results.every((r) => r.ok)).toBe(true)
    expect(report.createdFolders).toEqual(['문서', '프로젝트'])

    expect((await readdir(root)).sort()).toEqual(['stay.txt', '문서', '프로젝트'].sort())
    expect((await readdir(join(root, '문서'))).sort()).toEqual(['a.pdf', 'b.zip'])
    expect(await readFile(join(root, '프로젝트', 'proj', 'src', 'x.ts'), 'utf8')).toBe('x')

    // 같은 계획을 다시 실행하면 사전 점검이 전부 막는다 (원본이 없다)
    expect((await preflight(moves, realIo)).map((p) => p.code)).toEqual(['missing', 'missing', 'missing'])

    // 사용자가 '프로젝트' 안에 무언가를 넣었다 — 그 폴더는 남아야 한다
    await writeFile(join(root, '프로젝트', 'memo.txt'), 'm')

    const undo = await undoMoves(
      { id: 'e', executedAt: 0, root, results: report.results, createdFolders: report.createdFolders },
      realIo
    )
    expect(undo.results.every((r) => r.ok)).toBe(true)
    expect(undo.results.map((r) => r.name)).toEqual(['proj', 'b.zip', 'a.pdf'])
    expect(undo.removedFolders).toEqual(['문서'])
    expect(undo.keptFolders).toEqual(['프로젝트'])
    expect((await readdir(root)).sort()).toEqual(['a.pdf', 'b.zip', 'proj', 'stay.txt', '프로젝트'].sort())
    expect(await readFile(join(root, 'a.pdf'), 'utf8')).toBe('a')
    expect(await readdir(join(root, '프로젝트'))).toEqual(['memo.txt'])
  })
})
