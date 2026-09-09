import { describe, expect, it } from 'vitest'
import { categorize, extensionOf } from '../src/main/services/categorize'

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
  })

  it('모르는 확장자와 빈 값은 기타로 보낸다', () => {
    expect(categorize('.qwerty')).toBe('other')
    expect(categorize('')).toBe('other')
  })
})
