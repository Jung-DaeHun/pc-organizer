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
npm run package                          # 설치 파일 생성 (release/)

npx vitest run tests/scanner.test.ts     # 파일 하나만
npx vitest run -t "클라우드 전용"          # 이름으로 고르기
npx vitest                               # watch 모드
```

## 불변 조건 — 어기면 안 되는 것

### 1. 사용자 파일을 움직이는 건 `executor.ts`의 `rename`뿐이다. 사용자 파일을 지우는 코드는 한 줄도 없다

스캔·정리 계획·AI 추천은 전부 조회다. 사용자 파일에 쓰는 코드는 **`services/executor.ts` 한 곳**이고,
하는 일은 폴더 만들기(`mkdir`)·옮기기(`rename`)·실행취소가 **자기가 만든 빈 폴더**를 치우기(`rmdir`)
셋뿐이다. `unlink`·`rm`·`copyFile`·`writeFile`(사용자 경로)·`trashItem`은 어디에도 없다 — 옮긴 것은
같은 `rename`을 거꾸로 해 되돌린다.

`rmdir`은 **비재귀**로만 부른다(`rmdir(path)`, 옵션 없음). 안에 무엇이든 있으면 `ENOTEMPTY`로 실패해
그대로 두므로 사용자 파일이 지워질 경로가 없다. 대상은 저널의 `createdFolders`(실행이 직접 만든 이름)
뿐이고, 기존 폴더를 목적지로 썼으면 기록에 없어 건드리지 않는다. `recursive`를 붙이는 순간 이 보장이
깨진다 — 절대 붙이지 않는다.

- `executor.ts`는 fs 를 import 하지 않는다. `ExecutorIo = { lstat, mkdir, rename, rmdir }`를 주입받고,
  실체는 **`ipc/handlers.ts`가 `node:fs/promises`로 만드는 객체 하나**다. 가짜 io 로 전부 테스트된다.
- 실행은 renderer 사본이 아니라 main 의 `lastPlan`과 대조한다(`resolveMoves`). 요청에는 경로가 없고
  id 와 폴더 이름만 있다. 하나라도 어긋나면 전체 거부.
- 옮기기 전에 읽기 전용 사전 점검(`preflight`)을 돌려 **하나라도 걸리면 아무것도 옮기지 않는다**
  (`blocked`). 이름을 바꾸지 않고(`join(root, toFolder, item.name)`), 덮어쓰지 않으며(목적지에 같은
  이름이 있으면 실패), 복사하지 않고(`EXDEV`면 실패), 정션·링크인 목적지로는 옮기지 않는다.
- 실행 기록은 `services/journal.ts`가 `userData/journal.json`에 임시 파일 + `rename`으로 원자적으로
  남긴다. 기록을 남길 수 없으면 실행하지 않는다. 실행·실행취소 뒤에는 `markStale()`로 스캔 목록을
  버려 다시 스캔하기 전까지 계획을 세울 수 없다.

`userData` 아래 쓰기는 `store.ts`(`settings.json`·`secrets.json`)와 `journal.ts`(`journal.json`)만.
레지스트리는 조회만 한다(`Set-ItemProperty` / `Remove-Item` / `New-Item` 금지).

`ExecutorIo`에 메서드를 추가하거나 `executor.ts` 밖에서 쓰기 호출을 부르고 싶으면 먼저 확인을 받는다.
휴지통(`trashItem`)은 B3(중복 후보) 작업이고 아직 없다.

### 2. 클라우드 전용 파일의 내용을 읽지 않는다

바탕화면이 OneDrive 아래에 있다. 클라우드에만 있는 파일은 **내용을 읽는 순간** 자동 다운로드가
시작되어 스캔 한 번에 수 GB가 샌다. 메타데이터(`lstat`)만 읽는 건 안전하다.

`scanner.ts`의 `isCloudOnly()`가 `크기 > 1KB인데 할당 블록이 0`인 파일을 그렇게 판정하고,
`findDuplicates`는 후보 필터에서 `!e.isCloudOnly`로 걸러낸다. 1KB 하한이 있는 이유는 NTFS가
아주 작은 파일을 MFT 안에 넣어버려(resident file) 똑같이 블록 0으로 잡히기 때문이다.

파일 내용을 읽는 코드(`hashHead`, `open`, `readFile`, `createReadStream`)를 새로 부를 때는
반드시 그 앞에 `isCloudOnly` 필터가 있어야 한다.

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

```
src/shared/     main·renderer 공용 계약 (types / channels / api). IPC를 넘는 값은 순수 데이터
src/main/       파일시스템·레지스트리·네트워크를 만지는 유일한 곳
  ipc/          채널 등록만. 로직 없음 (API 키로 StructuredCall, node:fs 로 ExecutorIo 를 만들어 주입하는 것까지)
  services/     scan(조율) · scanner(순회) · opportunities · summarize · categorize · temp · apps · drives · store
                plan(조율, lastPlan, executeApproved) · topLevel(루트 한 단계) · planner(규칙) · advisor(AI 요청·검증·병합)
                executor(이동·되돌리기, io 주입) · journal(실행 기록, userData) · undo(조율)
                activity(스캔·실행·실행취소 자물쇠 — 한 번에 하나만)
  lib/          powershell · hash · paths · structured(계약) · anthropic(SDK, 유일한 네트워크)
src/preload/    contextBridge 다리
src/renderer/   React UI. Node 권한 없음. App 이 view 상태로 Dashboard / PlanPage 를 고른다
```

**IPC 채널을 하나 추가하려면 네 곳을 같이 고쳐야 한다.** 하나라도 빠지면 런타임에야 드러난다.

1. `src/shared/channels.ts` — 채널 이름
2. `src/shared/api.ts` — `RendererApi` 인터페이스
3. `src/main/ipc/handlers.ts` — `ipcMain.handle` 등록
4. `src/preload/index.ts` — 감싼 함수 노출

**스캔 파이프라인** — `services/scan.ts`가 조율한다. `scanFolders`로 파일 목록을 만들고,
`findDuplicates`(해시)와 `measureTempAndTrash`를 병렬로 돌린 뒤 집계한다.

원본 `FileEntry[]`는 `scan.ts`의 모듈 변수 `lastEntries`에 **main 쪽에만** 남는다
(`getLastEntries()`로 꺼낸다). renderer로는 집계 수치만 보낸다 — 파일 수만 개를 IPC로 넘기면
직렬화 비용만으로 화면이 눈에 띄게 버벅인다. 목록과 `lastScannedAt`은 스캔이 **끝났을 때** 함께
바뀐다.

**스캔·실행·실행취소는 한 번에 하나만 돈다** — `services/activity.ts`의 자물쇠 하나를 셋이 같이
잡는다(`beginActivity`, `finally`에서 놓는다). 스캔 도중 파일이 움직이면, 실행취소가 `markStale()`로
목록을 비워도 스캔이 끝나며 옮기기 전 위치로 잡힌 목록으로 `lastEntries`를 덮어써 그 뒤의 계획이 없는
파일을 가리킨다. 계획 세우기는 잠그지 않되 `assertIdle`로 아무 작업도 없을 때만 응한다. 세 작업이
서로의 플래그를 보게 하지 않는다 — 검사가 여섯 곳으로 흩어져 하나만 빠져도 조용히 깨진다.

**정리 계획** — `services/plan.ts`가 조율하고 마지막 계획을 `lastPlan`에 main 쪽에만 둔다.
`buildPlan(root, scannedAt)`은 renderer가 보고 있는 `ScanResult.scannedAt`과 main의 목록이 같은
스캔인지 확인한 뒤에만 응한다. 대상은 감시 폴더 **바로 아래**의 파일과 폴더(통째로)뿐이다
(`topLevel.ts` — 루트 한 단계만 `readdir`, 폴더 용량은 `lastEntries`를 경로 접두로 집계).
`planner.ts`가 확장자 규칙으로 초안을 만들고 `advisor.ts`가 그 위에 AI 추천을 얹는다.
`OrganizePlan`은 유한한 목록이라 renderer로 넘기지만, 실행은 renderer가 돌려보낸 `{id, toFolder}`를
`lastPlan`과 대조한 뒤에만 한다. 클라우드 전용 파일·링크·`desktop.ini`는 계획에서 뺀다(`skipped`에 이유
코드와 함께). 바로가기(`.lnk`·`.url`)는 정리 대상이다 — 어디로 옮겨도 그대로 열린다.

**실행** — `plan.ts`의 `executeApproved(requests, {io, journalPath, onProgress})`가 조율한다.
`executor.ts`의 `resolveMoves`(계획 대조) → `preflight`(읽기 전용 점검, 하나라도 걸리면 `blocked`) →
저널에 빈 기록 저장 → `executeMoves`(항목마다 `mkdir`+`rename`, 실패해도 계속, 결과마다 저널 갱신).
끝나면 `lastPlan = null`, `markStale()`. 실행취소는 `undo.ts`가 저널에서 기록을 찾아 `undoMoves`로
ok 였던 이동을 역순으로 되돌린 뒤 `createdFolders` 중 빈 것을 `rmdir`(비재귀)로 치우고 `undoneAt`을
찍는다(한 번만). 비어 있지 않은 폴더는 `keptFolders`로 돌려주고 남긴다 — 저널에도 같이 적는다.
화면은 `createdFolders - removedFolders`로 계산하지 않는다(사용자가 이미 지운 폴더는 어느 쪽도 아니다).
저널은 디스크의 JSON이라 읽을 때 원소 모양까지 검사하고(`journal.ts` `isEntry`), `undoMoves`는
기록의 경로가 `root\name → root\폴더\name` 꼴인지 다시 본 뒤에만 `rename`한다.

저널의 `saveEntry`는 **저장하려는 항목을 무조건 남기고** 나머지만 `JOURNAL_LIMIT`에 맞춰 자른다.
시각으로 정렬한 뒤 자르면 시계가 뒤로 간 뒤에 방금 실행한 기록이 잘려 "기록 없는 실행"이 된다.
옮긴 뒤 마지막 저장이 실패하면 `ExecuteOutcome.journalError`로 화면에 알린다(저널이 뒤처져 실행취소가
마지막 항목을 놓칠 수 있다).
renderer 는 `usePlan.execute` → `ExecuteDialog`(확인 → 진행 → 결과) → `scan.invalidate()` 순서로
움직이고, 대시보드의 `RecentRunCard`가 저널을 보여주며 실행취소 버튼을 준다.

**계획은 목적지를 폴더 이름으로만 말한다.** `PlanItem.toFolder`는 root 바로 아래 폴더의 이름이고
경로가 아니다. renderer는 경로를 한 번도 조립하지 않으며, 실제 경로는 실행 단계에서 main이
`join(root, toFolder, item.name)`으로 만든다. 폴더 이름 규칙(`sanitizeFolderName`, `folderKey`)은
`src/shared/folderName.ts` 한 곳에 있어 AI 응답 검증과 사용자가 직접 만든 폴더가 같은 검사를 받는다.

**계획 화면은 칸반 보드다.** 폴더 = 열, 항목 = 카드. 카드가 있는 열이 곧 결정이라 승인 체크박스는
없다(`그대로 두기` 열 = 옮기지 않음). 판 편집 규칙은 `renderer/src/lib/planEdit.ts`의 순수 함수에
모여 있고 `tests/planEdit.test.ts`가 검증한다. 드래그는 네이티브 HTML5 DnD(의존성 없음).
판도 main과 같은 규칙을 지킨다 — **목적지로 쓰이는 폴더는 옮기지 않는다.** 열과 같은 이름의 폴더
카드는 그 열 자체라 옮길 수 없고(`isDestinationDir`, 카드에 '정리 폴더' 배지), 이미 다른 열로 보낸
폴더 카드의 이름으로는 열을 만들 수 없다. 열 이름은 `skipped`에 간 이름과도 대조한다(폴더면
'기존 폴더', 파일·링크면 거부 — 실행 단계의 `mkdir`이 `EEXIST`로 터지지 않게).

**서비스는 `electron`을 import 하지 않는다.** 그래야 Vitest에서 그대로 돌고 나중에
`worker_threads`로 옮길 수 있다. `store.ts`만 예외다(`app.getPath`). 앱 경로 같은 값은 import가
아니라 인자로 받는다. I/O가 필요한 로직은 `findDuplicates(entries, hashHead)`처럼 함수를 주입받는다.

**PowerShell** — 드라이브 목록과 설치된 앱은 Node API로 얻을 수 없어 `lib/powershell.ts`가
`powershell.exe`를 부른다. 전부 조회 전용이고, 실패하면 예외 대신 `null`을 돌려준다(카드 하나가
비는 게 앱이 죽는 것보다 낫다). `drives.ts`는 PowerShell이 막힌 환경을 위해 `fs.statfs` 대비책을
가지고 있다. `ConvertTo-Json`은 항목이 하나면 배열이 아닌 객체를 내므로 `toArray()`로 받는다.

**윈도우 경로** — 문자열로 조립하지 말고 `node:path`의 `join`/`sep`을 쓴다. 드라이브 루트는
`'C:'`가 아니라 `` `C:${sep}` ``이다 (`'C:'`만 쓰면 드라이브 기준 상대 경로가 된다). PowerShell
스크립트의 레지스트리 경로처럼 백슬래시 리터럴이 필요하면 `String.raw`를 쓴다.

**경로 별칭(`@shared`, `@`)은 세 곳에 각각 적혀 있다** — `tsconfig.json`, `electron.vite.config.ts`,
`vitest.config.ts`. 별칭을 바꾸면 세 파일 모두 고쳐야 한다.

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

## 차트 색

`--chart-*` 7색(+ 무채색 '기타')은 `src/renderer/src/index.css`의 `:root`(밝은 배경)와
`.dark`(어두운 카드 배경)에 각각 정의돼 있다. 밝기만 뒤집은 값이 아니라 각 배경에서 명도대·채도·
색각이상 분리도·정상시야 분리도·배경 대비 검사를 통과한 조합이다. **눈대중으로 바꾸지 않는다.**

색은 정렬 순위가 아니라 **카테고리에 고정**으로 붙는다(`CategoryChart.tsx`의 `CATEGORY_COLOR`).
정렬이 바뀌어도 '이미지'는 늘 같은 색이어야 한다. 누적 띠의 순서도 데이터가 아니라 고정 카테고리
순서다. 띠 아래 목록이 범례이자 표 역할을 해, 색만으로 정보를 전달하는 구간이 없어야 한다.

## 다음 단계 — B3: 중복 후보 → 휴지통 (아직 구현 없음)

이동·실행취소(B1·B2)는 구현됐다. 남은 것은 중복 후보 정리다. 삭제는 항상 휴지통을 경유하고
규칙(중복 후보)에서만 나오며, AI 는 관여하지 않는다(`TrashItem`은 `PlanItem`과 다른 타입으로 둔다).
`ExecutorIo`에 `trashItem`(`shell.trashItem`)을 추가하고, 그룹마다 최소 1개를 남기며, 지우기 전에
전체 해시로 다시 확인한다 — 그때 `hashFull`은 열기 직전에 `lstat`으로 클라우드 전용 여부를 다시
본다. `opportunities.ts`의 `findDuplicates`에서 그룹을 보존하는 `groupDuplicates()`를 분리한다.
실행취소는 안내만("휴지통에서 복원").
