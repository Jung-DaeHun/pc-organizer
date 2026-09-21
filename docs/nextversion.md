# 다음 버전 내기 — 체크리스트

0.1.0 을 낸 절차(2026-09-15)를 다음 버전용으로 정리한 것이다. 배경 설명은 `docs/release.md`, 지켜야 할 규칙은 `CLAUDE.md`.
아래에서 `X.Y.Z` 는 새 버전 번호다. **버전 번호의 원본은 `package.json` 의 `version` 하나**이고, 설치 파일 이름
(`pc-organizer-setup-X.Y.Z.exe`)·태그(`vX.Y.Z`)·릴리스 노트 파일 이름은 전부 거기서 따라온다.

## 1. 코드가 바뀌었으면 — 올리기 전에 확인할 것

- [ ] `code-reviewer` 에이전트로 리뷰했다 (`.claude/skills/review/SKILL.md`). 불변 조건 1~10 이 그대로인지가 핵심이다.
- [ ] **옛 데이터를 그대로 읽는가.** 설치본과 개발 모드가 같은 `%APPDATA%\pc-organizer` 를 쓰고, 업데이트해도 이 폴더는
      남는다. 이전 버전이 남긴 파일을 새 코드가 읽어야 한다:
  - `settings.json` — 새 필드는 `store.ts` 의 `normalizeSettings` 가 기본값을 채워야 한다. 없는 필드로 앱이 죽으면 안 된다.
  - `journal.json` — 기록 형식을 바꿨으면 옛 기록도 읽혀야 한다(`kind` 가 없으면 이동, 처럼). 옛 기록의 실행취소가
    여전히 되는지 `tests/journal.test.ts` 에 못 박는다.
  - `secrets.json` — 형식을 바꾸지 않는다. 바꾸면 사용자가 API 키를 다시 넣어야 한다.
- [ ] 화면이 바뀌었으면 `docs/screenshot.png` 를 다시 찍는다 (아래 "스크린샷").
- [ ] `README.md` 의 "지금 할 수 있는 것" 이 새 기능·바뀐 동작과 맞는다. `architecture.md` 도 흐름·채널이 바뀌었으면 같이.
- [ ] 의존성을 올렸으면(특히 Electron) `npm run package` 뒤 설치본 스모크 테스트를 **꼭** 한다 — 개발 모드에서만 되고
      asar 안에서 깨지는 것(경로·네이티브 모듈)은 거기서만 보인다.

## 2. 버전과 노트

- [ ] `package.json` 의 `version` 을 `X.Y.Z` 로 올린다 (`package-lock.json` 도 같이 — `npm install` 한 번이면 맞춰진다).
- [ ] `docs/release-notes-X.Y.Z.md` 를 쓴다. 릴리스 페이지에는 **그 버전의 노트만** 보이므로 매번 들어가야 하는 것:
  - 이번 버전에서 바뀐 것 (사용자 눈에 보이는 것 위주. 고친 버그는 "어떤 상황에서 무엇이 잘못됐었는지"로)
  - **영구 삭제는 없습니다** 문단
  - AI 추천은 선택 사항이라는 것
  - 설치 방법과 **SmartScreen · 스마트 앱 컨트롤 경고** 안내 (서명이 없는 한 계속)
  - 이전 버전 위에 설치하면 설정·API 키·실행 기록이 그대로 남는다는 것
  - `docs/release-notes-0.1.0.md` 를 복사해서 "무엇을 하나" 절을 "바뀐 것" 절로 바꾸면 된다.
- [ ] 위 두 가지를 커밋한다 (커밋 전 훅이 `npm run verify` 를 돈다).

## 3. 만들기

```powershell
npm run verify                       # 린트 → 타입 검사 → 테스트 → 빌드
npm run package                      # release\pc-organizer-setup-X.Y.Z.exe
Get-AuthenticodeSignature release\pc-organizer-setup-X.Y.Z.exe   # NotSigned 가 정상 (서명은 하지 않는다)
Get-Item release\pc-organizer-setup-X.Y.Z.exe | Select-Object Length, LastWriteTime   # 방금 만든 것인지, 크기가 이상하지 않은지 (0.1.0 은 113 MB)
```

- [ ] `release\` 는 gitignore 라 이전 빌드가 남아 있다. **파일 이름에 새 버전이 붙어 있고 시각이 방금인지** 본다 — `version` 을
      안 올리고 패키징하면 옛 이름으로 덮어써지고 그대로 올라간다.
- [ ] 설치본 스모크 테스트 — `release\win-unpacked\PC 정리 도구.exe` 를 Playwright 로 띄워 대시보드 로드 → 스캔 완료까지 본다
      (아래 "스크린샷" 의 스크립트에서 `executablePath` 만 바꾸면 된다). 설치본은 실제 `%APPDATA%\pc-organizer` 를 읽고 쓴다.
- [ ] 이전 버전이 설치된 PC 가 있으면 새 설치 파일을 그 위에 설치해 본다. 설정·실행 기록이 남아 있고 '최근 실행' 의 실행취소가
      되는지, 설치된 앱 목록에 "PC 정리 도구 X.Y.Z" 하나만 있는지(둘이 되면 안 된다).

## 4. 올리기 — 공개 동작이라 사용자가 "진행해" 라고 한 뒤에만

```powershell
git status                           # 깨끗해야 한다. 올릴 커밋이 main 에 있어야 한다
git push origin main
git tag vX.Y.Z
git push origin vX.Y.Z
gh release create vX.Y.Z "release\pc-organizer-setup-X.Y.Z.exe" --title "PC 정리 도구 X.Y.Z" --notes-file docs/release-notes-X.Y.Z.md
gh release view vX.Y.Z --json assets,isDraft --jq '{draft: .isDraft, assets: [.assets[] | {name, size, state}]}'   # state 가 uploaded
```

- [ ] `latest.yml` · `.blockmap` · `builder-debug.yml` 은 올리지 않는다 (자동 업데이트가 없다).
- [ ] 태그를 잘못 찍었으면 릴리스를 만들기 **전에** 지운다(`git tag -d vX.Y.Z; git push origin :refs/tags/vX.Y.Z`). 릴리스가
      이미 만들어졌으면 지우지 말고 다음 패치 버전으로 다시 낸다 — 받아 간 사람이 있을 수 있다.

## 5. 올린 뒤

- [ ] `docs/release.md` 맨 위의 "올린 것" 줄과 `CLAUDE.md` "진행 상태" 의 최신 버전을 갱신해 커밋·푸시한다.
- [ ] `https://github.com/Jung-DaeHun/pc-organizer/releases/latest` 가 새 버전을 가리키는지 브라우저로 한 번 본다.

## 스크린샷 — 윈도우 사용자 이름을 가려서 찍는다

앱은 실제 경로를 그대로 보여주므로 스크린샷에 `C:\Users\<이름>\…` 이 찍힌다. 앱 코드에 가리는 기능은 두지 않고, 찍는 쪽에서
DOM 텍스트만 바꾼다. 프로젝트 의존성이 아니라 임시 폴더에서 돌린다:

```powershell
mkdir $env:TEMP\shot; cd $env:TEMP\shot; npm init -y; npm install playwright-core
```

```js
// screenshot.mjs — node screenshot.mjs (Claude Code 에서 돌리면 샌드박스를 꺼야 한다 — GUI 라 샌드박스 안에서는 spawn 이 실패한다)
import { _electron as electron } from 'playwright-core'
import { join } from 'node:path'

const PROJECT = 'C:/…/myProject'                       // 저장소 경로
const MASK = [['<윈도우 사용자 이름>', 'user']]         // 화면에 보이면 안 되는 문자열 → 대체 문자열. 이름을 영문 자판으로 친 폴더 이름 등도 여기에
const OUT = join(PROJECT, 'docs/screenshot.png')

const app = await electron.launch({
  executablePath: join(PROJECT, 'node_modules/electron/dist/electron.exe'),   // 설치본 스모크 테스트면 release/win-unpacked/PC 정리 도구.exe, args: []
  args: [PROJECT]                                                             // npm run build 로 만든 out/ 을 띄운다
})
try {
  const page = await app.firstWindow()
  await page.getByRole('button', { name: '스캔' }).waitFor({ timeout: 30_000 })
  await page.getByText('전체 목록').waitFor({ timeout: 60_000 })              // 설치된 앱 카드까지 읽힌 뒤
  await page.getByRole('button', { name: '스캔' }).click()
  await page.getByText('훑었습니다').waitFor({ timeout: 120_000 })
  await page.waitForTimeout(800)

  await page.evaluate((mask) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      for (const [from, to] of mask)
        if (node.nodeValue?.includes(from)) node.nodeValue = node.nodeValue.split(from).join(to)
  }, MASK)
  const leftover = await page.evaluate((mask) => mask.some(([from]) => document.body.innerText.includes(from)), MASK)
  if (leftover) throw new Error('화면에 가릴 문자열이 남아 있다')

  await page.screenshot({ path: OUT })
} finally {
  await app.close()
}
```

찍은 뒤 이미지를 직접 열어 확인한다 — 잘려서 안 보이던 폴더 이름이 대체 문자열이 짧아지면서 드러날 수 있다(0.1.0 때
`Desktop\e…` 가 `Desktop\eogns` 로 보였다). 창 크기는 `main/index.ts` 의 1280×860 그대로 둔다(README 의 이미지 폭과 맞는다).
