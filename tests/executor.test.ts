import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  ExecuteProgress,
  ExecutionResult,
  OrganizeItem,
  OrganizePlan,
  PlanItem,
  SkippedItem,
  UndoEntry
} from '@shared/types'
import {
  executeMoves,
  preflight,
  resolveMoves,
  undoMoves,
  type EntryStat,
  type ExecutorIo,
  type Move
} from '../src/main/services/executor'

const ROOT = join('C:', 'Users', 'me', 'Downloads')
const NOW = new Date('2026-09-12T00:00:00Z').getTime()

// ---------------------------------------------------------------- 계획 픽스처

function item(id: string, name: string, kind: OrganizeItem['kind'] = 'file'): OrganizeItem {
  return {
    id,
    path: join(ROOT, name),
    name,
    kind,
    ext: kind === 'file' ? `.${name.split('.').pop()}` : '',
    size: 100,
    mtimeMs: NOW,
    category: 'other'
  }
}

function planItem(it: OrganizeItem, toFolder: string | null = null): PlanItem {
  return { item: it, toFolder, reason: '', origin: 'rule' }
}

function skipped(name: string, reason: SkippedItem['reason']): SkippedItem {
  return { path: join(ROOT, name), name, reason, why: '' }
}

function plan(items: PlanItem[], skippedItems: SkippedItem[] = []): OrganizePlan {
  return { id: 'p', createdAt: NOW, root: ROOT, folders: [], items, skipped: skippedItems }
}

const A = item('0', 'a.pdf')
const B = item('1', 'b.zip')
const PROJ = item('2', 'proj', 'dir')
const BASE = plan([planItem(A), planItem(B), planItem(PROJ)])

// ---------------------------------------------------------------- 가짜 파일시스템

type Kind = 'file' | 'dir' | 'link'

function stat(kind: Kind): EntryStat {
  return {
    isDirectory: () => kind === 'dir',
    isFile: () => kind === 'file',
    isSymbolicLink: () => kind === 'link'
  }
}

function fsError(code: string): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error(code)
  err.code = code
  return err
}

/**
 * 경로 → 종류 맵으로 흉내 낸 파일시스템. 윈도우처럼 대소문자를 구분하지 않는다.
 * 어떤 호출이 어떤 순서로 일어났는지 log 에 남긴다.
 */
class FakeFs implements ExecutorIo {
  readonly entries = new Map<string, Kind>()
  readonly log: string[] = []
  /** 이 경로로의 rename 은 이 코드로 실패한다 */
  failRename = new Map<string, string>()
  failMkdir: string | null = null

  constructor(initial: Record<string, Kind>) {
    for (const [path, kind] of Object.entries(initial)) this.entries.set(path.toLowerCase(), kind)
  }

  has(path: string): boolean {
    return this.entries.has(path.toLowerCase())
  }

  async lstat(path: string): Promise<EntryStat> {
    const kind = this.entries.get(path.toLowerCase())
    if (!kind) throw fsError('ENOENT')
    return stat(kind)
  }

  async mkdir(path: string): Promise<void> {
    this.log.push(`mkdir ${path}`)
    if (this.failMkdir) throw fsError(this.failMkdir)
    if (this.has(path)) throw fsError('EEXIST')
    this.entries.set(path.toLowerCase(), 'dir')
  }

  async rename(from: string, to: string): Promise<void> {
    this.log.push(`rename ${from} -> ${to}`)
    const code = this.failRename.get(to.toLowerCase())
    if (code) throw fsError(code)
    const kind = this.entries.get(from.toLowerCase())
    if (!kind) throw fsError('ENOENT')
    this.entries.delete(from.toLowerCase())
    this.entries.set(to.toLowerCase(), kind)
  }

  /** 진짜 rmdir 처럼 비어 있지 않으면 ENOTEMPTY, 폴더가 아니면 ENOTDIR */
  async rmdir(path: string): Promise<void> {
    this.log.push(`rmdir ${path}`)
    const key = path.toLowerCase()
    const kind = this.entries.get(key)
    if (!kind) throw fsError('ENOENT')
    if (kind !== 'dir') throw fsError('ENOTDIR')
    const prefix = `${key}${sep}`
    for (const other of this.entries.keys()) {
      if (other.startsWith(prefix)) throw fsError('ENOTEMPTY')
    }
    this.entries.delete(key)
  }
}

function rootFs(extra: Record<string, Kind> = {}): FakeFs {
  return new FakeFs({
    [ROOT]: 'dir',
    [A.path]: 'file',
    [B.path]: 'file',
    [PROJ.path]: 'dir',
    ...extra
  })
}

// ---------------------------------------------------------------- resolveMoves

describe('resolveMoves — 요청을 계획과 대조', () => {
  it('id 로 계획의 항목을 찾고 목적지는 join(root, 폴더, 원래 이름) 으로 만든다', () => {
    const moves = resolveMoves(BASE, [
      { id: '0', toFolder: '문서' },
      { id: '2', toFolder: '프로젝트' }
    ])
    expect(moves).toEqual<Move[]>([
      {
        id: '0',
        name: 'a.pdf',
        kind: 'file',
        from: A.path,
        toFolder: '문서',
        to: join(ROOT, '문서', 'a.pdf')
      },
      {
        id: '2',
        name: 'proj',
        kind: 'dir',
        from: PROJ.path,
        toFolder: '프로젝트',
        to: join(ROOT, '프로젝트', 'proj')
      }
    ])
  })

  it('폴더 이름을 다시 다듬는다 (앞뒤 공백)', () => {
    const [move] = resolveMoves(BASE, [{ id: '0', toFolder: '  문서 ' }])
    expect(move?.toFolder).toBe('문서')
    expect(move?.to).toBe(join(ROOT, '문서', 'a.pdf'))
  })

  it('빈 요청·모양이 틀린 요청은 거부한다', () => {
    expect(() => resolveMoves(BASE, [])).toThrow('옮길 항목이 없습니다')
    expect(() =>
      resolveMoves(BASE, [{ id: 0, toFolder: '문서' } as unknown as { id: string; toFolder: string }])
    ).toThrow('형식')
    expect(() => resolveMoves(BASE, 'nope' as unknown as [])).toThrow('형식')
  })

  it('계획에 없는 id, 같은 id 두 번은 전체를 거부한다', () => {
    expect(() => resolveMoves(BASE, [{ id: '9', toFolder: '문서' }])).toThrow('계획에 없는')
    expect(() =>
      resolveMoves(BASE, [
        { id: '0', toFolder: '문서' },
        { id: '0', toFolder: '기타' }
      ])
    ).toThrow('두 번')
  })

  it('폴더 이름으로 쓸 수 없는 목적지는 거부한다 (경로 구분자·예약어)', () => {
    expect(() => resolveMoves(BASE, [{ id: '0', toFolder: '..' }])).toThrow('폴더 이름')
    expect(() => resolveMoves(BASE, [{ id: '0', toFolder: 'a/b' }])).toThrow('폴더 이름')
    expect(() => resolveMoves(BASE, [{ id: '0', toFolder: 'CON' }])).toThrow('폴더 이름')
  })

  it('경로가 루트 바로 아래가 아닌 항목은 거부한다', () => {
    const deep = { ...A, path: join(ROOT, 'sub', 'a.pdf') }
    expect(() => resolveMoves(plan([planItem(deep)]), [{ id: '0', toFolder: '문서' }])).toThrow(
      '바로 아래'
    )
  })

  it('옮기는 폴더의 이름을 목적지로 쓸 수 없다 (자기 안으로 들어가는 조합)', () => {
    expect(() =>
      resolveMoves(BASE, [
        { id: '2', toFolder: '보관' },
        { id: '0', toFolder: 'proj' }
      ])
    ).toThrow('이번에 옮기는 항목')
    // 자기 자신으로
    expect(() => resolveMoves(BASE, [{ id: '2', toFolder: 'PROJ' }])).toThrow('이번에 옮기는 항목')
  })

  it('옮기지 않는 폴더의 이름은 기존 폴더로 목적지가 될 수 있다', () => {
    const [move] = resolveMoves(BASE, [{ id: '0', toFolder: 'proj' }])
    expect(move?.to).toBe(join(ROOT, 'proj', 'a.pdf'))
  })

  it('루트에 있는 파일 이름은 skipped 에 간 것이라도 목적지로 쓸 수 없다 (mkdir 이 실패한다)', () => {
    expect(() => resolveMoves(BASE, [{ id: '0', toFolder: 'b.zip' }])).toThrow('파일이 이미 있어')
    const withSkippedFile = plan([planItem(A)], [skipped('메모', 'not-in-scan')])
    expect(() => resolveMoves(withSkippedFile, [{ id: '0', toFolder: '메모' }])).toThrow(
      '파일이 이미 있어'
    )
  })

  it('skipped 에 간 폴더(목적지·클라우드 포함·제외 폴더)의 이름은 기존 폴더라 괜찮다', () => {
    const p = plan(
      [planItem(A)],
      [skipped('문서', 'destination'), skipped('사진', 'has-cloud-only'), skipped('node_modules', 'excluded-dir')]
    )
    expect(resolveMoves(p, [{ id: '0', toFolder: '문서' }])).toHaveLength(1)
    expect(resolveMoves(p, [{ id: '0', toFolder: '사진' }])).toHaveLength(1)
  })
})

// ---------------------------------------------------------------- preflight

const moveA = (): Move => resolveMoves(BASE, [{ id: '0', toFolder: '문서' }])[0] as Move
const allMoves = (): Move[] =>
  resolveMoves(BASE, [
    { id: '0', toFolder: '문서' },
    { id: '1', toFolder: '압축' },
    { id: '2', toFolder: '프로젝트' }
  ])

describe('preflight — 읽기 전용 사전 점검', () => {
  it('문제가 없으면 빈 목록이고 아무것도 건드리지 않는다', async () => {
    const fs = rootFs()
    expect(await preflight(allMoves(), fs)).toEqual([])
    expect(fs.log).toEqual([])
  })

  it('원본이 없으면 missing', async () => {
    const fs = rootFs()
    fs.entries.delete(A.path.toLowerCase())
    expect(await preflight([moveA()], fs)).toMatchObject([{ id: '0', ok: false, code: 'missing' }])
  })

  it('원본이 링크가 되어 있으면 link, 종류가 바뀌었으면 kind-changed', async () => {
    const link = rootFs({ [A.path]: 'link' })
    expect(await preflight([moveA()], link)).toMatchObject([{ code: 'link' }])

    const dir = rootFs({ [A.path]: 'dir' })
    expect(await preflight([moveA()], dir)).toMatchObject([{ code: 'kind-changed' }])
  })

  it('목적지 폴더 자리에 파일이나 링크가 있으면 dest-not-dir', async () => {
    const file = rootFs({ [join(ROOT, '문서')]: 'file' })
    expect(await preflight([moveA()], file)).toMatchObject([{ code: 'dest-not-dir' }])

    // 정션인 목적지로 옮기면 파일이 다른 곳으로 흘러간다
    const link = rootFs({ [join(ROOT, '문서')]: 'link' })
    expect(await preflight([moveA()], link)).toMatchObject([{ code: 'dest-not-dir' }])
  })

  it('목적지에 같은 이름이 있으면 exists (대소문자만 달라도)', async () => {
    const fs = rootFs({ [join(ROOT, '문서')]: 'dir', [join(ROOT, '문서', 'A.PDF')]: 'file' })
    expect(await preflight([moveA()], fs)).toMatchObject([{ code: 'exists' }])
  })

  it('걸린 항목만 돌려주고 나머지는 없다', async () => {
    const fs = rootFs()
    fs.entries.delete(B.path.toLowerCase())
    const problems = await preflight(allMoves(), fs)
    expect(problems.map((p) => p.id)).toEqual(['1'])
  })

  it('lstat 이 ENOENT 외의 오류를 내면 io 로 잡는다', async () => {
    const fs = rootFs()
    fs.lstat = async () => {
      throw fsError('EPERM')
    }
    expect(await preflight([moveA()], fs)).toMatchObject([{ code: 'io' }])
  })
})

// ---------------------------------------------------------------- executeMoves

describe('executeMoves — 실행', () => {
  it('폴더를 만들고 옮긴다. 만든 폴더 이름을 돌려준다', async () => {
    const fs = rootFs()
    const report = await executeMoves(allMoves(), fs)

    expect(report.results.every((r) => r.ok)).toBe(true)
    expect(report.createdFolders).toEqual(['문서', '압축', '프로젝트'])
    expect(fs.has(join(ROOT, '문서', 'a.pdf'))).toBe(true)
    expect(fs.has(join(ROOT, '프로젝트', 'proj'))).toBe(true)
    expect(fs.has(A.path)).toBe(false)
    expect(fs.log).toEqual([
      `mkdir ${join(ROOT, '문서')}`,
      `rename ${A.path} -> ${join(ROOT, '문서', 'a.pdf')}`,
      `mkdir ${join(ROOT, '압축')}`,
      `rename ${B.path} -> ${join(ROOT, '압축', 'b.zip')}`,
      `mkdir ${join(ROOT, '프로젝트')}`,
      `rename ${PROJ.path} -> ${join(ROOT, '프로젝트', 'proj')}`
    ])
  })

  it('이미 있는 폴더는 만들지 않고 createdFolders 에도 넣지 않는다', async () => {
    const fs = rootFs({ [join(ROOT, '문서')]: 'dir' })
    const report = await executeMoves([moveA()], fs)
    expect(report.createdFolders).toEqual([])
    expect(fs.log).toEqual([`rename ${A.path} -> ${join(ROOT, '문서', 'a.pdf')}`])
  })

  it('같은 폴더로 두 개를 옮기면 폴더는 한 번만 만든다', async () => {
    const fs = rootFs()
    const moves = resolveMoves(BASE, [
      { id: '0', toFolder: '문서' },
      { id: '1', toFolder: '문서' }
    ])
    const report = await executeMoves(moves, fs)
    expect(report.createdFolders).toEqual(['문서'])
    expect(fs.log.filter((l) => l.startsWith('mkdir'))).toHaveLength(1)
  })

  it('하나가 실패해도 나머지는 옮기고 결과를 전부 돌려준다', async () => {
    const fs = rootFs()
    fs.entries.delete(B.path.toLowerCase())
    const report = await executeMoves(allMoves(), fs)

    expect(report.results.map((r) => [r.id, r.ok])).toEqual([
      ['0', true],
      ['1', false],
      ['2', true]
    ])
    expect(report.results[1]).toMatchObject({ code: 'missing', from: B.path })
  })

  it('다른 드라이브(EXDEV)면 실패하고 복사하지 않는다', async () => {
    const fs = rootFs()
    fs.failRename.set(join(ROOT, '문서', 'a.pdf').toLowerCase(), 'EXDEV')
    const report = await executeMoves([moveA()], fs)
    expect(report.results[0]).toMatchObject({ ok: false, code: 'exdev' })
    expect(fs.has(A.path)).toBe(true)
  })

  it('실행 직전에 다시 점검한다 — 사전 점검 뒤에 목적지가 생겼으면 덮어쓰지 않는다', async () => {
    const fs = rootFs()
    const move = moveA()
    expect(await preflight([move], fs)).toEqual([])
    // 점검과 실행 사이에 누군가 같은 이름을 만들었다
    fs.entries.set(join(ROOT, '문서').toLowerCase(), 'dir')
    fs.entries.set(move.to.toLowerCase(), 'file')

    const report = await executeMoves([move], fs)
    expect(report.results[0]).toMatchObject({ ok: false, code: 'exists' })
    expect(fs.log.filter((l) => l.startsWith('rename'))).toEqual([])
  })

  it('진행률을 항목마다, 끝에 한 번 더 알린다', async () => {
    const fs = rootFs()
    const seen: ExecuteProgress[] = []
    await executeMoves(allMoves(), fs, { onProgress: (p) => seen.push(p) })
    expect(seen).toEqual([
      { done: 0, total: 3, current: 'a.pdf' },
      { done: 1, total: 3, current: 'b.zip' },
      { done: 2, total: 3, current: 'proj' },
      { done: 3, total: 3, current: '' }
    ])
  })

  it('onResult 가 실패하면(기록 불가) 남은 항목은 시도하지 않고 실패로 채운다', async () => {
    const fs = rootFs()
    let calls = 0
    const report = await executeMoves(allMoves(), fs, {
      onResult: async () => {
        calls += 1
        if (calls === 1) throw new Error('disk full')
      }
    })
    expect(report.results.map((r) => r.ok)).toEqual([true, false, false])
    expect(report.results[1]?.error).toContain('실행 기록을 저장할 수 없어')
    // 두 번째부터는 rename 이 불리지 않았다
    expect(fs.log.filter((l) => l.startsWith('rename'))).toHaveLength(1)
    expect(fs.has(B.path)).toBe(true)
  })

  it('mkdir 이 EEXIST 외의 오류를 내면 그 항목은 io 실패', async () => {
    const fs = rootFs()
    fs.failMkdir = 'EACCES'
    const report = await executeMoves([moveA()], fs)
    expect(report.results[0]).toMatchObject({ ok: false, code: 'io' })
    expect(fs.has(A.path)).toBe(true)
  })
})

// ---------------------------------------------------------------- undoMoves

function entryOf(results: ExecutionResult[]): UndoEntry {
  return { id: 'e', executedAt: NOW, root: ROOT, results, createdFolders: [] }
}

describe('undoMoves — 실행취소', () => {
  it('ok 였던 이동을 역순으로 되돌리고, 실패했던 것은 건드리지 않는다', async () => {
    const fs = rootFs()
    fs.entries.delete(B.path.toLowerCase())
    const done = await executeMoves(allMoves(), fs)

    const { results } = await undoMoves(entryOf(done.results), fs)
    expect(results.map((r) => [r.name, r.ok])).toEqual([
      ['proj', true],
      ['a.pdf', true]
    ])
    expect(fs.has(A.path)).toBe(true)
    expect(fs.has(PROJ.path)).toBe(true)
    expect(fs.has(join(ROOT, '문서', 'a.pdf'))).toBe(false)
    const renames = fs.log.filter((l) => l.startsWith('rename')).slice(-2)
    expect(renames[0]).toContain(`${join(ROOT, '프로젝트', 'proj')} -> ${PROJ.path}`)
  })

  it('옮긴 자리에 없으면 missing, 원래 자리에 다른 것이 있으면 exists', async () => {
    const fs = rootFs()
    const done = await executeMoves(allMoves(), fs)

    fs.entries.delete(join(ROOT, '문서', 'a.pdf').toLowerCase())
    fs.entries.set(B.path.toLowerCase(), 'file')

    const { results } = await undoMoves(entryOf(done.results), fs)
    expect(results.find((r) => r.name === 'a.pdf')).toMatchObject({ ok: false, code: 'missing' })
    expect(results.find((r) => r.name === 'b.zip')).toMatchObject({ ok: false, code: 'exists' })
    expect(results.find((r) => r.name === 'proj')).toMatchObject({ ok: true })
  })

  it('되돌릴 대상이 링크가 됐거나 종류가 바뀌었으면 옮기지 않는다', async () => {
    const fs = rootFs()
    const done = await executeMoves([moveA()], fs)
    fs.entries.set(join(ROOT, '문서', 'a.pdf').toLowerCase(), 'link')
    expect((await undoMoves(entryOf(done.results), fs)).results).toMatchObject([
      { ok: false, code: 'link' }
    ])

    fs.entries.set(join(ROOT, '문서', 'a.pdf').toLowerCase(), 'dir')
    expect((await undoMoves(entryOf(done.results), fs)).results).toMatchObject([
      { ok: false, code: 'kind-changed' }
    ])
  })

  it('결과의 from/to 는 실제로 시도한 방향(to → from)이다', async () => {
    const fs = rootFs()
    const done = await executeMoves([moveA()], fs)
    const [back] = (await undoMoves(entryOf(done.results), fs)).results
    expect(back).toMatchObject({ from: join(ROOT, '문서', 'a.pdf'), to: A.path, ok: true })
  })

  it('기록의 경로가 실행이 만든 모양(root\\name → root\\폴더\\name)이 아니면 rename 하지 않는다', async () => {
    const fs = rootFs()
    const [done] = (await executeMoves([moveA()], fs)).results as [ExecutionResult]
    const elsewhere = join('C:', 'Users', 'me', 'Documents')
    const tampered: ExecutionResult[] = [
      // 원래 자리가 감시 폴더 밖 — 되돌리면 파일이 밖으로 나간다
      { ...done, from: join(elsewhere, 'a.pdf') },
      // 옮긴 자리가 감시 폴더 밖 — 남의 파일을 끌어온다
      { ...done, to: join(elsewhere, 'a.pdf') },
      // 두 단계 아래, 폴더 이름이 규칙 위반('..'), 이름에 구분자
      { ...done, to: join(ROOT, '문서', '깊이', 'a.pdf') },
      { ...done, to: join(ROOT, '..', 'a.pdf') },
      { ...done, name: join('x', 'a.pdf') },
      // 이름은 같은데 root 가 다른 기록
      { ...done, from: join(elsewhere, 'a.pdf'), to: join(elsewhere, '문서', 'a.pdf') }
    ]
    for (const t of tampered) fs.entries.set(t.to.toLowerCase(), 'file')

    const before = fs.log.length
    const { results } = await undoMoves(entryOf(tampered), fs)
    expect(results).toHaveLength(tampered.length)
    expect(results.every((r) => !r.ok && r.code === 'io')).toBe(true)
    expect(fs.log.slice(before).filter((l) => l.startsWith('rename'))).toEqual([])

    // 손대지 않은 기록은 그대로 되돌린다
    expect((await undoMoves(entryOf([done]), fs)).results).toMatchObject([{ ok: true }])
  })
})

describe('undoMoves — 만든 폴더 치우기', () => {
  const entryWith = (results: ExecutionResult[], createdFolders: string[]): UndoEntry => ({
    ...entryOf(results),
    createdFolders
  })

  it('실행이 만든 폴더가 비어 있으면 지운다 (비재귀 rmdir)', async () => {
    const fs = rootFs()
    const done = await executeMoves(allMoves(), fs)
    expect(done.createdFolders).toEqual(['문서', '압축', '프로젝트'])

    const report = await undoMoves(entryWith(done.results, done.createdFolders), fs)
    expect(report.removedFolders).toEqual(['문서', '압축', '프로젝트'])
    expect(report.keptFolders).toEqual([])
    expect(fs.has(join(ROOT, '문서'))).toBe(false)
    expect(fs.has(join(ROOT, '프로젝트'))).toBe(false)
    // 원래 항목은 전부 제자리
    expect(fs.has(A.path) && fs.has(B.path) && fs.has(PROJ.path)).toBe(true)
    // 폴더는 이동을 전부 되돌린 뒤에 지운다
    const log = fs.log.slice(fs.log.findIndex((l) => l.startsWith('rmdir')))
    expect(log.every((l) => l.startsWith('rmdir'))).toBe(true)
  })

  it('비어 있지 않은 폴더는 남긴다 — 사용자가 무언가 넣었을 때', async () => {
    const fs = rootFs()
    const done = await executeMoves(allMoves(), fs)
    // 사용자가 '문서' 안에 새 파일을 만들었다
    fs.entries.set(join(ROOT, '문서', 'memo.txt').toLowerCase(), 'file')

    const report = await undoMoves(entryWith(done.results, done.createdFolders), fs)
    expect(report.results.every((r) => r.ok)).toBe(true)
    expect(report.removedFolders).toEqual(['압축', '프로젝트'])
    expect(report.keptFolders).toEqual(['문서'])
    expect(fs.has(join(ROOT, '문서', 'memo.txt'))).toBe(true)
  })

  it('되돌리기에 실패한 항목이 남아 있는 폴더는 지우지 않는다', async () => {
    const fs = rootFs()
    const done = await executeMoves(allMoves(), fs)
    // a.pdf 의 원래 자리에 다른 파일이 생겨 되돌릴 수 없다
    fs.entries.set(A.path.toLowerCase(), 'file')

    const report = await undoMoves(entryWith(done.results, done.createdFolders), fs)
    expect(report.results.find((r) => r.name === 'a.pdf')).toMatchObject({ ok: false, code: 'exists' })
    expect(report.keptFolders).toEqual(['문서'])
    expect(fs.has(join(ROOT, '문서', 'a.pdf'))).toBe(true)
  })

  it('기존 폴더를 목적지로 썼으면 기록에 없어 손대지 않는다', async () => {
    const fs = rootFs({ [join(ROOT, '문서')]: 'dir' })
    const done = await executeMoves([moveA()], fs)
    expect(done.createdFolders).toEqual([])

    const report = await undoMoves(entryWith(done.results, done.createdFolders), fs)
    expect(report.removedFolders).toEqual([])
    expect(fs.has(join(ROOT, '문서'))).toBe(true)
    expect(fs.log.some((l) => l.startsWith('rmdir'))).toBe(false)
  })

  it('폴더가 링크가 됐거나 폴더가 아니게 됐으면 남기고, 이미 없으면 넘어간다', async () => {
    const fs = rootFs()
    const done = await executeMoves(allMoves(), fs)
    // 이동은 이미 되돌렸다고 치고 폴더 상태만 다르게 만든다
    for (const r of done.results) {
      fs.entries.delete(r.to.toLowerCase())
      fs.entries.set(r.from.toLowerCase(), r.kind)
    }
    fs.entries.set(join(ROOT, '문서').toLowerCase(), 'link')
    fs.entries.delete(join(ROOT, '압축').toLowerCase())

    const report = await undoMoves(entryWith([], done.createdFolders), fs)
    expect(report.keptFolders).toEqual(['문서'])
    expect(report.removedFolders).toEqual(['프로젝트'])
    expect(fs.has(join(ROOT, '문서'))).toBe(true)
  })

  it('기록 파일의 폴더 이름이 규칙을 어기면(구분자·..) 손대지 않는다', async () => {
    const fs = rootFs()
    const report = await undoMoves(entryWith([], ['..', 'a/b', '  ']), fs)
    expect(report.keptFolders).toEqual(['..', 'a/b', '  '])
    expect(fs.log.some((l) => l.startsWith('rmdir'))).toBe(false)
  })
})
