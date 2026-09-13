import { describe, expect, it } from 'vitest'
import { createAppsLister } from '../src/main/services/apps'

/** 스크립트별로 다른 결과를 돌려주는 가짜 PowerShell. 설치 앱 스크립트는 'Uninstall', 시작 프로그램은 'Run' 으로 구분 */
function listerWith(apps: unknown, startup: unknown) {
  const scripts: string[] = []
  const list = createAppsLister(async (script) => {
    scripts.push(script)
    return script.includes('CurrentVersion\\Uninstall') ? apps : startup
  })
  return { list, scripts }
}

const rawApp = (name: string, sizeKb: number | null = 100, version = '1.0') => ({
  DisplayName: name,
  DisplayVersion: version,
  Publisher: 'P',
  EstimatedSize: sizeKb,
  InstallDate: '20240105',
  InstallLocation: ''
})

describe('createAppsLister', () => {
  it('PowerShell 조회가 실패(null)하면 빈 목록이 아니라 거부한다 — 화면이 "설치된 앱이 없습니다"라고 거꾸로 말하지 않게', async () => {
    await expect(listerWith(null, []).list()).rejects.toThrow('읽지 못했습니다')
    await expect(listerWith([], null).list()).rejects.toThrow('읽지 못했습니다')
    await expect(listerWith(null, null).list()).rejects.toThrow('읽지 못했습니다')
  })

  it('빈 배열은 실패가 아니다 — 빈 목록으로 이행한다', async () => {
    await expect(listerWith([], []).list()).resolves.toEqual({ apps: [], startup: [] })
  })

  it('스크립트는 항목이 없어도 [] 를 내도록 ConvertTo-Json -InputObject 로 끝난다 — 그래야 null 이 실패다', async () => {
    const { list, scripts } = listerWith([], [])
    await list()
    expect(scripts).toHaveLength(2)
    for (const script of scripts) {
      expect(script).toContain('ConvertTo-Json -InputObject')
      expect(script).not.toMatch(/\|\s*ConvertTo-Json/)
    }
  })

  it('조회만 한다 — 스크립트에 쓰기 cmdlet 이 없다', async () => {
    const { list, scripts } = listerWith([], [])
    await list()
    for (const script of scripts) {
      expect(script).not.toMatch(/Set-ItemProperty|Remove-Item|New-Item\b|Start-Process|Invoke-Expression/)
      expect(script).not.toContain('UninstallString')
    }
  })

  it('정규화: KB → 바이트, 이름 없는 항목 제외, 32/64비트 중복 제거, 용량 큰 순 → 이름순', async () => {
    const { list } = listerWith(
      [
        rawApp('b', 10),
        rawApp('a', 10),
        rawApp('big', 1000),
        rawApp('big', 1000), // WOW6432Node 에 같은 앱
        rawApp('big', 1000, '2.0'), // 버전이 다르면 다른 항목
        { ...rawApp('nameless'), DisplayName: null },
        rawApp('unknown-size', null)
      ],
      []
    )
    const { apps } = await list()
    expect(apps.map((a) => [a.name, a.version, a.sizeBytes])).toEqual([
      ['big', '1.0', 1000 * 1024],
      ['big', '2.0', 1000 * 1024],
      ['a', '1.0', 10 * 1024],
      ['b', '1.0', 10 * 1024],
      ['unknown-size', '1.0', 0]
    ])
  })

  it('ConvertTo-Json 이 항목 하나를 객체로 내도(옛 모양) 배열로 받는다', async () => {
    const { list } = listerWith(rawApp('only'), { Name: 'x', Command: 'x.exe', Source: 'registry' })
    const info = await list()
    expect(info.apps.map((a) => a.name)).toEqual(['only'])
    expect(info.startup).toEqual([{ name: 'x', command: 'x.exe', source: 'registry' }])
  })

  it('시작 프로그램: 이름 없는 항목 제외, source 는 folder 아니면 registry, 이름순', async () => {
    const { list } = listerWith(
      [],
      [
        { Name: 'z', Command: ' z.exe ', Source: 'folder' },
        { Name: null, Command: 'no-name', Source: 'registry' },
        { Name: 'a', Command: null, Source: 'weird' }
      ]
    )
    const { startup } = await list()
    expect(startup).toEqual([
      { name: 'a', command: '', source: 'registry' },
      { name: 'z', command: 'z.exe', source: 'folder' }
    ])
  })
})
