import { describe, expect, it } from 'vitest'
import { defaultRules } from '@shared/rules'
import {
  addExtension,
  canSaveRules,
  folderNameProblem,
  parsePositiveInteger,
  removeExtension,
  ruleProblems,
  setEnabled,
  setFolderName,
  toSaveable
} from '../src/renderer/src/lib/settingsEdit'

const rules = defaultRules()
const extsOf = (list: ReturnType<typeof defaultRules>, category: string): string[] =>
  list.find((r) => r.category === category)?.extensions ?? []

describe('setFolderName · setEnabled', () => {
  it('해당 카테고리만 바꾸고 입력은 그대로 둔다', () => {
    const next = setFolderName(rules, 'image', '사진')
    expect(next.find((r) => r.category === 'image')?.folderName).toBe('사진')
    expect(rules.find((r) => r.category === 'image')?.folderName).toBe('이미지')
    expect(next.filter((r) => r.category !== 'image')).toEqual(rules.filter((r) => r.category !== 'image'))

    const off = setEnabled(rules, 'code', false)
    expect(off.find((r) => r.category === 'code')?.enabled).toBe(false)
    expect(rules.find((r) => r.category === 'code')?.enabled).toBe(true)
  })
})

describe('addExtension', () => {
  it('정규화해서 뒤에 붙인다', () => {
    const { rules: next, error, movedFrom } = addExtension(rules, 'image', ' .WEBP2 ')
    expect(error).toBeNull()
    expect(movedFrom).toBeNull()
    expect(extsOf(next, 'image').at(-1)).toBe('webp2')
  })

  it('다른 카테고리에 있던 확장자는 거기서 빼고 옮겨 온다', () => {
    const { rules: next, error, movedFrom } = addExtension(rules, 'code', 'svg')
    expect(error).toBeNull()
    expect(movedFrom).toBe('image')
    expect(extsOf(next, 'image')).not.toContain('svg')
    expect(extsOf(next, 'code')).toContain('svg')
    // 입력은 그대로
    expect(extsOf(rules, 'image')).toContain('svg')
  })

  it('이미 같은 카테고리에 있으면 그대로', () => {
    const { rules: next, error, movedFrom } = addExtension(rules, 'image', 'PNG')
    expect(error).toBeNull()
    expect(movedFrom).toBeNull()
    expect(next).toEqual(rules)
  })

  it('못 쓰는 확장자면 이유를 돌려주고 아무것도 바꾸지 않는다', () => {
    const { rules: next, error } = addExtension(rules, 'image', 'tar.gz')
    expect(error).toContain('확장자로 쓸 수 없습니다')
    expect(next).toEqual(rules)
  })
})

describe('removeExtension', () => {
  it('해당 카테고리에서만 뺀다', () => {
    const next = removeExtension(rules, 'image', 'png')
    expect(extsOf(next, 'image')).not.toContain('png')
    expect(extsOf(rules, 'image')).toContain('png')
  })
})

describe('폴더 이름 검사', () => {
  it('비었으면 입력하라고, 못 쓰는 문자면 왜 안 되는지', () => {
    expect(folderNameProblem('  ')).toBe('폴더 이름을 입력하세요')
    expect(folderNameProblem('a/b')).toContain('폴더 이름으로 쓸 수 없습니다')
    expect(folderNameProblem('CON')).toContain('폴더 이름으로 쓸 수 없습니다')
    expect(folderNameProblem(' 사진 ')).toBeNull()
  })

  it('ruleProblems 는 문제 있는 카테고리만 담는다', () => {
    const broken = setFolderName(setFolderName(rules, 'image', ''), 'video', 'a:b')
    expect(Object.keys(ruleProblems(broken)).sort()).toEqual(['image', 'video'])
    expect(ruleProblems(rules)).toEqual({})
  })
})

describe('canSaveRules', () => {
  it('고친 게 없으면 저장할 수 없다', () => {
    expect(canSaveRules(rules, defaultRules())).toBe(false)
  })

  it('고쳤고 문제가 없으면 저장할 수 있다', () => {
    expect(canSaveRules(setFolderName(rules, 'image', '사진'), rules)).toBe(true)
  })

  it('고쳤어도 폴더 이름에 문제가 있으면 저장할 수 없다', () => {
    expect(canSaveRules(setFolderName(rules, 'image', ''), rules)).toBe(false)
  })
})

describe('toSaveable', () => {
  it('폴더 이름의 앞뒤 공백을 떼고 확장자 배열을 복사한다', () => {
    const saved = toSaveable(setFolderName(rules, 'image', '  사진 '))
    const image = saved.find((r) => r.category === 'image')
    expect(image?.folderName).toBe('사진')
    expect(image?.extensions).toEqual(extsOf(rules, 'image'))
    expect(image?.extensions).not.toBe(extsOf(rules, 'image'))
  })
})

describe('parsePositiveInteger', () => {
  it('양의 정수만 받는다', () => {
    expect(parsePositiveInteger('100')).toBe(100)
    expect(parsePositiveInteger(' 7 ')).toBe(7)
    expect(parsePositiveInteger('0')).toBeNull()
    expect(parsePositiveInteger('-1')).toBeNull()
    expect(parsePositiveInteger('1.5')).toBeNull()
    expect(parsePositiveInteger('1e3')).toBeNull()
    expect(parsePositiveInteger('')).toBeNull()
    expect(parsePositiveInteger('abc')).toBeNull()
  })
})
