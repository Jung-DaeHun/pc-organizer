# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Windows 전용 Electron 데스크톱 앱. 사용자의 실제 파일을 스캔한다. 여기서의 버그는 화면이 깨지는
정도로 끝나지 않고 **파일이 사라지거나 수 GB가 네트워크로 새는** 결과가 된다. 아래 불변 조건이
일반적인 코드 품질보다 먼저다. 문서·주석·커밋 메시지는 한국어로 쓴다.

## 명령어

```bash
npm run dev                              # Electron 앱을 개발 모드로 실행
npm run verify                           # 린트 → 타입 검사 → 테스트 → 빌드 (커밋 전 검사와 동일)
npm run lint                             # ESLint (아키텍처 규칙이 여기 들어있다)
npm run typecheck                        # tsc --noEmit
npm test                                 # Vitest 1회 실행
npm run build                            # typecheck + electron-vite build
npm run package                          # 설치 파일 생성 (release/pc-organizer-setup-<버전>.exe, NSIS)
npm run package:dir                      # 설치 파일 없이 압축 안 한 폴더만 (release/win-unpacked/ — 스모크 테스트용)
                                         # 코드 서명은 WIN_CSC_LINK(pfx) + CSC_KEY_PASSWORD 환경 변수가 있을 때만 (README)
                                         # 인증서 파일은 저장소에 넣지 않는다 (.gitignore *.pfx *.p12 *.key)

npx vitest run tests/scanner.test.ts     # 파일 하나만
npx vitest run -t "클라우드 전용"          # 이름으로 고르기
npx vitest                               # watch 모드
```

## 불변 조건 — 어기면 안 되는 것

### 1. 사용자 파일을 건드리는 건 `executor.ts`뿐이다 — `rename`으로 옮기거나 `trashItem`으로 휴지통에 보낼 뿐, 영구 삭제는 없다

스캔·정리 계획·AI 추천은 전부 조회다. 사용자 파일에 쓰는 코드는 **`services/executor.ts` 한 곳**이고,
하는 일은 폴더 만들기(`mkdir`)·옮기기(`rename`)·실행취소가 **자기가 만든 빈 폴더**를 치우기(`rmdir`)·
중복 후보의 나머지 사본을 **윈도우 휴지통**으로 보내기(`trashItem`) 넷뿐이다. `unlink`·`rm`·`copyFile`·
`writeFile`(사용자 경로)은 어디에도 없다 — 옮긴 것은 같은 `rename`을 거꾸로 해 되돌리고, 휴지통에 보낸
것은 사용자가 윈도우 휴지통에서 복원한다(앱이 휴지통에서 꺼내는 코드는 없다).

`rmdir`은 **비재귀**로만 부른다(`rmdir(path)`, 옵션 없음). 안에 무엇이든 있으면 `ENOTEMPTY`로 실패해
그대로 두므로 사용자 파일이 지워질 경로가 없다. 대상은 저널의 `createdFolders`(실행이 직접 만든 이름)
뿐이고, 기존 폴더를 목적지로 썼으면 기록에 없어 건드리지 않는다. `recursive`를 붙이는 순간 이 보장이
깨진다 — 절대 붙이지 않는다.

- `executor.ts`는 fs 를 import 하지 않는다. `ExecutorIo = { lstat, mkdir, rename, rmdir, trashItem }`를
  주입받고, 실체는 **`ipc/handlers.ts`가 `node:fs/promises`와 `shell.trashItem`으로 만드는 객체 하나**다.
  가짜 io 로 전부 테스트된다.
- 실행은 renderer 사본이 아니라 main 의 `lastPlan`과 대조한다(`resolveMoves`). 요청에는 경로가 없고
  id 와 폴더 이름만 있다. 하나라도 어긋나면 전체 거부.
- 옮기기 전에 읽기 전용 사전 점검(`preflight`)을 돌려 **하나라도 걸리면 아무것도 옮기지 않는다**
  (`blocked`). 이름을 바꾸지 않고(`join(root, toFolder, item.name)`), 덮어쓰지 않으며(목적지에 같은
  이름이 있으면 실패), 복사하지 않고(`EXDEV`면 실패), 정션·링크인 목적지로는 옮기지 않는다.
- 실행 기록은 `services/journal.ts`가 `userData/journal.json`에 임시 파일 + `rename`으로 원자적으로
  남긴다. 기록을 남길 수 없으면 실행하지 않는다. 실행·실행취소 뒤에는 `markStale()`로 스캔 목록을
  버려 다시 스캔하기 전까지 계획을 세울 수 없다.

**휴지통(B3)은 규칙에서만 나오고 AI 는 관여하지 않는다.** 대상은 스캔이 찾은 중복 후보 그룹(크기 + 앞 4KB)
뿐이고, `TrashItem`은 `PlanItem`과 다른 타입이다. 요청(`TrashRequest`)은 그룹마다 **남길 파일 id** 하나 —
나머지가 대상이 되므로 그룹을 통째로 지우는 요청은 모양 자체가 없다. `dedupe.ts`의 `executeTrashApproved`가
조율한다: `lastTrashPlan`과 대조(`resolveTrash`, 하나라도 어긋나면 전체 거부) → 읽기 전용 사전 점검
(`preflightTrash` — 볼륨의 휴지통 설정을 본 뒤 그룹의 **모든** 파일을 `lstat` 하고 `hashFull`로 **전체
해시**를 비교, 하나라도 걸리면 `blocked`로 아무것도 보내지 않음) → 저널에 `kind: 'trash'` 빈 기록 → 파일마다
**남길 파일이 아직 있는지 다시 본 뒤** `trashItem`. 끝나면 `markStale()`. 저널의 `kind`가 없는 기록은
이동이다(옛 파일 호환).

**`shell.trashItem`은 영구 삭제를 막아 주지 않는다.** 윈도우 쉘은 볼륨의 휴지통 최대 크기(레지스트리
`HKCU\…\Explorer\BitBucket\Volume\{GUID}\MaxCapacity`, MiB)보다 큰 파일을 "너무 커서 휴지통에 넣을 수 없음"
으로 묻지 않고 **오류 없이 영구 삭제**하고(2026-09-13 실측, Electron 44 — `FOF_NO_UI`가 확인을 자동으로
'예'로 답한다), '휴지통을 쓰지 않음'(`NukeOnDelete`·`NoRecycleFiles` 정책)이면 전부 영구 삭제다. 휴지통이
없는 볼륨(네트워크·subst)만 거부된다. **개별로는 한도 미만이어도 휴지통에 든 것과의 합계가 한도를 넘으면**
넣을 때는 전부 성공하고 직후에는 휴지통에 있지만, 잠시 뒤 탐색기가 **오래된 것부터 한도 아래로 들어갈 때까지
묻지 않고 영구 삭제**한다(같은 날 실측 — 30 GiB 4개 중 가장 나중 것 하나만 남았다). 앱이 "보냈습니다"라고
보고한 뒤에 사라지므로 넣은 직후 확인해도 잡히지 않는다.

그래서 `lib/recycleBin.ts`가 설정을 **조회만** 하고(`RecycleBinLookup`, `handlers.ts`가 주입 — 한도는 PowerShell,
현재 사용량은 `<root>$Recycle.Bin\<SID>`의 `$R` 항목을 `readdir`·`lstat`으로 더한다. 고아 `$I`는 세지 않고,
링크·정션은 따라가지 않으며, Shell COM 열거는 밀어내기를 트리거할 수 있어 쓰지 않는다), `preflightTrash`가
파일을 읽기 전에 가장 먼저 본다 — 파일 하나가 한도 **이상**(`exceeds-recycle-bin`), 사용량 + 보낼 합계가 한도
이상(`recycle-bin-full`, 그 볼륨의 대상 전부 — 어느 것이 밀려날지 앱이 정할 수 없다), 휴지통 안 씀
(`recycle-bin-off`), 설정이나 사용량을 모름(드라이브 문자 없는 경로·조회 실패·읽기 실패, `recycle-bin-unknown`)
이면 `blocked`. 전체 해시가 끝난 뒤 보내기 직전에 **같은 검사를 한 번 더** 한다 — 해시하는 몇 분 사이에 사용자가
탐색기에서 지운 것으로 휴지통이 찼으면, 낡은 사용량으로 보낼 때 밀려나는 건 사용자가 먼저 지운 그 파일이다.
볼륨 키는 `pathKey`로 접는다(`C:\`와 `c:\`가 갈리면 합계가 쪼개진다). `trashItem`을 이 검사 없이 부르는 경로를
만들지 않는다.

휴지통은 **볼륨마다** 따로라, 드라이브 문자 없이 폴더에 마운트된 볼륨(`C:\Data`에 붙은 별도 디스크)의 파일은 경로가
`C:\…`여도 `C:\`의 한도·사용량이 맞지 않는다. 같은 조회가 `Win32_MountPoint`의 마운트 폴더 목록을 함께 읽어
`RecycleBinPolicy.mountPoints`로 넘기고, `checkRecycleBin`이 `mountPointOf`로 그 아래 파일을 `recycle-bin-unknown`으로
막는다(그 볼륨의 휴지통은 조회하지 않는다 — 모른다). 목록을 못 읽으면 그 루트 전체가 모른다.

`userData` 아래 쓰기는 `store.ts`(`settings.json`·`secrets.json`)와 `journal.ts`(`journal.json`)만.
레지스트리는 조회만 한다(`Set-ItemProperty` / `Remove-Item` / `New-Item` 금지). 프로그램 제거도 앱이 하지
않는다 — 레지스트리의 `UninstallString`을 실행하면 임의 프로그램을 돌리는 것이고 그것이 무엇을 지울지 앱이 알 수
없다. 제거 안내는 윈도우 설정을 열어 주는 것까지다(`shell.openExternal`에 넘기는 값은 `services/apps.ts`의 상수
`WINDOWS_APPS_SETTINGS_URI` 하나, renderer 인자 없음). `openExternal`·`openPath`에 renderer 에서 온 값을 넘기는
경로를 만들지 않는다. 유일한 예외는 `main/index.ts`의 `setWindowOpenHandler`(새 창 요청을 기본 브라우저로)인데,
거기 오는 url 은 renderer 의 값이라 `lib/webUrl.ts`의 `isWebUrl`로 `http:`/`https:`만 통과시킨다 — `file:`·
`ms-settings:` 같은 스킴은 renderer 의 값으로 열지 않는다.

`ExecutorIo`에 메서드를 추가하거나 `executor.ts` 밖에서 쓰기 호출을 부르고 싶으면 먼저 확인을 받는다.
영구 삭제(`unlink`·`rm`·휴지통 비우기)는 앞으로도 넣지 않는다.

### 2. 클라우드 전용 파일의 내용을 읽지 않는다

바탕화면이 OneDrive 아래에 있다. 클라우드에만 있는 파일은 **내용을 읽는 순간** 자동 다운로드가
시작되어 스캔 한 번에 수 GB가 샌다. 메타데이터(`lstat`)만 읽는 건 안전하다.

`lib/cloudOnly.ts`의 `isCloudOnly()`가 `크기 > 1KB인데 할당 블록이 0`인 파일을 그렇게 판정하고,
`groupDuplicates`는 후보 필터에서 `!e.isCloudOnly`로 걸러낸다. 1KB 하한이 있는 이유는 NTFS가
아주 작은 파일을 MFT 안에 넣어버려(resident file) 똑같이 블록 0으로 잡히기 때문이다.

파일 내용을 읽는 코드(`hashHead`, `open`, `readFile`, `createReadStream`)를 새로 부를 때는
반드시 그 앞에 `isCloudOnly` 필터가 있어야 한다. 스캔 때의 `FileEntry.isCloudOnly`는 스캔 뒤
OneDrive가 파일을 내려놓으면 낡는다 — 전체를 읽는 `hashFull`은 **열기 직전에 `lstat`으로 다시
판정**하고 클라우드 전용이면 열지 않는다(`tests/hash.test.ts`가 못 박는다).

### 3. 심볼릭 링크와 정션을 따라가지 않는다

자기 조상을 가리키는 정션 하나면 스캐너가 영원히 돈다. `scanner.ts`는 디렉터리로 내려가기 **전에**
`dirent.isSymbolicLink()`로 걸러내고, 재귀 대신 명시적 스택을 쓴다(깊은 트리에서 콜 스택이 넘치지
않게). 디렉터리 열기 실패와 파일 stat 실패는 각각 잡아 `skippedCount`만 올리고 계속 돈다.

### 4. 용량 수치를 부풀리지 않는다

사용자가 판단 근거로 삼는 숫자다. `opportunities.ts`가 두 값을 나눠 내놓는다.

- `reclaimableBytes` (**바로 확보**) = 중복 후보 + 임시파일·휴지통. 사람 판단이 필요 없는 것만.
- `reviewBytes` (**검토 대상**) = 대용량 ∪ 오래된 파일. `unionBytes()`로 **합집합**을 쓴다.

겹칠 수 있는 묶음의 용량을 그냥 더하면 '100MB 넘으면서 1년 넘게 안 쓴' 파일이 두 번 세어진다.
크다는 이유만으로 지워도 되는 파일이 아니므로 대용량·오래된 파일은 '바로 확보'에 넣지 않는다.

중복은 크기로 묶고 **앞 4KB만** 비교한 결과라 확정이 아니다. UI 문구는 '중복'이 아니라
**'중복 후보'**여야 한다. 개수·용량은 '지울 수 있는 양'이다(같은 파일 3개면 2개분).

### 5. 윈도우의 `atime`은 믿을 수 없다

최근 윈도우는 접근 시각 갱신이 기본으로 꺼져 있어 `atime`이 생성 시점에 멈춰 있다. 그대로 쓰면
지금도 쓰는 파일이 '오래된 파일'로 몰린다. 시간 비교는 반드시 `lastTouchedMs()`
(= `max(atimeMs, mtimeMs)`)를 거친다.

### 6. renderer는 Node에 닿을 수 없다

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`를 유지한다. preload는
`ipcRenderer`를 **통째로 노출하지 않는다** — 채널마다 감싼 함수만 내보내야 UI 코드가 임의 채널을
부를 수 없다. renderer에서 `node:*`나 `electron`을 import 해야 할 것 같으면, 그 코드는 main으로
가야 한다는 신호다.

창은 우리 페이지 밖으로 이동하지 않는다. 탐색기에서 파일을 창에 떨어뜨리면 Chromium이 그
파일(`file://`)로 이동하는데, preload가 붙은 채 임의 로컬 HTML이 열리면 `window.api`에 닿는다.
`renderer/src/main.tsx`가 `dragover`/`drop`의 기본 동작을 막고(첫 번째 벽), `main/index.ts`의
`will-navigate`가 현재 URL 밖 이동을 막는다(두 번째 벽).

### 7. AI에게는 메타데이터만 간다

AI 추천은 이 앱에서 네트워크로 나가는 유일한 경로다. 보내는 것은 항목의
`name · kind · ext · size · mtime(날짜까지) · category · fileCount`뿐이고, 절대 경로·사용자 이름·파일
내용은 나가지 않는다. 페이로드는 `services/advisor.ts`의 `buildAdvisorRequest` / `toAdvisorItem` 한
곳에서만 만들고 필드를 하나씩 옮겨 적는다(`...item` 펼치기 금지 — 나중에 필드가 늘면 조용히 따라
나간다). `tests/advisor.test.ts`가 허용 필드 목록과 "절대 경로·사용자 이름 부재"를 못 박는다.

`@anthropic-ai/sdk`는 `src/main/lib/anthropic.ts`에서만 import 한다(ESLint `SDK_IMPORT_PATTERN`).
서비스는 `StructuredCall`(`lib/structured.ts`)을 주입받아 네트워크를 모른 채 테스트된다.

### 8. 네트워크 호출은 사용자가 누른 뒤, 보낼 내용을 보여준 다음에만

`previewAdvice`(요약, 네트워크 없음)를 화면에 띄우고 사용자가 '보내기'를 눌러야 `advisePlan`이
돈다. 스캔이나 계획 세우기가 AI를 자동으로 부르는 경로를 만들지 않는다.

### 9. AI는 이동·분류만 제안한다

응답 스키마 `ADVICE_SCHEMA`(`z.strictObject`)에는 `folders` / `assignments` / `leave`만 있다.
삭제·휴지통은 AI가 제안할 수 없고, 앞으로도 스키마에 넣지 않는다. 응답은 `validateAdvice`가
의심하며 검증한다 — 모르는 id, 쓸 수 없는 폴더 이름, 모르는 폴더, 자기 자신으로의 이동은 버린다.

### 10. API 키는 IPC 응답에 절대 실리지 않는다

키는 `safeStorage`(DPAPI)로 암호화해 `userData/secrets.json`에 둔다. renderer가 아는 건
`setApiKey` / `hasApiKey` / `clearApiKey`뿐이고, 복호화하는 `getApiKey`는 `ipc/handlers.ts`가
클라이언트를 만들 때만 부른다. 키·페이로드·응답을 로그에 남기지 않는다.

## 아키텍처

층 구조·서비스 목록·흐름(스캔 → 정리 계획 → 실행 → 실행취소 → 중복 후보 → 휴지통)·IPC 채널 추가 절차(네 곳)·
저널·PowerShell·윈도우 경로·경로 별칭은 **`architecture.md`**에 있다. 서비스나 채널을 추가하거나 흐름을 바꾸기
전에 읽고, 바꾼 뒤에는 그 문서도 같이 고친다.

## ESLint가 강제하는 것

`eslint.config.mjs`는 스타일이 아니라 아키텍처를 지킨다. 아래가 걸리면 코드를 잘못된 층에 둔 것이다.

- renderer에서 `node:*` / `electron` import → 에러
- `src/main/services/**`에서 `electron` import → 에러 (`store.ts` 제외)
- main/preload/shared에서 `window` / `document` 전역 사용 → 에러
- `any` → 에러

## 커밋 전 검사

`.claude/settings.json`의 PreToolUse 훅(`.claude/hooks/pre-commit-verify.mjs`)이 Bash로 도는
`git commit`을 가로채 린트 → 타입 검사 → 테스트 → 빌드를 돌리고, 하나라도 실패하면 커밋을 막는다.
약 5초. git 자체의 pre-commit 훅이 아니라 Claude Code 훅이라, 사용자가 터미널에서 직접 치는
git에는 걸리지 않는다.

## 리뷰

코드를 고친 뒤·커밋 전·2단계로 넘어가기 전에는 `code-reviewer` 에이전트를 쓴다. 절차는
`.claude/skills/review/SKILL.md`에 있고, 위 불변 조건을 grep 명령으로 하나씩 확인한다.
리뷰어는 **읽고 확인만 하며 고치지 않는다.** 재현 시나리오를 못 쓰는 지적은 결함이 아니라 의심으로
따로 묶는다.

## 테스트 관례

`environment: 'node'`, 대상은 `tests/**/*.test.ts`뿐이다(renderer 컴포넌트 테스트는 없다).

`tests/scanner.test.ts`는 픽스처를 `describe` 밖 최상위 `await`로 만든다. `it.skipIf`는 테스트를
**수집하는 시점**에 조건을 읽는데 `beforeAll`은 그보다 나중에 돌기 때문에, 정션 생성 여부를
`beforeAll`에서 정하면 조건이 항상 초기값으로 읽혀 테스트가 조용히 건너뛰어진다. 스킵된 테스트가
보이면 의도된 것인지 확인한다.

## 차트 색과 테마

테마는 `<html>`의 `.dark` 클래스 하나로 갈린다 — `Settings.theme`(`'dark' | 'light'`, 기본 `dark`)을 `App`이
`lib/theme.ts`로 적용한다. 색을 하드코딩하지 말고 `index.css`의 변수(`bg-background`, `text-muted-foreground` …)를
쓴다. 두 테마에서 다 보이는지 확인한다.

`--chart-*` 7색(+ 무채색 '기타')은 `src/renderer/src/index.css`의 `:root`(밝은 배경)와
`.dark`(어두운 카드 배경)에 각각 정의돼 있다. 밝기만 뒤집은 값이 아니라 각 배경에서 명도대·채도·
색각이상 분리도·정상시야 분리도·배경 대비 검사를 통과한 조합이다. **눈대중으로 바꾸지 않는다.**

색은 정렬 순위가 아니라 **카테고리에 고정**으로 붙는다(`CategoryChart.tsx`의 `CATEGORY_COLOR`).
정렬이 바뀌어도 '이미지'는 늘 같은 색이어야 한다. 누적 띠의 순서도 데이터가 아니라 고정 카테고리
순서다. 띠 아래 목록이 범례이자 표 역할을 해, 색만으로 정보를 전달하는 구간이 없어야 한다.

## 진행 상태와 다음 단계

이동·실행취소(B1·B2)와 중복 후보 → 휴지통(B3, 4/4까지)은 구현됐다 — 불변 조건 1이 현재 모습이다.
휴지통 실행취소는 안내만 한다("윈도우 휴지통에서 복원"). 앱이 휴지통에서 꺼내는 코드는 없고 앞으로도
넣지 않는다.

설정 화면(테마 · 분류 규칙 · 판정 기준)도 구현됐다(2026-09-13). 규칙은 `Settings.rules`로 `settings.json`에 가고
새 IPC 채널은 없다 — 구조는 `architecture.md`의 "설정 화면"에 있다. 카테고리는 일곱 개 고정이라 사용자가 새
카테고리를 만드는 건 안 된다(차트 색·집계가 카테고리에 묶여 있다). 기본표에서 `ts`는 코드(TypeScript)에만 있다
— 영상(MPEG-TS)에도 넣으면 한 확장자가 두 카테고리에 걸린다(`tests/rules.test.ts`가 겹침 없음을 못 박는다).

B3의 2026-09-13 리뷰 의심 중 배치 합계는 같은 날 실측으로 확인해 `recycle-bin-full`로 막았고, 드라이브 문자 없는
볼륨 마운트 포인트는 `Win32_MountPoint` 목록으로 `recycle-bin-unknown` 처리했다.

**OneDrive placeholder 실측은 하지 않기로 했다**(2026-09-13 결정 — 개발 PC에 OneDrive가 없다). 미확인으로 남는 것:
윈도우의 `readdir(withFileTypes)`는 모든 reparse point를 `isSymbolicLink()`로 보고한다(정션은 확인). 클라우드 전용
placeholder도 reparse point면 `scanner.ts`는 그 파일을 건너뛰어 집계에서 빠지고(읽지 않으니 안전한 쪽), 휴지통 속
`$R` placeholder는 `measureRecycleBinUsage`가 0으로 세어 사용량이 **과소계산**될 수 있다(그만큼 `recycle-bin-full`
검사가 느슨해진다). 언젠가 막아야 한다면 실측 없이도 갈 길은 있다 — libuv 의 `lstat`은 심볼릭 링크·정션이 아닌
reparse point를 일반 파일로 보고하므로, dirent 가 링크라 해도 `lstat`으로 다시 보면 구분된다. 지금은 그대로 둔다.

설치된 앱 제거 안내도 구현됐다(2026-09-13, `AppsPage` — 구조는 `architecture.md`의 "설치된 앱"). 조회와 안내뿐이다:
레지스트리에서 읽은 목록을 검색·정렬로 보여주고 `ms-settings:appsfeatures`를 열어 준다. 어떤 앱을 지우라고 고르지
않고, `UninstallString`은 실행하지 않으며, Microsoft Store 앱(`Get-AppxPackage`)은 목록에 없다.

**시작 프로그램 켜고 끄기는 이 프로젝트에서 뺐다**(2026-09-13 결정). `Run` 키·`StartupApproved` 쓰기가 필요해
"레지스트리는 조회만"과 부딪히고, 안내만 하는 형태도 만들지 않는다. 시작 프로그램은 지금처럼 **개수만** 센다
(`apps.ts`의 `PS_STARTUP_ITEMS`, 대시보드 카드·설치된 앱 화면의 요약 줄). 다시 넣자는 제안이 나오면 이 결정을
먼저 확인한다.

기능 범위는 여기까지다. 남은 할 일은 없다 — 위 두 결정(시작 프로그램 · placeholder 실측)을 뒤집으려면 먼저 확인한다.

패키징은 됐다(2026-09-14 — 아이콘 `build/icon.ico`, NSIS 설치 파일, 설치본 스모크 테스트까지). 코드 서명은 하지 않는다.
**0.1.0 을 GitHub Release 로 올렸다**(2026-09-15, 태그 `v0.1.0`, MIT 라이선스). 절차와 다음 버전 올리는 법은
`docs/release.md`, 릴리스 노트는 `docs/release-notes-<버전>.md`. GitHub Release 는 공개 동작이라 사용자가 진행하라고 한
뒤에만 올린다. `docs/screenshot.png` 는 윈도우 사용자 이름을 가려 찍는다(방법은 `docs/release.md`).
