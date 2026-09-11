import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AdvisorRequest, OrganizeItem, OrganizePlan, PlanItem } from '@shared/types'
import {
  ADVICE_SCHEMA,
  advisePlan,
  buildAdvisorRequest,
  CHUNK_SIZE,
  chunkItems,
  estimateRequest,
  MAX_NEW_FOLDERS,
  mergeAdviceIntoPlan,
  previewAdvice,
  sanitizeFolderName,
  validateAdvice,
  type Advice
} from '../src/main/services/advisor'
import type { StructuredCall } from '../src/main/lib/structured'

// 사용자 이름이 경로에 들어 있는 상황을 그대로 흉내 낸다. 이 문자열이 페이로드에 나오면 안 된다
const USER = '정대훈'
const ROOT = join('C:', 'Users', USER, 'Downloads')
const NOW = new Date('2026-09-11T10:30:00Z').getTime()

let seq = 0

function file(name: string, overrides: Partial<OrganizeItem> = {}): OrganizeItem {
  const dot = name.lastIndexOf('.')
  return {
    id: String(seq++),
    path: join(ROOT, name),
    name,
    kind: 'file',
    ext: dot > 0 ? name.slice(dot).toLowerCase() : '',
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

function rulePlan(items: OrganizeItem[], planItems?: PlanItem[]): OrganizePlan {
  return {
    id: 'plan',
    createdAt: NOW,
    root: ROOT,
    folders: [],
    items: planItems ?? items.map((item) => ({
      item,
      toDir: null,
      reason: '규칙 없음',
      origin: 'rule',
      approved: false
    })),
    skipped: []
  }
}

function advice(partial: Partial<Advice>): Advice {
  return { folders: [], assignments: [], leave: [], ...partial }
}

// ---------------------------------------------------------------- 전송 범위

describe('buildAdvisorRequest — 네트워크로 나가는 것', () => {
  it('허용된 필드만 보낸다. 다른 키가 하나라도 있으면 실패한다', () => {
    const items = [
      file('AULA F108Pro Driver.exe', { category: 'installer', size: 12345 }),
      dir('아양로 호두과자', { fileCount: 4, size: 999 })
    ]
    const request = buildAdvisorRequest(ROOT, items, ['설치파일'])

    expect(Object.keys(request).sort()).toEqual(['existingFolders', 'items', 'rootName'])
    expect(Object.keys(request.items[0] as object).sort()).toEqual(
      ['category', 'ext', 'id', 'kind', 'mtime', 'name', 'size']
    )
    expect(Object.keys(request.items[1] as object).sort()).toEqual(
      ['category', 'ext', 'fileCount', 'id', 'kind', 'mtime', 'name', 'size']
    )
  })

  it('절대 경로와 사용자 이름은 어디에도 없다', () => {
    const request = buildAdvisorRequest(ROOT, [file('a.pdf'), dir('proj')], [])
    const wire = JSON.stringify(request)

    expect(wire).not.toContain(USER)
    expect(wire).not.toContain('Users')
    expect(wire).not.toContain('C:')
    expect(wire).not.toMatch(/[\\/]/) // 경로 구분자 자체가 없어야 한다
    expect(request.rootName).toBe('Downloads')
  })

  it('수정 시각은 날짜까지만 보낸다', () => {
    const request = buildAdvisorRequest(ROOT, [file('a.pdf')], [])
    expect(request.items[0]?.mtime).toBe('2026-09-11')
  })

  it('시각을 모르는 항목은 빈 문자열', () => {
    const request = buildAdvisorRequest(ROOT, [file('a.pdf', { mtimeMs: 0 })], [])
    expect(request.items[0]?.mtime).toBe('')
  })
})

describe('ADVICE_SCHEMA — AI 가 할 수 있는 일의 전부', () => {
  it('folders / assignments / leave 뿐이다', () => {
    expect(Object.keys(ADVICE_SCHEMA.shape).sort()).toEqual(['assignments', 'folders', 'leave'])
  })

  it("'trash' 같은 모르는 키가 오면 거부한다", () => {
    const withTrash = { ...advice({}), trash: [{ id: '0', reason: '중복' }] }
    expect(ADVICE_SCHEMA.safeParse(withTrash).success).toBe(false)

    const inner = advice({ assignments: [{ id: '0', folder: 'x', reason: 'r', delete: true } as never] })
    expect(ADVICE_SCHEMA.safeParse(inner).success).toBe(false)
  })
})

// ---------------------------------------------------------------- 응답 검증

describe('sanitizeFolderName', () => {
  it('윈도우에서 쓸 수 없는 이름을 거른다', () => {
    expect(sanitizeFolderName('키보드 드라이버')).toBe('키보드 드라이버')
    expect(sanitizeFolderName('  양끝 공백  ')).toBe('양끝 공백')

    for (const bad of [
      '', '   ', '.', '..', '../etc', 'a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b',
      'CON', 'con.txt', 'LPT1', 'com9.old', '.hidden', 'trailing.', 'ab',
      'x'.repeat(61)
    ]) {
      expect(sanitizeFolderName(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})

describe('validateAdvice', () => {
  const items = [file('setup.exe', { category: 'installer' }), file('poster.jpg'), dir('proj')]
  const request: AdvisorRequest = buildAdvisorRequest(ROOT, items, ['기존폴더'])
  const [setup, poster, proj] = items as [OrganizeItem, OrganizeItem, OrganizeItem]

  it('정상 응답을 그대로 받아들인다', () => {
    const v = validateAdvice(
      advice({
        folders: [{ name: '드라이버', description: '기기 드라이버' }],
        assignments: [{ id: setup.id, folder: '드라이버', reason: '키보드 드라이버' }],
        leave: [{ id: poster.id, reason: '용도 불명' }]
      }),
      request
    )

    expect(v.folders).toEqual([{ name: '드라이버', description: '기기 드라이버', existing: false }])
    expect(v.assignments.get(setup.id)).toEqual({ folder: '드라이버', reason: '키보드 드라이버' })
    expect(v.leave.get(poster.id)).toBe('용도 불명')
    expect(v.dropped).toEqual([])
  })

  it('모르는 id 는 버린다', () => {
    const v = validateAdvice(
      advice({
        folders: [{ name: 'x', description: '' }],
        assignments: [{ id: '999', folder: 'x', reason: '' }],
        leave: [{ id: 'nope', reason: '' }]
      }),
      request
    )
    expect(v.assignments.size).toBe(0)
    expect(v.leave.size).toBe(0)
    expect(v.dropped).toHaveLength(2)
  })

  it('쓸 수 없는 폴더 이름과 그 폴더로의 배정을 버린다', () => {
    const v = validateAdvice(
      advice({
        folders: [{ name: '../위로', description: '' }],
        assignments: [{ id: setup.id, folder: '../위로', reason: '' }]
      }),
      request
    )
    expect(v.folders).toEqual([])
    expect(v.assignments.size).toBe(0)
    expect(v.dropped.length).toBeGreaterThanOrEqual(2)
  })

  it('folders 에 없는 폴더로의 배정은 버린다', () => {
    const v = validateAdvice(
      advice({ assignments: [{ id: setup.id, folder: '갑자기', reason: '' }] }),
      request
    )
    expect(v.assignments.size).toBe(0)
  })

  it('기존 폴더는 folders 에 안 적혀 있어도 원래 표기로 받아들인다', () => {
    const v = validateAdvice(
      advice({ assignments: [{ id: setup.id, folder: '기존폴더', reason: '' }] }),
      request
    )
    expect(v.assignments.get(setup.id)?.folder).toBe('기존폴더')
    expect(v.folders).toEqual([{ name: '기존폴더', description: '', existing: true }])
  })

  it('최상위 파일과 같은 이름의 폴더는 만들 수 없으니 버린다', () => {
    // 폴더 'setup.exe' 를 만들어 setup.exe 를 넣으라는 건 mkdir 부터 EEXIST 로 터진다
    const v = validateAdvice(
      advice({
        folders: [{ name: 'setup.exe', description: '' }, { name: 'POSTER.JPG', description: '' }],
        assignments: [
          { id: setup.id, folder: 'setup.exe', reason: '' },
          { id: proj.id, folder: 'POSTER.JPG', reason: '' }
        ]
      }),
      request
    )
    expect(v.folders).toEqual([])
    expect(v.assignments.size).toBe(0)
    expect(v.dropped.filter((d) => d.includes('같은 이름의 파일'))).toHaveLength(
      process.platform === 'win32' ? 2 : 1
    )
  })

  it('새 폴더는 상한까지만 받고 넘는 폴더와 그 배정은 버린다', () => {
    const many = Array.from({ length: MAX_NEW_FOLDERS + 3 }, (_, i) => `폴더${i}`)
    const v = validateAdvice(
      advice({
        folders: many.map((name) => ({ name, description: '' })),
        assignments: [{ id: setup.id, folder: many[many.length - 1]!, reason: '' }]
      }),
      request
    )
    expect(v.folders).toHaveLength(MAX_NEW_FOLDERS)
    expect(v.assignments.size).toBe(0)
    expect(v.dropped.some((d) => d.includes('상한'))).toBe(true)
  })

  it('폴더 항목을 자기 이름과 같은 폴더로 보내는 건 버린다', () => {
    const v = validateAdvice(
      advice({
        folders: [{ name: 'proj', description: '' }],
        assignments: [{ id: proj.id, folder: 'proj', reason: '' }]
      }),
      request
    )
    expect(v.assignments.size).toBe(0)
    expect(v.dropped[0]).toContain('자기 자신')
  })

  it('같은 id 가 두 번 나오면 처음 것만 남긴다', () => {
    const v = validateAdvice(
      advice({
        folders: [{ name: 'a', description: '' }, { name: 'b', description: '' }],
        assignments: [
          { id: setup.id, folder: 'a', reason: '첫째' },
          { id: setup.id, folder: 'b', reason: '둘째' }
        ],
        leave: [{ id: setup.id, reason: '셋째' }]
      }),
      request
    )
    expect(v.assignments.get(setup.id)?.folder).toBe('a')
    expect(v.leave.has(setup.id)).toBe(false)
  })

  it('대소문자만 다른 폴더 이름은 하나로 합친다 (윈도우)', () => {
    if (process.platform !== 'win32') return
    const v = validateAdvice(
      advice({
        folders: [{ name: 'Photos', description: '' }, { name: 'photos', description: '' }],
        assignments: [{ id: poster.id, folder: 'PHOTOS', reason: '' }]
      }),
      request
    )
    expect(v.folders).toHaveLength(1)
    expect(v.assignments.get(poster.id)?.folder).toBe('Photos')
  })
})

// ---------------------------------------------------------------- 계획에 얹기

describe('mergeAdviceIntoPlan', () => {
  it('AI 가 언급한 항목은 AI 결과로, 나머지는 규칙 결과 그대로', () => {
    const items = [file('a.exe', { category: 'installer' }), file('b.jpg'), file('c.txt')]
    const [a, b, c] = items as [OrganizeItem, OrganizeItem, OrganizeItem]
    const plan = rulePlan(items, [
      { item: a, toDir: join(ROOT, '설치파일'), reason: '.exe → 설치파일', origin: 'rule', approved: true },
      { item: b, toDir: null, reason: '규칙 없음', origin: 'rule', approved: false },
      { item: c, toDir: null, reason: '규칙 없음', origin: 'rule', approved: false }
    ])
    plan.folders = [
      { name: '설치파일', dir: join(ROOT, '설치파일'), description: '확장자 규칙', existing: false }
    ]

    const request = buildAdvisorRequest(ROOT, items, [])
    const v = validateAdvice(
      advice({
        folders: [{ name: '포스터', description: '' }],
        assignments: [{ id: b.id, folder: '포스터', reason: '홍보물' }],
        leave: [{ id: c.id, reason: '메모로 보임' }]
      }),
      request
    )
    const merged = mergeAdviceIntoPlan(plan, v)

    expect(merged.items.map((p) => [p.item.name, p.toDir, p.origin, p.approved])).toEqual([
      ['a.exe', join(ROOT, '설치파일'), 'rule', true],
      ['b.jpg', join(ROOT, '포스터'), 'ai', true],
      ['c.txt', null, 'ai', false]
    ])
    expect(merged.items[2]?.reason).toBe('메모로 보임')
    expect(merged.folders.map((f) => f.name)).toEqual(['포스터', '설치파일'])
  })

  it('목적지로 쓰이는 폴더 항목은 옮기지 않고 제외 목록으로 보낸다', () => {
    const items = [dir('아양로 호두과자'), file('poster.jpg')]
    const [store, poster] = items as [OrganizeItem, OrganizeItem]
    const plan = rulePlan(items)

    const request = buildAdvisorRequest(ROOT, items, ['아양로 호두과자'])
    const v = validateAdvice(
      advice({ assignments: [{ id: poster.id, folder: '아양로 호두과자', reason: '가게 홍보물' }] }),
      request
    )
    const merged = mergeAdviceIntoPlan(plan, v)

    expect(merged.items.map((p) => p.item.name)).toEqual(['poster.jpg'])
    expect(merged.skipped).toEqual([
      { path: store.path, name: store.name, reason: 'destination', why: '정리 폴더(목적지)라 옮기지 않는다' }
    ])
    expect(merged.folders).toEqual([
      { name: '아양로 호두과자', dir: join(ROOT, '아양로 호두과자'), description: '', existing: true }
    ])
  })

  it('제안 폴더에는 main 이 만든 절대 경로가 실린다 — renderer 는 경로를 조립하지 않는다', () => {
    const items = [file('a.jpg')]
    const plan = rulePlan(items)
    const request = buildAdvisorRequest(ROOT, items, [])
    const v = validateAdvice(
      advice({
        folders: [{ name: '사진', description: '' }],
        assignments: [{ id: items[0]!.id, folder: '사진', reason: '' }]
      }),
      request
    )
    const merged = mergeAdviceIntoPlan(plan, v)
    expect(merged.folders[0]?.dir).toBe(join(ROOT, '사진'))
    expect(merged.items[0]?.toDir).toBe(join(ROOT, '사진'))
  })

  it('AI 가 폴더를 다른 폴더로 옮기라고 하면서 동시에 목적지로도 쓰면 옮기지 않는 쪽을 택한다', () => {
    const items = [dir('사진'), file('x.jpg')]
    const [photos, x] = items as [OrganizeItem, OrganizeItem]
    const plan = rulePlan(items)
    const request = buildAdvisorRequest(ROOT, items, ['사진'])
    const v = validateAdvice(
      advice({
        folders: [{ name: '미디어', description: '' }],
        assignments: [
          { id: photos.id, folder: '미디어', reason: '' },
          { id: x.id, folder: '사진', reason: '' }
        ]
      }),
      request
    )
    const merged = mergeAdviceIntoPlan(plan, v)

    expect(merged.items.map((p) => p.item.name)).toEqual(['x.jpg'])
    expect(merged.skipped.map((s) => s.name)).toEqual(['사진'])
  })
})

// ---------------------------------------------------------------- 청크 · 전체 흐름

describe('chunkItems / estimateRequest', () => {
  it('CHUNK_SIZE 단위로 자른다', () => {
    const items = Array.from({ length: CHUNK_SIZE * 2 + 1 }, (_, i) => i)
    const chunks = chunkItems(items)
    expect(chunks.map((c) => c.length)).toEqual([CHUNK_SIZE, CHUNK_SIZE, 1])
    expect(chunkItems([])).toEqual([])
  })

  it('요약에는 이름 샘플 10개와 청크 수가 들어간다', () => {
    const items = Array.from({ length: CHUNK_SIZE + 5 }, (_, i) => file(`f${i}.txt`))
    const preview = estimateRequest(buildAdvisorRequest(ROOT, items, []))

    expect(preview.itemCount).toBe(CHUNK_SIZE + 5)
    expect(preview.chunkCount).toBe(2)
    expect(preview.sampleNames).toHaveLength(10)
    expect(preview.approxInputTokens).toBeGreaterThan(0)
  })

  it('previewAdvice 는 실제 요청과 같은 조립을 거친다', () => {
    const plan = rulePlan([file('a.pdf'), dir('proj')])
    const preview = previewAdvice(plan)
    expect(preview.itemCount).toBe(2)
    expect(preview.sampleNames).toEqual(['a.pdf', 'proj'])
  })
})

describe('advisePlan', () => {
  it('청크마다 호출하고 앞 청크의 폴더를 다음 청크에 기존 폴더로 넘긴다', async () => {
    const items = Array.from({ length: CHUNK_SIZE + 2 }, (_, i) => file(`f${i}.txt`))
    const plan = rulePlan(items)
    const seen: AdvisorRequest[] = []

    const call: StructuredCall = vi.fn(async (req) => {
      const request = JSON.parse(req.user) as AdvisorRequest
      seen.push(request)
      const first = request.items[0] as AdvisorRequest['items'][number]
      return advice({
        folders: [{ name: seen.length === 1 ? '첫청크폴더' : '둘째폴더', description: '' }],
        assignments: [{ id: first.id, folder: seen.length === 1 ? '첫청크폴더' : '둘째폴더', reason: '' }]
      }) as never
    })

    const merged = await advisePlan(plan, call)

    expect(call).toHaveBeenCalledTimes(2)
    expect(seen[0]?.existingFolders).toEqual([])
    expect(seen[1]?.existingFolders).toEqual(['첫청크폴더'])
    expect(seen[0]?.items).toHaveLength(CHUNK_SIZE)
    expect(seen[1]?.items).toHaveLength(2)

    expect(merged.folders.map((f) => f.name)).toEqual(['첫청크폴더', '둘째폴더'])
    expect(merged.items.filter((p) => p.origin === 'ai')).toHaveLength(2)
  })

  it('호출마다 SYSTEM_PROMPT 와 스키마를 함께 넘긴다', async () => {
    const plan = rulePlan([file('a.txt')])
    const call: StructuredCall = vi.fn(async () => advice({}) as never)

    await advisePlan(plan, call)

    const [req] = (call as ReturnType<typeof vi.fn>).mock.calls[0] as [Parameters<StructuredCall>[0]]
    expect(req.system.length).toBeGreaterThan(50)
    expect(req.schema).toBe(ADVICE_SCHEMA)
    expect(req.maxTokens).toBeGreaterThan(0)
  })

  it('호출이 실패하면 그대로 던지고 계획은 바뀌지 않는다', async () => {
    const plan = rulePlan([file('a.txt')])
    const call: StructuredCall = async () => {
      throw new Error('API 키가 올바르지 않습니다')
    }
    await expect(advisePlan(plan, call)).rejects.toThrow('API 키')
    expect(plan.items[0]?.origin).toBe('rule')
  })
})
