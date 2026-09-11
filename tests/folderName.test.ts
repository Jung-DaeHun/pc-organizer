import { describe, expect, it } from 'vitest'
import { folderKey, sanitizeFolderName } from '@shared/folderName'

describe('sanitizeFolderName', () => {
  it('쓸 수 있는 이름은 앞뒤 공백만 정리해 돌려준다', () => {
    expect(sanitizeFolderName('키보드 드라이버')).toBe('키보드 드라이버')
    expect(sanitizeFolderName('  양끝 공백  ')).toBe('양끝 공백')
    expect(sanitizeFolderName('2026.09 사진')).toBe('2026.09 사진')
  })

  it('윈도우에서 쓸 수 없는 이름을 거른다', () => {
    for (const bad of [
      // 'a\\b' 는 백슬래시 하나다. 'a\b' 로 적으면 백스페이스(U+0008)가 되어 다른 검사를 탄다
      '', '   ', '.', '..', '../etc', 'a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b',
      'CON', 'con.txt', 'LPT1', 'com9.old', '.hidden', 'trailing.', 'a\u0007b',
      'x'.repeat(61)
    ]) {
      expect(sanitizeFolderName(bad), JSON.stringify(bad)).toBeNull()
    }
  })

  it('윈도우 경로 구분자(백슬래시)는 제어 문자 검사가 아니라 금지 문자 검사로 걸린다', () => {
    const withBackslash = 'a\\b'
    expect(withBackslash).toHaveLength(3)
    expect(withBackslash.charCodeAt(1)).toBe(0x5c)
    expect(sanitizeFolderName(withBackslash)).toBeNull()
  })
})

describe('folderKey', () => {
  it('대소문자만 다른 이름은 같은 폴더다', () => {
    expect(folderKey('Photos')).toBe(folderKey('photos'))
    expect(folderKey('사진')).not.toBe(folderKey('사진 '))
  })
})
