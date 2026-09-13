import { describe, expect, it } from 'vitest'
import { CATEGORY_LABELS, RULE_CATEGORIES, type CategoryRule } from '@shared/types'
import { sanitizeFolderName } from '@shared/folderName'
import {
  DEFAULT_EXTENSIONS_BY_CATEGORY,
  defaultRule,
  defaultRules,
  normalizeExtension,
  normalizeRules,
  rulesEqual
} from '@shared/rules'

describe('기본 규칙', () => {
  it('카테고리마다 하나, RULE_CATEGORIES 순서, 기본 폴더 이름은 카테고리 라벨', () => {
    const rules = defaultRules()
    expect(rules.map((r) => r.category)).toEqual([...RULE_CATEGORIES])
    expect(rules.every((r) => r.enabled)).toBe(true)
    for (const rule of rules) expect(rule.folderName).toBe(CATEGORY_LABELS[rule.category])
  })

  it("'기타'는 규칙이 없다", () => {
    expect(RULE_CATEGORIES).not.toContain('other')
  })

  it('기본 확장자는 전부 정규형이고 카테고리 사이에 겹치지 않는다', () => {
    const seen = new Set<string>()
    for (const exts of Object.values(DEFAULT_EXTENSIONS_BY_CATEGORY)) {
      for (const ext of exts) {
        expect(normalizeExtension(ext)).toBe(ext)
        expect(seen.has(ext)).toBe(false)
        seen.add(ext)
      }
    }
  })

  it('기본 폴더 이름은 전부 폴더 이름 검사를 통과한다', () => {
    for (const rule of defaultRules()) expect(sanitizeFolderName(rule.folderName)).toBe(rule.folderName)
  })

  it('돌려준 배열을 고쳐도 기본값은 그대로다', () => {
    const rule = defaultRule('image')
    rule.extensions.push('zzz')
    expect(defaultRule('image').extensions).not.toContain('zzz')
    expect(DEFAULT_EXTENSIONS_BY_CATEGORY.image).not.toContain('zzz')
  })
})

describe('normalizeExtension', () => {
  it('앞의 점을 떼고 소문자로', () => {
    expect(normalizeExtension('.PDF')).toBe('pdf')
    expect(normalizeExtension('  Jpg ')).toBe('jpg')
    expect(normalizeExtension('...gz')).toBe('gz')
  })

  it('안의 점은 거부한다 — extensionOf 는 마지막 점 뒤만 보므로 tar.gz 는 어떤 파일과도 맞지 않는다', () => {
    expect(normalizeExtension('tar.gz')).toBeNull()
  })

  it('빈 값·공백·파일 이름 금지 문자·제어 문자·너무 긴 값은 거부한다', () => {
    expect(normalizeExtension('')).toBeNull()
    expect(normalizeExtension('.')).toBeNull()
    expect(normalizeExtension('a b')).toBeNull()
    expect(normalizeExtension('a/b')).toBeNull()
    expect(normalizeExtension('a?')).toBeNull()
    expect(normalizeExtension('a')).toBeNull()
    expect(normalizeExtension('a'.repeat(21))).toBeNull()
    expect(normalizeExtension('a'.repeat(20))).toBe('a'.repeat(20))
  })

  it('한글 확장자도 파일 이름에 쓸 수 있으니 받는다', () => {
    expect(normalizeExtension('한글')).toBe('한글')
  })
})

describe('normalizeRules', () => {
  it('아무것도 아닌 값이면 기본 규칙', () => {
    expect(normalizeRules(undefined)).toEqual(defaultRules())
    expect(normalizeRules(null)).toEqual(defaultRules())
    expect(normalizeRules('rules')).toEqual(defaultRules())
    expect(normalizeRules([])).toEqual(defaultRules())
  })

  it('빠진 카테고리는 fallback 의 것, 있는 카테고리는 주어진 것 — 결과는 항상 일곱 개 순서대로', () => {
    const fallback = defaultRules().map((r) =>
      r.category === 'code' ? { ...r, enabled: false, folderName: '소스' } : r
    )
    const rules = normalizeRules(
      [{ category: 'image', folderName: '사진', extensions: ['jpg', 'png'], enabled: true }],
      fallback
    )

    expect(rules.map((r) => r.category)).toEqual([...RULE_CATEGORIES])
    expect(rules.find((r) => r.category === 'image')).toEqual({
      category: 'image',
      folderName: '사진',
      extensions: ['jpg', 'png'],
      enabled: true
    })
    expect(rules.find((r) => r.category === 'code')).toMatchObject({ enabled: false, folderName: '소스' })
  })

  it('모르는 카테고리, 객체가 아닌 원소, 중복 카테고리(뒤의 것)는 버린다', () => {
    const rules = normalizeRules([
      { category: 'movies', folderName: 'x', extensions: ['mp4'], enabled: true },
      'image',
      42,
      { category: 'image', folderName: '첫째', extensions: [], enabled: true },
      { category: 'image', folderName: '둘째', extensions: [], enabled: true }
    ])
    expect(rules.find((r) => r.category === 'image')?.folderName).toBe('첫째')
    expect(rules).toHaveLength(RULE_CATEGORIES.length)
  })

  it('확장자를 정규화하고 못 쓰는 것은 버린다. 배열이 아니면 fallback 의 목록', () => {
    const rules = normalizeRules([
      { category: 'image', folderName: '이미지', extensions: ['.JPG', 'tar.gz', 7, '', 'png'], enabled: true },
      { category: 'video', folderName: '영상', extensions: 'mp4', enabled: true }
    ])
    expect(rules.find((r) => r.category === 'image')?.extensions).toEqual(['jpg', 'png'])
    expect(rules.find((r) => r.category === 'video')?.extensions).toEqual([
      ...DEFAULT_EXTENSIONS_BY_CATEGORY.video
    ])
  })

  it('같은 확장자가 두 카테고리에 있으면 앞선 카테고리가 가진다 (스캔은 파일마다 카테고리 하나를 정해야 한다)', () => {
    const rules = normalizeRules([
      { category: 'code', folderName: '코드', extensions: ['svg'], enabled: true },
      { category: 'image', folderName: '이미지', extensions: ['svg', 'png'], enabled: true }
    ])
    // RULE_CATEGORIES 순서에서 image 가 code 보다 앞
    expect(rules.find((r) => r.category === 'image')?.extensions).toEqual(['svg', 'png'])
    expect(rules.find((r) => r.category === 'code')?.extensions).toEqual([])
  })

  it('폴더 이름은 다듬고, 못 쓰면 fallback 의 이름', () => {
    const rules = normalizeRules([
      { category: 'image', folderName: '  사진 ', extensions: [], enabled: true },
      { category: 'video', folderName: 'a/b', extensions: [], enabled: true },
      { category: 'audio', folderName: 42, extensions: [], enabled: true }
    ])
    expect(rules.find((r) => r.category === 'image')?.folderName).toBe('사진')
    expect(rules.find((r) => r.category === 'video')?.folderName).toBe('영상')
    expect(rules.find((r) => r.category === 'audio')?.folderName).toBe('음악')
  })

  it('두 카테고리가 같은 폴더 이름을 써도 된다 (한 폴더로 모은다)', () => {
    const rules = normalizeRules([
      { category: 'image', folderName: '미디어', extensions: ['jpg'], enabled: true },
      { category: 'video', folderName: '미디어', extensions: ['mp4'], enabled: true }
    ])
    expect(rules.filter((r) => r.folderName === '미디어')).toHaveLength(2)
  })

  it('enabled 가 불리언이 아니면 fallback 의 값, 모르는 키는 버린다', () => {
    const rules = normalizeRules([
      { category: 'image', folderName: '이미지', extensions: [], enabled: 'yes', extra: 1 }
    ])
    const image = rules.find((r) => r.category === 'image') as CategoryRule
    expect(image.enabled).toBe(true)
    expect(Object.keys(image).sort()).toEqual(['category', 'enabled', 'extensions', 'folderName'])
  })

  it('정규형은 다시 정규화해도 같다', () => {
    const once = normalizeRules([
      { category: 'image', folderName: '사진', extensions: ['.PNG', 'jpg'], enabled: false }
    ])
    expect(normalizeRules(once)).toEqual(once)
  })
})

describe('rulesEqual', () => {
  it('내용이 같으면 참, 순서·확장자·이름·켜짐이 하나라도 다르면 거짓', () => {
    const a = defaultRules()
    expect(rulesEqual(a, defaultRules())).toBe(true)
    expect(rulesEqual(a, [...a].reverse())).toBe(false)
    expect(rulesEqual(a, a.map((r) => (r.category === 'image' ? { ...r, enabled: false } : r)))).toBe(false)
    expect(rulesEqual(a, a.map((r) => (r.category === 'image' ? { ...r, folderName: '사진' } : r)))).toBe(false)
    expect(
      rulesEqual(a, a.map((r) => (r.category === 'image' ? { ...r, extensions: [...r.extensions, 'x'] } : r)))
    ).toBe(false)
    expect(rulesEqual(a, a.slice(1))).toBe(false)
  })
})
