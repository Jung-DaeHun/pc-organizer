import { describe, expect, it } from 'vitest'
import { defaultRules } from '@shared/rules'
import { categorize, createCategorizer, extensionOf } from '../src/main/services/categorize'

describe('extensionOf', () => {
  it('확장자를 소문자로 뽑는다', () => {
    expect(extensionOf('report.PDF')).toBe('.pdf')
  })

  it('점이 여러 개면 마지막 것만 본다', () => {
    expect(extensionOf('archive.tar.gz')).toBe('.gz')
  })

  it('맨 앞의 점은 확장자가 아니라 숨김 파일 표시다', () => {
    expect(extensionOf('.gitignore')).toBe('')
    expect(extensionOf('.env')).toBe('')
  })

  it('확장자가 없거나 점으로 끝나면 빈 문자열', () => {
    expect(extensionOf('README')).toBe('')
    expect(extensionOf('weird.')).toBe('')
  })
})

describe('categorize', () => {
  it('점이 있든 없든, 대소문자 상관없이 같은 결과', () => {
    expect(categorize('.pdf')).toBe('document')
    expect(categorize('pdf')).toBe('document')
    expect(categorize('.PDF')).toBe('document')
  })

  it('종류별로 대표 확장자를 제자리에 넣는다', () => {
    expect(categorize('.hwp')).toBe('document')
    expect(categorize('.png')).toBe('image')
    expect(categorize('.mkv')).toBe('video')
    expect(categorize('.flac')).toBe('audio')
    expect(categorize('.7z')).toBe('archive')
    expect(categorize('.msi')).toBe('installer')
    expect(categorize('.tsx')).toBe('code')
    // MPEG 전송 스트림도 .ts 지만, 바탕화면에 쌓이는 건 TypeScript 쪽이다. 기본표는 코드에만 둔다
    expect(categorize('.ts')).toBe('code')
  })

  it('모르는 확장자와 빈 값은 기타로 보낸다', () => {
    expect(categorize('.qwerty')).toBe('other')
    expect(categorize('')).toBe('other')
  })
})

describe('createCategorizer — 사용자 규칙', () => {
  it('규칙의 확장자 목록을 따른다. 기본 조회 함수는 그대로다', () => {
    const rules = defaultRules().map((r) =>
      r.category === 'code'
        ? { ...r, extensions: [...r.extensions, 'svg'] }
        : r.category === 'image'
          ? { ...r, extensions: r.extensions.filter((e) => e !== 'svg') }
          : r
    )
    const custom = createCategorizer(rules)

    expect(custom('.svg')).toBe('code')
    expect(custom('.SVG')).toBe('code')
    expect(categorize('.svg')).toBe('image')
  })

  it('꺼 둔 카테고리도 분류는 한다 — 끄는 건 옮기지 않는다는 뜻이지 종류가 없어지는 게 아니다', () => {
    const custom = createCategorizer(defaultRules().map((r) => (r.category === 'code' ? { ...r, enabled: false } : r)))
    expect(custom('.ts')).toBe('code')
  })

  it('같은 확장자가 두 규칙에 있으면 앞선 규칙이 가진다', () => {
    const custom = createCategorizer([
      { category: 'image', folderName: '이미지', extensions: ['x'], enabled: true },
      { category: 'code', folderName: '코드', extensions: ['x'], enabled: true }
    ])
    expect(custom('.x')).toBe('image')
  })

  it('규칙이 비어 있으면 전부 기타', () => {
    expect(createCategorizer([])('.pdf')).toBe('other')
  })
})
