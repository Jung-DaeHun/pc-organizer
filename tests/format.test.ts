import { describe, expect, it } from 'vitest'
import {
  errorMessage,
  formatAge,
  formatBytes,
  formatCount,
  formatPercent,
  truncatePath
} from '@/lib/format'

describe('errorMessage', () => {
  it('Electron 이 붙이는 IPC 접두를 떼어낸다', () => {
    const wrapped = new Error("Error invoking remote method 'plan:build': Error: 먼저 스캔을 실행하세요")
    expect(errorMessage(wrapped)).toBe('먼저 스캔을 실행하세요')
  })

  it('접두가 없으면 그대로, 빈 값이면 대체 문구', () => {
    expect(errorMessage(new Error('그냥 오류'))).toBe('그냥 오류')
    expect(errorMessage('문자열')).toBe('문자열')
    expect(errorMessage(null)).toBe('알 수 없는 오류')
    expect(errorMessage(new Error(''), '실패')).toBe('실패')
  })
})

describe('formatBytes', () => {
  it('바이트 단위에서는 소수점을 붙이지 않는다', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
  })

  it('윈도우 탐색기와 같은 1024 기준으로 나눈다', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB')
  })

  it('음수나 NaN이 들어와도 화면이 깨지지 않는다', () => {
    expect(formatBytes(-1)).toBe('0 B')
    expect(formatBytes(Number.NaN)).toBe('0 B')
  })

  it('가장 큰 단위를 넘어서도 단위를 지어내지 않는다', () => {
    expect(formatBytes(1024 ** 7)).toContain('PB')
  })
})

describe('formatCount', () => {
  it('천 단위로 끊는다', () => {
    expect(formatCount(1234567)).toBe('1,234,567')
  })
})

describe('formatPercent', () => {
  it('비율을 백분율로 바꾼다', () => {
    expect(formatPercent(0.732)).toBe('73%')
    expect(formatPercent(1)).toBe('100%')
  })

  it('계산 불가능한 값은 0%로 떨어뜨린다', () => {
    expect(formatPercent(Number.NaN)).toBe('0%')
  })
})

describe('formatAge', () => {
  const now = new Date('2026-09-09T00:00:00Z').getTime()
  const DAY = 86_400_000

  it('경과 기간에 맞는 단위를 고른다', () => {
    expect(formatAge(now, now)).toBe('오늘')
    expect(formatAge(now - 3 * DAY, now)).toBe('3일 전')
    expect(formatAge(now - 60 * DAY, now)).toBe('2개월 전')
    expect(formatAge(now - 400 * DAY, now)).toBe('1년 전')
  })
})

describe('truncatePath', () => {
  it('짧은 경로는 그대로 둔다', () => {
    expect(truncatePath('C:/Users/me/a.txt', 48)).toBe('C:/Users/me/a.txt')
  })

  it('긴 경로는 가운데를 접어 길이를 맞춘다', () => {
    const long = 'C:/Users/me/very/deep/nested/folder/structure/report-final-v3.pdf'
    const result = truncatePath(long, 30)

    expect(result.length).toBeLessThanOrEqual(30)
    expect(result).toContain('...')
    // 파일 이름 쪽이 남아야 무슨 파일인지 알아볼 수 있다
    expect(result.endsWith('.pdf')).toBe(true)
  })
})
