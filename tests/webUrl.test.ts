import { describe, expect, it } from 'vitest'
import { isWebUrl } from '../src/main/lib/webUrl'

describe('isWebUrl — 새 창 요청 중 기본 브라우저로 넘길 것', () => {
  it('http(s) 만 통과한다', () => {
    expect(isWebUrl('https://example.com/path?q=1#x')).toBe(true)
    expect(isWebUrl('http://localhost:5173/')).toBe(true)
    expect(isWebUrl('HTTPS://EXAMPLE.COM')).toBe(true)
  })

  it('로컬 파일·앱 스킴·스크립트는 renderer 의 값으로 열지 않는다', () => {
    expect(isWebUrl('file:///C:/Windows/System32/cmd.exe')).toBe(false)
    expect(isWebUrl('ms-settings:appsfeatures')).toBe(false)
    expect(isWebUrl('javascript:alert(1)')).toBe(false)
    expect(isWebUrl('mailto:a@b.c')).toBe(false)
    expect(isWebUrl('ftp://example.com/')).toBe(false)
    expect(isWebUrl('about:blank')).toBe(false)
  })

  it('주소가 아닌 문자열은 거짓', () => {
    expect(isWebUrl('')).toBe(false)
    expect(isWebUrl('example.com')).toBe(false)
    expect(isWebUrl('C:\\Users\\me\\a.html')).toBe(false)
    expect(isWebUrl('//example.com')).toBe(false)
  })
})
