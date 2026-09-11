import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { FileEntry } from '@shared/types'
import { hashHead } from '../src/main/lib/hash'
import { findDuplicates } from '../src/main/services/opportunities'
import { isCloudOnly, mergeEntries, scanFolder, scanFolders } from '../src/main/services/scanner'

/**
 * 픽스처는 describe 밖에서 미리 만든다.
 *
 * it.skipIf 는 테스트를 수집하는 시점에 조건을 읽는데, beforeAll 은 그보다 나중에 돈다.
 * 링크 생성 여부를 beforeAll 에서 정하면 조건이 항상 초기값으로 읽혀 테스트가 조용히 건너뛰어진다.
 */
const root = await mkdtemp(join(tmpdir(), 'pc-organizer-test-'))

await writeFile(join(root, 'report.pdf'), 'a'.repeat(120))
await writeFile(join(root, 'photo.PNG'), 'b'.repeat(50))
await writeFile(join(root, 'README'), 'c'.repeat(10))

await mkdir(join(root, 'nested', 'deeper'), { recursive: true })
await writeFile(join(root, 'nested', 'song.mp3'), 'd'.repeat(30))
await writeFile(join(root, 'nested', 'deeper', 'main.ts'), 'e'.repeat(20))

await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'f'.repeat(999))

await mkdir(join(root, 'empty'), { recursive: true })

// 윈도우에서 정션은 보통 권한 없이도 만들어지지만, 정책에 따라 막힌 환경이 있다.
// 만들 수 없으면 링크 관련 검증만 건너뛴다.
let linkCreated = false
try {
  await symlink(join(root, 'nested'), join(root, 'loop-link'), 'junction')
  linkCreated = true
} catch {
  linkCreated = false
}

describe('isCloudOnly', () => {
  it('크기는 있는데 할당된 블록이 없으면 클라우드 전용으로 본다', () => {
    // OneDrive의 '온라인 전용' 파일이 이 모양이다.
    // 내용을 읽는 순간 내려받기가 시작되므로 해시 대상에서 빼야 한다.
    expect(isCloudOnly({ size: 5_000_000, blocks: 0 })).toBe(true)
  })

  it('실제로 내려받아 둔 파일은 아니다', () => {
    expect(isCloudOnly({ size: 5_000_000, blocks: 9776 })).toBe(false)
  })

  it('1KB 이하는 판정하지 않는다', () => {
    // NTFS는 아주 작은 파일을 MFT 안에 넣어버려(resident file) 할당 블록이 0으로 잡힌다.
    // 이걸 클라우드 전용으로 오인하면 멀쩡한 작은 파일이 중복 검사에서 통째로 빠진다.
    expect(isCloudOnly({ size: 200, blocks: 0 })).toBe(false)
  })

  it('빈 파일은 아니다', () => {
    expect(isCloudOnly({ size: 0, blocks: 0 })).toBe(false)
  })
})

// 픽스처를 여러 describe가 같이 쓰므로 파일 전체가 끝난 뒤에 지운다
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('scanFolder', () => {
  it('하위 폴더까지 재귀적으로 훑는다', async () => {
    const scan = await scanFolder(root, { excludedDirNames: ['node_modules'] })
    const names = scan.entries.map((e) => e.name).sort()

    expect(names).toEqual(['README', 'main.ts', 'photo.PNG', 'report.pdf', 'song.mp3'])
  })

  it('제외 목록에 있는 폴더는 통째로 건너뛴다', async () => {
    const scan = await scanFolder(root, { excludedDirNames: ['node_modules'] })
    expect(scan.entries.some((e) => e.path.includes('node_modules'))).toBe(false)
  })

  it('제외 목록을 비우면 그 폴더도 들어온다', async () => {
    const scan = await scanFolder(root, { excludedDirNames: [] })
    expect(scan.entries.some((e) => e.name === 'index.js')).toBe(true)
  })

  it('확장자와 카테고리를 매긴다', async () => {
    const scan = await scanFolder(root, { excludedDirNames: ['node_modules'] })
    const byName = new Map(scan.entries.map((e) => [e.name, e]))

    expect(byName.get('report.pdf')?.category).toBe('document')
    expect(byName.get('photo.PNG')?.ext).toBe('.png')
    expect(byName.get('photo.PNG')?.category).toBe('image')
    // 확장자가 없는 파일도 빠뜨리지 않는다
    expect(byName.get('README')?.ext).toBe('')
    expect(byName.get('README')?.category).toBe('other')
  })

  it('크기를 정확히 읽는다', async () => {
    const scan = await scanFolder(root, { excludedDirNames: ['node_modules'] })
    const report = scan.entries.find((e) => e.name === 'report.pdf')

    expect(report?.size).toBe(120)
  })

  it.skipIf(!linkCreated)('심볼릭 링크와 정션은 따라가지 않는다', async () => {
    const scan = await scanFolder(root, { excludedDirNames: ['node_modules'] })

    // 링크를 따라갔다면 nested 안의 파일이 두 번씩 잡힌다
    expect(scan.entries.filter((e) => e.name === 'song.mp3')).toHaveLength(1)
    expect(scan.entries.some((e) => e.path.includes('loop-link'))).toBe(false)
    expect(scan.skippedCount).toBeGreaterThan(0)
  })

  it('열지 못한 폴더가 있어도 예외를 던지지 않는다', async () => {
    const scan = await scanFolder(join(root, '존재하지-않는-폴더'), { excludedDirNames: [] })

    expect(scan.entries).toHaveLength(0)
    expect(scan.skippedCount).toBe(1)
  })

  it('진행률 콜백은 스캔이 끝날 때 최종 개수를 알려준다', async () => {
    const seen: number[] = []
    await scanFolder(root, {
      excludedDirNames: ['node_modules'],
      onProgress: (p) => seen.push(p.filesSeen)
    })

    expect(seen.at(-1)).toBe(5)
  })
})

describe('mergeEntries', () => {
  const nested = join(root, 'nested')

  it('감시 폴더가 포함 관계여도 같은 파일을 한 번만 센다', async () => {
    // '바탕화면'이 등록된 상태에서 '바탕화면\프로젝트'를 추가하는 건 흔한 조작이다.
    // 하위 트리가 두 폴더에서 각각 잡히므로 그대로 이어 붙이면 파일 수와 용량이 그만큼 부푼다.
    const scans = await scanFolders([root, nested], { excludedDirNames: ['node_modules'] })

    // 폴더별 결과는 각 폴더의 실제 내용 그대로 (root 5개 + nested 2개)
    expect(scans.flatMap((s) => s.entries)).toHaveLength(7)

    const merged = mergeEntries(scans)
    expect(merged).toHaveLength(5)
    expect(new Set(merged.map((e) => e.path)).size).toBe(5)
  })

  it('겹친 파일이 자기 자신과 중복 후보로 묶이지 않는다', async () => {
    // 같은 경로가 두 번 들어가면 크기도 해시도 같으니 진짜 중복이 없어도
    // 파일마다 1개분씩 '지울 수 있는 양'으로 잡혔다.
    const scans = await scanFolders([root, nested], { excludedDirNames: ['node_modules'] })

    const naive = await findDuplicates(
      scans.flatMap((s) => s.entries),
      hashHead
    )
    expect(naive.count).toBe(2)

    const deduped = await findDuplicates(mergeEntries(scans), hashHead)
    expect(deduped.count).toBe(0)
    expect(deduped.bytes).toBe(0)
  })

  it('먼저 나온 폴더의 항목을 남긴다', () => {
    const first: FileEntry = {
      path: join(root, 'x.bin'),
      name: 'x.bin',
      ext: '.bin',
      size: 1,
      mtimeMs: 0,
      atimeMs: 0,
      category: 'other',
      isCloudOnly: false
    }
    const second = { ...first, size: 2 }

    const merged = mergeEntries([
      { path: root, entries: [first], skippedCount: 0 },
      { path: root, entries: [second], skippedCount: 0 }
    ])

    expect(merged).toEqual([first])
  })

  it.skipIf(process.platform !== 'win32')('윈도우에서는 대소문자만 다른 경로도 같은 파일이다', () => {
    const lower: FileEntry = {
      path: join(root, 'photo.png'),
      name: 'photo.png',
      ext: '.png',
      size: 1,
      mtimeMs: 0,
      atimeMs: 0,
      category: 'image',
      isCloudOnly: false
    }
    const upper = { ...lower, path: join(root, 'PHOTO.PNG'), name: 'PHOTO.PNG' }

    const merged = mergeEntries([
      { path: root, entries: [lower], skippedCount: 0 },
      { path: root.toUpperCase(), entries: [upper], skippedCount: 0 }
    ])

    expect(merged).toHaveLength(1)
  })
})
