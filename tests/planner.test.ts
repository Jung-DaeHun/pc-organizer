import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { OrganizeItem } from '@shared/types'
import { buildRulePlan } from '../src/main/services/planner'
import { skippedItem, type TopLevelListing } from '../src/main/services/topLevel'

const ROOT = join('C:', 'Users', 'me', 'Downloads')
const NOW = new Date('2026-09-11T00:00:00Z').getTime()
const OPTS = { id: 'plan-1', now: NOW }

let seq = 0

function file(name: string, overrides: Partial<OrganizeItem> = {}): OrganizeItem {
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : ''
  return {
    id: String(seq++),
    path: join(ROOT, name),
    name,
    kind: 'file',
    ext,
    size: 100,
    mtimeMs: NOW,
    category: 'other',
    ...overrides
  }
}

function dir(name: string, overrides: Partial<OrganizeItem> = {}): OrganizeItem {
  return {
    id: String(seq++),
    path: join(ROOT, name),
    name,
    kind: 'dir',
    ext: '',
    size: 0,
    mtimeMs: NOW,
    category: 'other',
    fileCount: 0,
    ...overrides
  }
}

function listing(items: OrganizeItem[], skipped: TopLevelListing['skipped'] = []): TopLevelListing {
  return { items, skipped }
}

describe('buildRulePlan', () => {
  it('카테고리가 있는 파일은 카테고리 이름의 하위 폴더로 보낸다', () => {
    const plan = buildRulePlan(
      ROOT,
      listing([
        file('setup.exe', { category: 'installer' }),
        file('photo.jpg', { category: 'image' })
      ]),
      OPTS
    )

    expect(plan.items.map((p) => p.toFolder)).toEqual(['설치파일', '이미지'])
    expect(plan.items.every((p) => p.origin === 'rule')).toBe(true)
    expect(plan.folders.map((f) => f.name)).toEqual(['이미지', '설치파일']) // 카테고리 순서
  })

  it("'기타'와 폴더는 그대로 두고 이유를 적는다", () => {
    const plan = buildRulePlan(
      ROOT,
      listing([file('mystery.xyz'), file('README'), dir('proj')]),
      OPTS
    )

    expect(plan.items.map((p) => p.toFolder)).toEqual([null, null, null])
    expect(plan.items[0]?.reason).toContain('.xyz')
    expect(plan.items[1]?.reason).toContain('확장자 없음')
    expect(plan.items[2]?.reason).toContain('폴더')
    expect(plan.folders).toEqual([])
  })

  it('목적지로 쓰이는 폴더는 항목에서 빼고 이미 있다고 표시한다', () => {
    const plan = buildRulePlan(
      ROOT,
      listing([dir('설치파일', { fileCount: 3 }), file('setup.exe', { category: 'installer' })]),
      OPTS
    )

    expect(plan.items.map((p) => p.item.name)).toEqual(['setup.exe'])
    expect(plan.skipped.map((s) => [s.name, s.reason])).toEqual([['설치파일', 'destination']])
    expect(plan.folders).toEqual([
      { name: '설치파일', description: '', existing: true, origin: 'rule' }
    ])
  })

  it('카테고리 이름과 같은 파일이 있으면 그 폴더는 만들지 않고 이유를 적는다', () => {
    // '설치파일' 이라는 파일(확장자 없음)이 루트에 있으면 mkdir('설치파일') 이 EEXIST 로 터진다
    const plan = buildRulePlan(
      ROOT,
      listing([file('설치파일'), file('setup.exe', { category: 'installer' }), file('a.jpg', { category: 'image' })]),
      OPTS
    )

    const setup = plan.items.find((p) => p.item.name === 'setup.exe')
    expect(setup?.toFolder).toBeNull()
    expect(setup?.reason).toContain('같은 이름의 폴더를 만들 수 없다')
    expect(plan.folders.map((f) => f.name)).toEqual(['이미지'])
  })

  it('목적지가 아닌 폴더는 항목으로 남는다', () => {
    const plan = buildRulePlan(
      ROOT,
      listing([dir('proj'), file('setup.exe', { category: 'installer' })]),
      OPTS
    )

    expect(plan.items.map((p) => p.item.name)).toEqual(['proj', 'setup.exe'])
    expect(plan.folders[0]?.existing).toBe(false)
  })

  it('앞 단계에서 뺀 항목은 그대로 이어받는다', () => {
    const skipped = [skippedItem(join(ROOT, 'x.lnk'), 'x.lnk', 'shortcut')]
    const plan = buildRulePlan(ROOT, listing([], skipped), OPTS)

    expect(plan.skipped).toEqual(skipped)
    expect(plan).toMatchObject({ id: 'plan-1', createdAt: NOW, root: ROOT })
  })
})
