import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createRecycleBinLookup,
  driveLetterOf,
  measureRecycleBinUsage,
  parseRecycleBinPolicy,
  type RawRecycleBinPolicy,
  type RecycleBinDirent,
  type RecycleBinFsIo,
  type RecycleBinStat
} from '../src/main/lib/recycleBin'

/**
 * 휴지통 설정·사용량 조회(lib/recycleBin.ts). PowerShell 도 실제 fs 도 돌리지 않는다 — 조회 결과를 어떻게
 * 읽는지(한도는 MiB → 바이트, '휴지통을 쓰지 않음' 은 어느 자리에 있든 bypassed, 모르면 null)와 사용량을
 * `$R` 항목만으로 어떻게 더하는지(링크는 안 따라가고, 못 읽으면 모른다)를 본다.
 */

const MIB = 1024 * 1024

/** 이 머신의 실제 조회 결과 모양 (2026-09-13, C: 930GiB, 한도 49685MiB) */
const typical: RawRecycleBinPolicy = {
  Capacity: 999_022_391_296,
  MaxCapacity: 49_685,
  NukeOnDelete: 0,
  NoRecycleFilesUser: null,
  NoRecycleFilesMachine: null,
  RecycleBinSizeUser: null,
  RecycleBinSizeMachine: null,
  Sid: 'S-1-5-21-1111-2222-3333-1001'
}

describe('parseRecycleBinPolicy', () => {
  it('MaxCapacity(MiB)를 바이트 한도로 읽는다', () => {
    expect(parseRecycleBinPolicy(typical)).toEqual({ maxBytes: 49_685 * MIB, bypassed: false })
  })

  it('조회 실패(null)와 볼륨 키 없음(MaxCapacity null)은 모른다 — null', () => {
    expect(parseRecycleBinPolicy(null)).toBeNull()
    expect(parseRecycleBinPolicy({ ...typical, MaxCapacity: null })).toBeNull()
  })

  it("'휴지통을 쓰지 않음' 은 볼륨 설정이든 사용자·컴퓨터 정책이든 bypassed", () => {
    expect(parseRecycleBinPolicy({ ...typical, NukeOnDelete: 1 })?.bypassed).toBe(true)
    expect(parseRecycleBinPolicy({ ...typical, NoRecycleFilesUser: 1 })?.bypassed).toBe(true)
    expect(parseRecycleBinPolicy({ ...typical, NoRecycleFilesMachine: 1 })?.bypassed).toBe(true)
    // 볼륨 키가 없어도 정책이 있으면 답은 정해진다 — 보내지 않는다
    expect(parseRecycleBinPolicy({ ...typical, MaxCapacity: null, NoRecycleFilesMachine: 1 })).toEqual({
      maxBytes: 0,
      bypassed: true
    })
  })

  it('그룹 정책의 퍼센트 한도가 있으면 볼륨 한도와 작은 쪽을 쓴다', () => {
    // 1% of 999GB ≈ 9.99GB < 49685MiB
    const withPolicy = parseRecycleBinPolicy({ ...typical, RecycleBinSizeMachine: 1 })
    expect(withPolicy?.maxBytes).toBe(Math.floor(999_022_391_296 / 100))
    // 퍼센트가 커서 볼륨 한도가 더 작으면 볼륨 한도
    expect(parseRecycleBinPolicy({ ...typical, RecycleBinSizeUser: 90 })?.maxBytes).toBe(49_685 * MIB)
  })

  it('이상한 값(음수·문자열)은 모른다로 본다', () => {
    expect(parseRecycleBinPolicy({ ...typical, MaxCapacity: -1 })).toBeNull()
    expect(parseRecycleBinPolicy({ ...typical, MaxCapacity: '49685' as unknown as number })).toBeNull()
  })
})

describe('driveLetterOf', () => {
  it('드라이브 문자 루트만 받고 대문자로 맞춘다', () => {
    expect(driveLetterOf('C:\\')).toBe('C')
    expect(driveLetterOf('d:\\')).toBe('D')
    expect(driveLetterOf('E:/')).toBe('E')
  })

  it('UNC·빈 루트·경로 조각은 null — 그 볼륨의 휴지통은 모른다', () => {
    expect(driveLetterOf('\\\\server\\share\\')).toBeNull()
    expect(driveLetterOf('')).toBeNull()
    expect(driveLetterOf('C:\\Users')).toBeNull()
    // 드라이브 문자 하나만 스크립트에 끼워 넣으므로 여기서 걸러진 문자열은 PowerShell 에 닿지 않는다
    expect(driveLetterOf("C:'; Remove-Item x")).toBeNull()
  })
})

// ---------------------------------------------------------------- 사용량 (가짜 fs)

type Node =
  | { kind: 'file'; size: number }
  | { kind: 'dir'; children: Record<string, Node> }
  /** 심볼릭 링크·정션. 따라가면 안 된다 */
  | { kind: 'link' }

const file = (size: number): Node => ({ kind: 'file', size })
const dir = (children: Record<string, Node>): Node => ({ kind: 'dir', children })
const link: Node = { kind: 'link' }

function fsError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

/** `root` 아래 트리를 흉내 낸다. `failing` 에 든 경로는 readdir/lstat 이 EACCES 로 실패한다 */
function fakeFs(
  root: string,
  tree: Record<string, Node> | null,
  failing: string[] = []
): RecycleBinFsIo & { reads: string[] } {
  const find = (p: string): Node | undefined => {
    if (tree === null) return undefined
    const rel = relative(root, p)
    let node: Node = dir(tree)
    if (rel === '') return node
    for (const part of rel.split(sep)) {
      if (node.kind !== 'dir') return undefined
      const next: Node | undefined = node.children[part]
      if (!next) return undefined
      node = next
    }
    return node
  }
  const dirent = (name: string, node: Node): RecycleBinDirent => ({
    name,
    isFile: () => node.kind === 'file',
    isDirectory: () => node.kind === 'dir',
    isSymbolicLink: () => node.kind === 'link'
  })
  const stat = (node: Node): RecycleBinStat => ({
    size: node.kind === 'file' ? node.size : 0,
    isFile: () => node.kind === 'file',
    isDirectory: () => node.kind === 'dir',
    isSymbolicLink: () => node.kind === 'link'
  })
  const reads: string[] = []
  return {
    reads,
    async readdir(p) {
      reads.push(p)
      if (failing.includes(p)) throw fsError('EACCES')
      const node = find(p)
      if (!node) throw fsError('ENOENT')
      if (node.kind !== 'dir') throw fsError('ENOTDIR')
      return Object.entries(node.children).map(([name, child]) => dirent(name, child))
    },
    async lstat(p) {
      if (failing.includes(p)) throw fsError('EACCES')
      const node = find(p)
      if (!node) throw fsError('ENOENT')
      return stat(node)
    }
  }
}

const BIN = join('C:\\', '$Recycle.Bin', typical.Sid!)

describe('measureRecycleBinUsage', () => {
  it('$R 항목의 크기만 더한다 — $I 메타와 desktop.ini 는 세지 않는다', async () => {
    const io = fakeFs(BIN, {
      '$R1AAAAA.bin': file(1000),
      '$R2BBBBB.pdf': file(300),
      '$I1AAAAA.bin': file(348),
      '$I2BBBBB.pdf': file(348),
      // 영구 삭제된 항목의 고아 $I — 실제 휴지통에 흔하다. 세면 과대계산
      '$IORPHAN.bin': file(358),
      'desktop.ini': file(129)
    })
    expect(await measureRecycleBinUsage(BIN, io)).toBe(1300)
  })

  it('폴더째 지운 것($R 디렉터리)은 안을 내려가며 더한다', async () => {
    const io = fakeFs(BIN, {
      '$RFOLDER': dir({
        'a.txt': file(10),
        sub: dir({ 'b.txt': file(20), deeper: dir({ 'c.txt': file(30) }) })
      }),
      '$RFILE.bin': file(5)
    })
    expect(await measureRecycleBinUsage(BIN, io)).toBe(65)
  })

  it('링크·정션은 따라가지 않고 0 으로 센다', async () => {
    const io = fakeFs(BIN, {
      '$RLINK': link,
      '$RFOLDER': dir({ 'real.txt': file(7), 'junction-to-c': link })
    })
    expect(await measureRecycleBinUsage(BIN, io)).toBe(7)
    // 링크 쪽은 readdir 도 하지 않는다
    expect(io.reads).toEqual([BIN, join(BIN, '$RFOLDER')])
  })

  it('휴지통 폴더가 아직 없으면 0 — 이 볼륨에서 휴지통을 쓴 적이 없다', async () => {
    expect(await measureRecycleBinUsage(BIN, fakeFs(BIN, null))).toBe(0)
  })

  it('못 읽으면 null — 잴 수 없으면 모른다 (맨 위든, 안쪽 폴더든, lstat 이든)', async () => {
    expect(await measureRecycleBinUsage(BIN, fakeFs(BIN, {}, [BIN]))).toBeNull()

    const nested = { '$RFOLDER': dir({ locked: dir({ 'x': file(1) }) }) }
    expect(await measureRecycleBinUsage(BIN, fakeFs(BIN, nested, [join(BIN, '$RFOLDER', 'locked')]))).toBeNull()

    const one = { '$RONE.bin': file(1) }
    expect(await measureRecycleBinUsage(BIN, fakeFs(BIN, one, [join(BIN, '$RONE.bin')]))).toBeNull()
  })
})

// ---------------------------------------------------------------- 조립

describe('createRecycleBinLookup', () => {
  const tree = { '$RA.bin': file(1000), '$RB.bin': file(2000), '$IA.bin': file(348) }

  function lookupWith(raw: RawRecycleBinPolicy | null, io = fakeFs(BIN, tree)) {
    const scripts: string[] = []
    const lookup = createRecycleBinLookup(io, async (script) => {
      scripts.push(script)
      return raw
    })
    return { lookup, scripts, io }
  }

  it('한도는 PowerShell 에서, 사용량은 <root>$Recycle.Bin\\<SID> 에서 — 둘을 합친다', async () => {
    const { lookup, scripts, io } = lookupWith(typical)
    expect(await lookup('C:\\')).toEqual({ maxBytes: 49_685 * MIB, bypassed: false, usedBytes: 3000 })
    expect(io.reads).toEqual([BIN])
    // 스크립트에 끼워 넣는 것은 드라이브 문자 하나뿐
    expect(scripts).toHaveLength(1)
    expect(scripts[0]).toContain("DriveLetter='C:'")
  })

  it('드라이브 문자가 없는 루트는 PowerShell 을 부르지도 않고 null', async () => {
    const { lookup, scripts, io } = lookupWith(typical)
    expect(await lookup('\\\\server\\share\\')).toBeNull()
    expect(scripts).toEqual([])
    expect(io.reads).toEqual([])
  })

  it('조회 실패·한도 모름이면 사용량을 재지 않고 null', async () => {
    const a = lookupWith(null)
    expect(await a.lookup('C:\\')).toBeNull()
    expect(a.io.reads).toEqual([])

    const b = lookupWith({ ...typical, MaxCapacity: null })
    expect(await b.lookup('C:\\')).toBeNull()
    expect(b.io.reads).toEqual([])
  })

  it('SID 가 없거나 SID 모양이 아니면 null — 경로에 끼워 넣지 않는다', async () => {
    for (const sid of [null, '', '..', 'S-1-5-21-1\\..', 'S-1-5-21-1/../..', 'Administrator']) {
      const { lookup, io } = lookupWith({ ...typical, Sid: sid })
      expect(await lookup('C:\\')).toBeNull()
      expect(io.reads).toEqual([])
    }
  })

  it("'휴지통을 쓰지 않음' 이면 사용량과 무관하게 막히므로 재지 않는다", async () => {
    const { lookup, io } = lookupWith({ ...typical, NukeOnDelete: 1 })
    expect(await lookup('C:\\')).toEqual({ maxBytes: 49_685 * MIB, bypassed: true, usedBytes: 0 })
    expect(io.reads).toEqual([])
  })

  it('사용량을 못 재면 null — 한도를 알아도 합계를 모르면 보내지 않는다', async () => {
    const { lookup } = lookupWith(typical, fakeFs(BIN, tree, [BIN]))
    expect(await lookup('C:\\')).toBeNull()
  })

  it('휴지통 폴더가 없는 볼륨은 사용량 0', async () => {
    const { lookup } = lookupWith(typical, fakeFs(BIN, null))
    expect(await lookup('C:\\')).toEqual({ maxBytes: 49_685 * MIB, bypassed: false, usedBytes: 0 })
  })
})
