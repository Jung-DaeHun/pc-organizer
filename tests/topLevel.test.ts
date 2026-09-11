import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FileEntry } from '@shared/types'
import { listTopLevel, type TopLevelDirent } from '../src/main/services/topLevel'

const ROOT = join('C:', 'Users', 'me', 'Downloads')
const NOW = new Date('2026-09-11T00:00:00Z').getTime()

function entry(rel: string, overrides: Partial<FileEntry> = {}): FileEntry {
  const path = join(ROOT, rel)
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

function dirent(name: string, kind: TopLevelDirent['kind'] = 'file'): TopLevelDirent {
  return { name, kind, mtimeMs: NOW }
}

const reader = (dirents: TopLevelDirent[]) => async (): Promise<TopLevelDirent[]> => dirents

describe('listTopLevel', () => {
  it('루트 바로 아래 파일만 항목으로 잡고 스캔 결과에서 크기를 가져온다', async () => {
    const entries = [entry('a.pdf', { size: 10 }), entry(join('sub', 'deep.txt'), { size: 999 })]
    const listing = await listTopLevel(ROOT, entries, reader([dirent('a.pdf'), dirent('sub', 'dir')]))

    const names = listing.items.map((i) => i.name)
    expect(names).toEqual(['sub', 'a.pdf']) // 폴더 먼저
    expect(listing.items.find((i) => i.name === 'a.pdf')).toMatchObject({
      kind: 'file',
      ext: '.pdf',
      size: 10,
      category: 'document'
    })
  })

  it('폴더는 통째로 하나의 항목이고 용량·파일 수는 아래 파일을 합친다', async () => {
    const entries = [
      entry(join('proj', 'a.ts'), { size: 1 }),
      entry(join('proj', 'src', 'b.ts'), { size: 2 }),
      entry(join('proj', 'src', 'lib', 'c.ts'), { size: 4 })
    ]
    const listing = await listTopLevel(ROOT, entries, reader([dirent('proj', 'dir')]))

    expect(listing.items).toHaveLength(1)
    expect(listing.items[0]).toMatchObject({
      kind: 'dir',
      size: 7,
      fileCount: 3,
      ext: '',
      category: 'other'
    })
  })

  it('다른 감시 폴더의 파일은 섞이지 않는다', async () => {
    const other = join('C:', 'Users', 'me', 'Desktop', 'x.txt')
    const entries = [entry('a.txt'), { ...entry('a.txt'), path: other, name: 'x.txt' }]
    const listing = await listTopLevel(ROOT, entries, reader([dirent('a.txt')]))

    expect(listing.items.map((i) => i.name)).toEqual(['a.txt'])
  })

  it('윈도우에서는 대소문자만 다른 경로도 같은 파일로 본다', async () => {
    const entries = [entry('Report.PDF')]
    const listing = await listTopLevel(ROOT, entries, reader([dirent('report.pdf')]))

    if (process.platform === 'win32') {
      expect(listing.items).toHaveLength(1)
    } else {
      expect(listing.skipped[0]?.why).toContain('스캔 결과에 없음')
    }
  })

  it('링크·시스템 파일·바로가기·클라우드 전용은 이유와 함께 뺀다', async () => {
    const entries = [
      entry('cloud.mp4', { isCloudOnly: true, size: 5_000_000 }),
      entry('desktop.ini'),
      entry('game.lnk'),
      entry('site.url'),
      entry('ok.jpg')
    ]
    const listing = await listTopLevel(
      ROOT,
      entries,
      reader([
        dirent('junction', 'link'),
        dirent('cloud.mp4'),
        dirent('desktop.ini'),
        dirent('game.lnk'),
        dirent('site.url'),
        dirent('ok.jpg'),
        dirent('weird', 'other')
      ])
    )

    expect(listing.items.map((i) => i.name)).toEqual(['ok.jpg'])

    const reason = Object.fromEntries(listing.skipped.map((s) => [s.name, s.reason]))
    expect(reason).toEqual({
      junction: 'link',
      'cloud.mp4': 'cloud-only',
      'desktop.ini': 'system',
      'game.lnk': 'shortcut',
      'site.url': 'shortcut',
      weird: 'not-file-or-dir'
    })
    // 화면 문구도 같이 실려 간다
    expect(listing.skipped.every((s) => s.why.length > 0)).toBe(true)
  })

  it('클라우드 전용 파일이 하나라도 든 폴더는 통째로 뺀다', async () => {
    const entries = [
      entry(join('proj', 'a.txt')),
      entry(join('proj', 'sub', 'big.mp4'), { isCloudOnly: true, size: 5_000_000 }),
      entry(join('local', 'b.txt'))
    ]
    const listing = await listTopLevel(
      ROOT,
      entries,
      reader([dirent('proj', 'dir'), dirent('local', 'dir')])
    )

    expect(listing.items.map((i) => i.name)).toEqual(['local'])
    expect(listing.skipped).toEqual([
      expect.objectContaining({ name: 'proj', reason: 'has-cloud-only' })
    ])
  })

  it('스캐너가 제외한 폴더는 용량을 모르니 계획에서도 뺀다', async () => {
    const listing = await listTopLevel(
      ROOT,
      [entry(join('src', 'a.ts'))],
      reader([dirent('node_modules', 'dir'), dirent('.git', 'dir'), dirent('src', 'dir')]),
      { excludedDirNames: ['node_modules', '.GIT'] }
    )

    expect(listing.items.map((i) => i.name)).toEqual(['src'])
    expect(listing.skipped.map((s) => [s.name, s.reason])).toEqual([
      ['.git', 'excluded-dir'],
      ['node_modules', 'excluded-dir']
    ])
  })

  it('스캔 결과에 없는 파일은 옮기지 않고 다시 스캔하라고 알린다', async () => {
    const listing = await listTopLevel(ROOT, [], reader([dirent('new.txt')]))

    expect(listing.items).toHaveLength(0)
    expect(listing.skipped[0]).toMatchObject({ name: 'new.txt' })
    expect(listing.skipped[0]?.why).toContain('다시 스캔')
  })

  it('id 는 항목 순번이며 서로 겹치지 않는다', async () => {
    const entries = [entry('a.txt'), entry('b.txt'), entry('c.txt')]
    const listing = await listTopLevel(
      ROOT,
      entries,
      reader([dirent('c.txt'), dirent('a.txt'), dirent('b.txt')])
    )

    expect(listing.items.map((i) => i.id)).toEqual(['0', '1', '2'])
    expect(listing.items.map((i) => i.name)).toEqual(['a.txt', 'b.txt', 'c.txt'])
  })
})
