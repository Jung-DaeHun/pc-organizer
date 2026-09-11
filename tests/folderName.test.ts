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
      '', '   ', '.', '..', '../etc', 'a/b', 'a\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b',
      'CON', 'con.txt', 'LPT1', 'com9.old', '.hidden', 'trailing.', 'a\u0007b',
      'x'.repeat(61)
    ]) {
      expect(sanitizeFolderName(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})

describe('folderKey', () => {
  it('대소문자만 다른 이름은 같은 폴더다', () => {
    expect(folderKey('Photos')).toBe(folderKey('photos'))
    expect(folderKey('사진')).not.toBe(folderKey('사진 '))
  })
})
