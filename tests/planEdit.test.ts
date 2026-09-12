import { describe, expect, it } from 'vitest'
import {
  SKIP_REASON_LABELS,
  type OrganizeItem,
  type OrganizePlan,
  type PlanItem,
  type ProposedFolder,
  type SkipReason,
  type SkippedItem
} from '@shared/types'
import {
  addFolder,
  groupByFolder,
  isDestinationDir,
  keepAll,
  moveItems,
  removeFolder,
  renameFolder,
  summarize,
  toExecuteRequests
} from '@/lib/planEdit'

const NOW = new Date('2026-09-11T00:00:00Z').getTime()
let seq = 0

function item(name: string, size: number, kind: 'file' | 'dir' = 'file'): OrganizeItem {
  const dot = name.lastIndexOf('.')
  return {
    id: String(seq++),
    path: `C:\\root\\${name}`,
    name,
    kind,
    ext: kind === 'file' && dot > 0 ? name.slice(dot).toLowerCase() : '',
    size,
    mtimeMs: NOW,
    category: 'other',
    ...(kind === 'dir' ? { fileCount: 1 } : {})
  }
}

function pi(it: OrganizeItem, toFolder: string | null, origin: PlanItem['origin'] = 'rule'): PlanItem {
  return { item: it, toFolder, reason: 'r', origin }
}

function folder(name: string, partial: Partial<ProposedFolder> = {}): ProposedFolder {
  return { name, description: '', existing: false, origin: 'rule', ...partial }
}

function skipped(name: string, reason: SkipReason): SkippedItem {
  return { path: `C:\\root\\${name}`, name, reason, why: SKIP_REASON_LABELS[reason] }
}

function plan(
  items: PlanItem[],
  folders: ProposedFolder[],
  skippedItems: number | SkippedItem[] = 0
): OrganizePlan {
  return {
    id: 'p',
    createdAt: NOW,
    root: 'C:\\root',
    folders,
    items,
    skipped:
      typeof skippedItems === 'number'
        ? Array.from({ length: skippedItems }, (_, i) => skipped(`s${i}`, 'shortcut'))
        : skippedItems
  }
}

describe('groupByFolder', () => {
  it('폴더 순서는 plan.folders 그대로, 카드는 크기 큰 순', () => {
    const a = item('a.txt', 10)
    const b = item('b.txt', 30)
    const c = item('c.txt', 20)
    const d = item('d.txt', 5)
    const p = plan(
      [pi(a, '문서'), pi(b, '문서'), pi(c, '이미지'), pi(d, null)],
      [folder('이미지', { origin: 'ai' }), folder('문서')]
    )
    const g = groupByFolder(p)

    expect(g.columns.map((c) => c.folder.name)).toEqual(['이미지', '문서'])
    expect(g.columns[1]?.items.map((x) => x.item.name)).toEqual(['b.txt', 'a.txt'])
    expect(g.keep.map((x) => x.item.name)).toEqual(['d.txt'])
  })

  it('폴더 목록에 없는 이름을 가리키는 항목은 그대로 두기로 보여 카드를 잃지 않는다', () => {
    const a = item('a.txt', 1)
    const g = groupByFolder(plan([pi(a, '유령')], []))
    expect(g.keep).toHaveLength(1)
  })

  it('대소문자만 다른 폴더 이름도 같은 열로 묶는다', () => {
    const a = item('a.txt', 1)
    const g = groupByFolder(plan([pi(a, 'photos')], [folder('Photos')]))
    expect(g.columns[0]?.items).toHaveLength(1)
  })
})

describe('moveItems', () => {
  const a = item('a.txt', 1)
  const b = item('b.txt', 2)
  const base = plan([pi(a, '문서'), pi(b, null)], [folder('문서'), folder('이미지')])

  it('여러 항목을 한 번에 폴더로 옮기고 출처를 user 로 바꾼다', () => {
    const next = moveItems(base, [a.id, b.id], '이미지')
    expect(next.items.map((p) => [p.toFolder, p.origin])).toEqual([
      ['이미지', 'user'],
      ['이미지', 'user']
    ])
    expect(base.items[0]?.toFolder).toBe('문서') // 입력은 안 바뀐다
  })

  it('null 이면 그대로 두기, 이미 같은 곳이면 손대지 않는다', () => {
    const next = moveItems(base, [a.id, b.id], null)
    expect(next.items[0]).toMatchObject({ toFolder: null, origin: 'user' })
    expect(next.items[1]).toBe(base.items[1]) // b 는 이미 null
  })

  it('모르는 폴더면 아무것도 바꾸지 않는다', () => {
    expect(moveItems(base, [a.id], '없는폴더')).toBe(base)
  })

  it('대소문자만 다른 이름으로 옮겨도 목록의 표기로 적힌다', () => {
    const p = plan([pi(b, null)], [folder('Photos')])
    const next = moveItems(p, [b.id], 'photos')
    expect(next.items[0]?.toFolder).toBe('Photos')
  })

  it('실제로 바뀐 항목이 없으면 입력을 그대로 돌려준다', () => {
    expect(moveItems(base, [a.id], '문서')).toBe(base) // 이미 문서에 있다
    expect(moveItems(base, ['없는 id'], '이미지')).toBe(base)
  })

  describe('열과 같은 이름의 폴더 카드는 그 열 자체다 (main 의 destination 규칙)', () => {
    const proj = item('proj', 0, 'dir')
    const other = item('other', 0, 'dir')
    // 열 'proj' 가 있고 루트에도 폴더 proj 가 있다 (사용자가 addFolder 로 만든 상황)
    const withColumn = plan(
      [pi(a, null), pi(proj, null), pi(other, null)],
      [folder('proj', { existing: true }), folder('X')]
    )

    it('isDestinationDir 는 dir 이면서 열 이름과 같을 때만 참', () => {
      expect(isDestinationDir(proj, withColumn.folders)).toBe(true)
      expect(isDestinationDir(other, withColumn.folders)).toBe(false)
      expect(isDestinationDir(item('proj', 1), withColumn.folders)).toBe(false) // 같은 이름의 파일
      expect(isDestinationDir(proj, [folder('PROJ')])).toBe(true) // 대소문자 무시
    })

    it('자기 자신(같은 이름의 열)으로는 옮겨지지 않는다', () => {
      expect(moveItems(withColumn, [proj.id], 'proj')).toBe(withColumn)
    })

    it('다른 열로도 옮겨지지 않는다 — 목적지 폴더가 함께 이동하면 판과 실행 결과가 달라진다', () => {
      const next = moveItems(withColumn, [a.id, proj.id, other.id], 'X')
      expect(next.items.map((p) => [p.item.name, p.toFolder])).toEqual([
        ['a.txt', 'X'],
        ['proj', null],
        ['other', 'X']
      ])
      // 순서를 바꿔 a 를 proj 로 먼저 보낸 뒤에도 proj 카드는 못 움직인다
      const filled = moveItems(withColumn, [a.id], 'proj')
      expect(moveItems(filled, [proj.id], 'X')).toBe(filled)
    })

    it('그대로 두기로 되돌리는 것은 된다', () => {
      // 열 이름과 같은 dir 카드가 다른 열에 가 있는 상태는 만들 수 없어야 하지만, 혹시 있어도 빠져나올 수 있다
      const stuck = plan([pi(proj, 'X')], [folder('proj'), folder('X')])
      expect(moveItems(stuck, [proj.id], null).items[0]?.toFolder).toBeNull()
    })
  })
})

describe('addFolder', () => {
  const base = plan([pi(item('설치파일', 1), null), pi(item('proj', 0, 'dir'), null)], [folder('문서')])

  it('검증된 이름으로 맨 뒤에 user 폴더를 붙인다', () => {
    const r = addFolder(base, '  키보드 드라이버 ')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.plan.folders.map((f) => f.name)).toEqual(['문서', '키보드 드라이버'])
      expect(r.plan.folders[1]).toMatchObject({ origin: 'user', existing: false })
    }
  })

  it('쓸 수 없는 이름·중복·파일과 겹치는 이름은 거부한다', () => {
    // '문서' 는 이미 있는 폴더, '설치파일' 은 루트에 같은 이름의 파일이 있다
    for (const bad of ['CON', 'a/b', '..', '문서', '설치파일', '']) {
      const r = addFolder(base, bad)
      expect(r.ok, bad).toBe(false)
    }
  })

  it('루트에 같은 이름의 폴더가 있으면 기존 폴더로 표시한다', () => {
    const r = addFolder(base, 'proj')
    expect(r.ok && r.plan.folders[1]?.existing).toBe(true)
  })

  it('이미 다른 열로 보낸 폴더 카드의 이름으로는 열을 만들 수 없다', () => {
    const proj = item('proj', 0, 'dir')
    const p = plan([pi(proj, '문서')], [folder('문서')])
    const r = addFolder(p, 'proj')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('먼저 그대로 두기로')
    // 그대로 두기로 돌려놓으면 만들 수 있고, 그 열은 기존 폴더다
    const back = moveItems(p, [proj.id], null)
    const r2 = addFolder(back, 'proj')
    expect(r2.ok && r2.plan.folders[1]?.existing).toBe(true)
  })

  it('skipped 에 간 이름도 본다 — 폴더면 기존 폴더, 파일·링크·바로가기면 거부', () => {
    const p = plan([], [], [
      skipped('사진', 'has-cloud-only'),
      skipped('node_modules', 'excluded-dir'),
      skipped('문서', 'destination'),
      skipped('메모.lnk', 'shortcut'),
      skipped('desktop.ini', 'system'),
      skipped('연결', 'link'),
      skipped('받는중.pdf', 'cloud-only')
    ])
    for (const dir of ['사진', 'node_modules', '문서']) {
      const r = addFolder(p, dir)
      expect(r.ok && r.plan.folders[0]?.existing, dir).toBe(true)
    }
    for (const bad of ['메모.lnk', 'desktop.ini', '연결', '받는중.pdf']) {
      const r = addFolder(p, bad)
      expect(r.ok, bad).toBe(false)
      if (!r.ok) expect(r.error, bad).toContain(bad)
    }
  })
})

describe('renameFolder', () => {
  const a = item('a.txt', 1)
  const base = plan(
    [pi(a, '임시')],
    [folder('임시'), folder('사진', { existing: true }), folder('문서')]
  )

  it('이름을 바꾸면 그 폴더를 가리키던 항목도 따라간다', () => {
    const r = renameFolder(base, '임시', '드라이버')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.plan.folders[0]?.name).toBe('드라이버')
      expect(r.plan.items[0]?.toFolder).toBe('드라이버')
    }
  })

  it('기존 폴더·없는 폴더·중복 이름은 거부한다', () => {
    expect(renameFolder(base, '사진', '새이름').ok).toBe(false)
    expect(renameFolder(base, '없음', '새이름').ok).toBe(false)
    expect(renameFolder(base, '임시', '문서').ok).toBe(false)
    expect(renameFolder(base, '임시', 'NUL').ok).toBe(false)
  })

  it('같은 이름(대소문자만 다름)으로 바꾸는 건 허용한다', () => {
    const p = plan([], [folder('photos')])
    const r = renameFolder(p, 'photos', 'Photos')
    expect(r.ok && r.plan.folders[0]?.name).toBe('Photos')
  })

  it('루트에 있는 폴더의 이름으로 바꾸면 기존 폴더가 되고 새 폴더 수에서 빠진다', () => {
    const proj = item('proj', 0, 'dir')
    const p = plan([pi(a, '임시'), pi(proj, null)], [folder('임시')])
    expect(summarize(p).newFolders).toBe(1)

    const r = renameFolder(p, '임시', 'proj')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.plan.folders[0]).toMatchObject({ name: 'proj', existing: true })
      expect(r.plan.items[0]?.toFolder).toBe('proj')
      expect(summarize(r.plan).newFolders).toBe(0)
      // addFolder 와 같은 답이어야 한다
      const added = addFolder(plan([pi(proj, null)], []), 'proj')
      expect(added.ok && added.plan.folders[0]?.existing).toBe(true)
    }
  })

  it('이미 다른 열로 보낸 폴더 카드의 이름으로는 바꿀 수 없다', () => {
    const proj = item('proj', 0, 'dir')
    const p = plan([pi(proj, '문서')], [folder('문서'), folder('임시')])
    expect(renameFolder(p, '임시', 'proj').ok).toBe(false)
  })
})

describe('removeFolder / keepAll', () => {
  const a = item('a.txt', 1)
  const base = plan([pi(a, '임시')], [folder('임시'), folder('빈폴더')])

  it('카드가 남아 있는 폴더는 못 지우고, 빈 폴더는 지운다', () => {
    expect(removeFolder(base, '임시').ok).toBe(false)
    const r = removeFolder(base, '빈폴더')
    expect(r.ok && r.plan.folders.map((f) => f.name)).toEqual(['임시'])
  })

  it('keepAll 로 비운 뒤에는 지울 수 있다', () => {
    const emptied = keepAll(base, '임시')
    expect(emptied.items[0]?.toFolder).toBeNull()
    expect(removeFolder(emptied, '임시').ok).toBe(true)
  })
})

describe('summarize', () => {
  it('옮길 개수·용량, 그대로, 제외, 실제로 쓰이는 새 폴더 수', () => {
    const a = item('a.txt', 100)
    const b = item('b.txt', 50)
    const c = item('c.txt', 1)
    const p = plan(
      [pi(a, '문서'), pi(b, '문서'), pi(c, null)],
      [folder('문서'), folder('안쓰는새폴더'), folder('기존', { existing: true })],
      2
    )
    expect(summarize(p)).toEqual({
      moving: 2,
      movingBytes: 150,
      staying: 1,
      skipped: 2,
      newFolders: 1
    })
  })
})

describe('toExecuteRequests', () => {
  it('폴더가 정해진 항목만 {id, toFolder} 로 보낸다. 경로는 없다', () => {
    const a = item('a.txt', 1)
    const b = item('b.txt', 1)
    const c = item('c.txt', 1)
    const p = plan([pi(a, '문서'), pi(b, null), pi(c, '기존')], [folder('문서'), folder('기존', { existing: true })])
    const requests = toExecuteRequests(p)
    expect(requests).toEqual([
      { id: a.id, toFolder: '문서' },
      { id: c.id, toFolder: '기존' }
    ])
    for (const r of requests) expect(Object.keys(r).sort()).toEqual(['id', 'toFolder'])
  })

  it('폴더 목록에 없는 이름을 가리키는 항목은 그대로 두기로 본다 (groupByFolder 와 같은 규칙)', () => {
    const a = item('a.txt', 1)
    const p = plan([pi(a, '사라진폴더')], [folder('문서')])
    expect(toExecuteRequests(p)).toEqual([])
  })
})
