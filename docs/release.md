# 배포 절차

설치 파일을 만들어 GitHub Release 에 붙인다. 저장소는 공개(`Jung-DaeHun/pc-organizer`)이고 `gh` 로 로그인돼 있다.
2026-09-15 에 `v0.1.0` 을 올렸다(`https://github.com/Jung-DaeHun/pc-organizer/releases/tag/v0.1.0`, 첨부
`pc-organizer-setup-0.1.0.exe` 113 MB). 올리기 전에 `npm run package` 로 새로 만들고 `release\win-unpacked` 를 Playwright 로
띄워 스캔까지 되는지 봤다.

## 만들기

```powershell
npm run verify                       # 린트 → 타입 검사 → 테스트 → 빌드
npm run package                      # release\pc-organizer-setup-<버전>.exe (NSIS, 약 113 MB)
Get-AuthenticodeSignature release\pc-organizer-setup-0.1.0.exe   # NotSigned — 서명은 하지 않는다 (README "코드 서명")
```

설치 파일은 관리자 권한 없이 현재 사용자 폴더(`%LOCALAPPDATA%\Programs\pc-organizer`)에 설치되고, 시작 메뉴·바탕화면
바로가기와 레지스트리 Uninstall 항목("PC 정리 도구 <버전>")을 만든다. 설치본과 `npm run dev` 는 같은
`%APPDATA%\pc-organizer` 를 쓴다(설정·API 키·저널 공유). 설치된 앱은 2026-09-14 에 Playwright 스모크 테스트로 확인했다
(asar 경로·PowerShell 조회·safeStorage·스캔·ms-settings 열기·window.open 거부).

## 올리기 — GitHub Release

```powershell
# 1. 버전 태그 (package.json 의 version 과 맞춘다)
git tag v0.1.0
git push origin v0.1.0

# 2. 릴리스 만들면서 설치 파일 첨부 (GitHub 한도는 파일당 2 GB)
gh release create v0.1.0 "release\pc-organizer-setup-0.1.0.exe" --title "PC 정리 도구 0.1.0" --notes-file docs/release-notes-0.1.0.md
```

`https://github.com/Jung-DaeHun/pc-organizer/releases/latest` 에서 내려받는다. 다음 버전은 `package.json` 의 `version` 을
올리고 `npm run package` → 새 태그로 같은 절차 — 빠뜨리기 쉬운 것까지 체크리스트로 적은 것이 **`docs/nextversion.md`** 다.
`release/latest.yml`·`.blockmap` 은 electron-updater 용이라 올리지 않는다(앱에 자동 업데이트가 없다).

## 받는 사람이 겪는 것 — 릴리스 노트와 README 에 적는다

- **SmartScreen 경고** — 서명이 없어 "Windows 의 PC 보호" 창이 뜬다. "추가 정보 → 실행" 으로 넘어간다.
- **스마트 앱 컨트롤이 켜진 PC** (Windows 11 새 설치 기본) 에서는 우회 버튼 없이 **막힌다**. 서명 없이는 방법이 없으므로
  "이 경우 실행 불가" 라고 적는다.
- 브라우저 다운로드에도 "일반적으로 다운로드되지 않음" 경고가 붙을 수 있다.

## 올리기 전에 정한 것 (2026-09-15)

1. **라이선스** — MIT (`LICENSE`, `package.json` 의 `license`). 파일 이름이 `LICENSE`(확장자 없음)라 electron-builder 의
   NSIS 라이선스 페이지(`license.txt` 등을 찾는다)에는 걸리지 않는다 — 설치 화면은 그대로다.
2. **릴리스 노트** — `docs/release-notes-<버전>.md`. 무엇을 하는 앱인지, 영구 삭제 없음, AI 기능은 API 키 선택 사항, 위
   SmartScreen 안내. README 에도 "설치" 절로 같은 안내를 두었다(릴리스 페이지에서 README 가 첫 화면이다).
3. `docs/screenshot.png` — 2026-09-15 에 다시 찍었다. 경로의 윈도우 사용자 이름은 화면에 두지 않는다 — Playwright 로
   빌드된 `out/` 을 띄워 스캔한 뒤, 찍기 직전에 DOM 텍스트 노드의 사용자 이름(과 그 이름을 영문 자판으로 친 폴더 이름)을
   `user`·`work` 로 바꾸고 `page.screenshot` 한다. 앱 코드에는 가리는 기능이 없다(앱은 실제 경로를 그대로 보여준다).

릴리스는 공개 저장소에 올라가는 외부 공개 동작이라, 사용자가 "진행해" 라고 한 뒤에만 올린다.
