---
name: review
description: PC 정리 도구 코드 리뷰. 이 프로젝트가 지켜야 하는 불변 조건(프로세스 경계, 쓰기 금지, 클라우드 파일 보호, 수치 정확성)을 기계적으로 확인하고 일반 결함까지 본다. 코드를 고친 뒤, 커밋 전, PR 전에 쓴다.
---

# PC 정리 도구 코드 리뷰

이 프로젝트는 **사용자의 실제 파일을 다루는 데스크톱 앱**이다. 여기서의 버그는 화면이 깨지는
정도로 끝나지 않고 파일이 사라지거나 수 GB가 네트워크로 새는 결과가 된다. 그래서 일반적인
코드 품질보다 아래 불변 조건이 먼저다.

## 1. 리뷰 범위 정하기

인자로 범위가 주어지지 않았다면 변경분을 본다.

```bash
git status --short
git diff HEAD --stat
git diff HEAD
```

커밋이 하나도 없는 저장소라면 `git status --short`에 뜨는 파일 전체가 대상이다.
`전체` 또는 `all`이 인자로 주어지면 `src/` 아래를 모두 본다.

**읽지 않은 파일은 지적하지 않는다.** 추측으로 결함을 만들어내느니 범위를 좁게 잡는 게 낫다.

## 2. 불변 조건 — 하나라도 깨지면 무조건 보고

각 항목은 눈으로 훑지 말고 아래 명령으로 확인한다.

### 2-1. 프로세스 경계

renderer는 Node에 닿을 수 없어야 한다. UI 코드의 버그가 파일시스템에 도달하는 경로를 원천 차단하는 장치다.

```bash
grep -n "contextIsolation\|nodeIntegration\|sandbox\|webSecurity" src/main/index.ts
```

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` — 셋 다 유지되는가
- preload가 `ipcRenderer`를 **통째로** 노출하지 않는가 (`exposeInMainWorld('ipcRenderer', ipcRenderer)` 금지).
  채널마다 감싼 함수만 내보내야 renderer가 임의 채널을 부를 수 없다
- renderer 코드가 `node:` 모듈이나 `electron`을 직접 import 하지 않는가

```bash
grep -rn "from 'node:\|require(\|from 'electron'" src/renderer/
```

### 2-2. 사용자 파일을 건드리는 건 executor.ts 뿐 — 영구 삭제 코드 금지

스캔·계획·AI 추천은 사용자 파일을 바꾸는 코드가 **한 줄도 없어야 한다**. 사용자 파일에 쓰는 로직은
`services/executor.ts` 하나이고, 하는 일은 `mkdir`·`rename`, 실행취소가 자기가 만든 **빈** 폴더를 치우는
`rmdir`(비재귀), 그리고 중복 후보의 나머지 사본을 윈도우 휴지통으로 보내는 `trashItem`(B3) 넷뿐이다.

**영구 삭제 호출은 어디에도 없어야 한다.** 하나라도 나오면 치명.

```bash
grep -rn "unlink\|rm(\|rmSync\|copyFile\|shell.moveItemToTrash" src/main/
```

`trashItem`은 `executor.ts`(`trashOne` 안 `io.trashItem` 한 번)와 `handlers.ts`(`shell.trashItem` 배선)에만
있어야 한다. 다른 곳에 나오면 보고.

```bash
grep -rn "trashItem" src/main/
```

`rmdir`은 `executor.ts`(undoMoves, `createdFolders` 만)와 `handlers.ts`(io 배선)에만 있어야 하고
**옵션 없이** 불러야 한다. `recursive`가 붙어 있으면 치명 — 비어 있지 않은 폴더가 통째로 지워진다.

```bash
grep -rn "rmdir" src/main/
grep -rn "recursive" src/main/ | grep -v "mkdir"
```

쓰기 호출은 아래 위치에만 있어야 한다. 그 밖의 파일에서 나오면 보고한다.

```bash
grep -rn "writeFile\|rename\|mkdir" src/main/services/ src/main/ipc/ src/main/lib/
```

- `store.ts` — `userData/settings.json`·`secrets.json` (`writeFile`, `mkdir`)
- `journal.ts` — `userData/journal.json` (`writeFile` 임시 파일 → `rename`, `mkdir`)
- `handlers.ts` — `node:fs/promises`의 `lstat`/`mkdir`/`rename`/`rmdir`과 `shell.trashItem`으로 `ExecutorIo`를
  **만들기만** 한다
- `executor.ts` — `io.mkdir`/`io.rename`/`io.rmdir`/`io.trashItem` 호출. **`node:fs`를 import 하지 않는다** (아래로 확인)

```bash
grep -n "from 'node:fs" src/main/services/executor.ts src/main/services/undo.ts src/main/services/plan.ts src/main/services/dedupe.ts
```

실행기 자체도 확인한다:
- `resolveMoves`가 요청을 `lastPlan`과 대조하는가 — 경로는 요청이 아니라 계획에서 오고, `toFolder`는
  `sanitizeFolderName`을 다시 거치며, 옮기는 항목 이름·파일 이름과 겹치는 목적지는 전체 거부
- `preflight`가 하나라도 걸리면 아무것도 옮기지 않는가 (`blocked`)
- `checkMove`가 목적지 폴더의 `isSymbolicLink()`를 보는가 (정션인 목적지로 흘러가지 않게)
- 목적지에 같은 이름이 있으면 `exists`로 실패하는가 — 윈도우의 `rename`은 파일을 조용히 덮어쓴다
- `EXDEV`가 복사+삭제로 이어지지 않는가
- `executeApproved`가 저널에 빈 기록을 **먼저** 저장하고, 저장 실패면 실행하지 않는가
- 실행·실행취소 뒤에 `markStale()`과 `lastPlan = null`이 불리는가
- `undoMoves`가 ok 였던 것만 역순으로, `to`가 그대로 있고 `from`이 비었을 때만 옮기는가
- `undoMoves`의 폴더 치우기가 `entry.createdFolders`에 있는 이름만, `sanitizeFolderName`을 다시 거친 뒤,
  `lstat`이 진짜 디렉터리(링크 아님)일 때만 `io.rmdir`을 부르고, 실패(ENOTEMPTY 등)는 `keptFolders`로 삼키는가

휴지통 실행기(B3)도 확인한다:
- `resolveTrash`가 요청을 `lastTrashPlan`과 대조하는가 — 요청은 `{groupId, keepId}` 뿐이고 경로는 계획에서 온다.
  모르는 그룹, 그룹에 없는 `keepId`, 같은 그룹 두 번이면 전체 거부. 남길 파일을 뺀 나머지가 대상이라
  **그룹 전체를 지우는 요청은 만들 수 없다**
- `preflightTrash`가 **파일을 읽기 전에** 보낼 파일의 볼륨마다 휴지통 설정(`RecycleBinLookup`, `lib/recycleBin.ts`)을
  보고 파일 하나가 한도 이상(`>=`)·**사용량 + 보낼 합계가 한도 이상**(`recycle-bin-full`, 그 볼륨의 대상 전부)·
  휴지통 안 씀·설정 모름이면 막는가 — `shell.trashItem`은 휴지통 최대 크기보다 큰 파일을 **오류 없이 영구
  삭제**하고, 합계가 넘으면 넣은 뒤 탐색기가 오래된 것부터 영구 삭제한다(둘 다 실측). 전체 해시가 끝난 뒤에도
  `checkRecycleBin`을 **한 번 더** 부르는가(해시하는 동안 휴지통이 찼을 수 있다). 볼륨 키를 `pathKey`로 접는가
  (`C:\`·`c:\`가 갈리면 합계가 쪼개진다). `checkRecycleBin`이 빠지거나 `trashItem`을 이 검사 없이 부르는 경로가
  생기면 치명
- `lib/recycleBin.ts`의 PowerShell 이 `Get-CimInstance`·`Get-ItemProperty` 조회뿐이고, 스크립트에 끼워 넣는 값이
  `driveLetterOf`가 검증한 드라이브 문자 하나뿐인가. 사용량(`measureRecycleBinUsage`)은 `readdir`·`lstat`만 쓰고,
  경로에 끼워 넣는 SID 는 `S-1-…` 모양만 받으며, 링크·정션을 따라가지 않고, 못 읽으면 `null`(모른다)인가.
  Shell COM(`Shell.Application`)으로 휴지통을 열거하는 코드가 생기면 의심(열거가 밀어내기를 트리거할 수 있다)
- `preflightTrash`가 그룹의 **모든** 파일(남길 것 포함)을 `lstat`(존재·일반 파일·크기 동일·클라우드 전용 아님)한 뒤
  `hashFull`로 전체 해시를 비교하고, 하나라도 걸리면 `blocked`로 **아무것도 보내지 않는가**
- `trashOne`이 보내기 직전에 남길 파일이 아직 있는지(`keeperIntact`) 다시 보는가 — 없으면 `keeper-missing`
- `executeTrashApproved`(`dedupe.ts`)가 `beginActivity('trash')` → `plan.scannedAt === getLastScannedAt()` →
  저널에 `kind: 'trash'` 빈 기록을 **먼저** 저장(실패면 보내지 않음) → 끝나면 `lastTrashPlan = null`·`clearLastPlan()`·
  `markStale()` 순서인가
- `undo.ts`가 `kind === 'trash'` 기록을 거부하는가 (앱이 휴지통에서 꺼내는 코드는 없다)
- "걸리면 아무것도 보내지 않는다" 테스트가 살아 있는가 — `tests/dedupe.test.ts`의 "뒷부분이 바뀌었으면 … 아무것도
  보내지 않는다"·"휴지통 최대 크기 이상인 파일이 있으면 아무것도 보내지 않는다"(실제 fs, `trashed` 빈 배열 + 저널 없음),
  `tests/trashExecutor.test.ts`의 `describe('휴지통 설정')`(걸리면 `opened`도 빈 배열)

`topLevel.ts`의 `readdir`/`lstat`은 조회다. 레지스트리도 조회만 해야 한다 — `Set-ItemProperty`,
`Remove-Item`, `New-Item`이 있으면 보고.

```bash
grep -n "Set-ItemProperty\|Remove-Item\|New-Item\|Stop-Process" src/main/services/apps.ts
```

### 2-3. 클라우드 전용 파일을 읽지 않는가

바탕화면이 OneDrive 아래에 있다. 클라우드에만 있는 파일의 **내용을 읽는 순간** 자동 다운로드가
시작되어 스캔 한 번에 수 GB가 샌다. 메타데이터(`stat`)만 읽는 건 안전하다.

- 파일 내용을 읽는 코드(`hashHead`, `hashFull`, `open`, `readFile`, `createReadStream`)를 부르기 전에
  `isCloudOnly` / `entry.isCloudOnly`로 걸러내는가
- `groupDuplicates`의 후보 필터에서 `!e.isCloudOnly` 가 빠지지 않았는가
- `hashFull`(`lib/hash.ts`)이 `io.open` **직전에** `io.lstat` → `isCloudOnly` 를 거치는가. 스캔 때의
  플래그는 믿지 않는다 — 스캔 뒤 OneDrive 가 파일을 내려놓았을 수 있다
- `listTopLevel`(정리 계획)이 클라우드 전용 파일을 `skipped`로 빼는가. 같은 OneDrive 루트 안의
  이동은 내려받기를 유발하지 않을 것으로 보지만, 확신이 설 때까지 계획에 넣지 않는다

```bash
grep -rn "isCloudOnly" src/main/
grep -rn "open(\|readFile\|createReadStream" src/main/   # hash.ts · journal.ts · store.ts 밖이면 보고
```

이 조건을 건드리는 변경이면 `tests/opportunities.test.ts`의 "클라우드 전용 파일은 절대 읽지 않는다",
`tests/hash.test.ts`의 "클라우드 전용이면 열지 않는다", `tests/scanner.test.ts`의 `isCloudOnly` 테스트가
여전히 그 동작을 잡아내는지 확인한다.

### 2-4. 링크를 따라가지 않는가

자기 조상을 가리키는 정션 하나면 스캐너가 무한히 돈다.

```bash
grep -n "isSymbolicLink\|opendir\|readdir" src/main/services/scanner.ts
```

- 디렉터리로 재귀하기 **전에** `dirent.isSymbolicLink()`로 걸러내는가
- 재귀 대신 명시적 스택을 유지하는가 (깊은 트리에서 콜 스택이 넘치지 않게)
- 디렉터리 열기 실패와 파일 stat 실패를 각각 잡아 `skippedCount`만 올리고 계속 도는가

### 2-5. 수치가 부풀지 않는가

용량 수치는 사용자가 판단의 근거로 삼는 숫자다. 부풀린 숫자는 거짓말이다.

- 서로 겹칠 수 있는 묶음(대용량 ∩ 오래된)의 용량을 **더하지** 않는가.
  겹치면 `unionBytes`로 합집합을 써야 한다
- 지워도 되는지 사람이 판단해야 하는 것(대용량, 오래된 파일)을 '바로 확보 가능'에 넣지 않는가
- 중복은 앞 4KB만 비교한 결과다. 화면 문구가 '중복'이 아니라 **'중복 후보'**인가
- 중복 개수/용량이 '지울 수 있는 양'인가 (같은 파일 3개면 2개분)

### 2-6. 타입 계약

main과 renderer가 주고받는 값은 `src/shared/`를 거쳐야 한다.

- 새 IPC 채널이 `shared/channels.ts`, `shared/api.ts`, `main/ipc/handlers.ts`, `preload/index.ts`
  **네 군데 모두**에 반영됐는가. 하나라도 빠지면 런타임에야 드러난다
- IPC로 넘기는 값이 structured clone 가능한 순수 데이터인가 (클래스 인스턴스, 함수, `Map`/`Set` 금지)
- renderer로 파일 목록 전체를 넘기지 않는가. 집계 수치만 넘어가야 한다.
  정리 계획(`OrganizePlan`)은 감시 폴더 **바로 아래** 항목만 담는 유한한 목록이라 예외다 —
  `lastEntries` 자체를 넘기는 코드가 생기면 보고
- 계획 채널이 `scannedAt`을 받아 main의 목록과 같은 스캔인지 확인하는가 (`plan.ts`의 `buildPlan`)

### 2-7. 테스트 가능성

`src/main/services/` 아래는 `electron`을 import 하지 않아야 한다.
그래야 Vitest에서 그대로 돌고, 나중에 worker_threads로 옮길 수 있다.

```bash
grep -rn "from 'electron'" src/main/services/
```

`store.ts`(userData 경로, safeStorage)만 예외다.
I/O가 필요한 로직은 `findDuplicates(entries, hashHead)`, `listTopLevel(root, entries, readTopLevel)`,
`advisePlan(plan, call)`처럼 함수를 주입받는 형태인가.

### 2-8. 윈도우 경로

- 경로를 문자열로 조립하지 않고 `node:path`의 `join`/`sep`을 쓰는가
- 드라이브 루트가 `'C:'`가 아니라 `'C:' + sep`인가 (`'C:'`만 쓰면 드라이브 기준 상대 경로가 된다)
- 레지스트리 경로처럼 백슬래시 리터럴이 꼭 필요하면 `String.raw`를 쓰는가

### 2-9. 차트와 색

- 색이 정렬 순위가 아니라 **카테고리에 고정**으로 붙는가. 정렬이 바뀌어도 '이미지'는 같은 색이어야 한다
- 색 값을 새로 넣거나 바꿨다면 검증기를 돌렸는가 (눈대중 금지)
- 색만으로 정보를 전달하는 구간이 없는가 (범례 겸 표가 값을 항상 같이 보여줘야 한다)
- 누적 띠의 순서가 데이터가 아니라 고정 카테고리 순서인가

### 2-10. 네트워크 경계 — AI에게는 메타데이터만 간다

이 앱에서 네트워크로 나가는 경로는 AI 추천 하나뿐이다. 무엇이 나가는지 한 파일만 보면 알 수 있어야 한다.

```bash
grep -rn "@anthropic-ai/sdk\|fetch(\|node:https\|node:http'" src/
grep -rn "getApiKey" src/
```

- SDK import가 `src/main/lib/anthropic.ts`에만 있는가 (ESLint `SDK_IMPORT_PATTERN`도 같은 걸 막는다).
  `fetch`·`node:http(s)` 호출이 어디에도 없는가
- `getApiKey`가 `store.ts`(정의)와 `ipc/handlers.ts`(클라이언트 생성)에만 있는가.
  복호화된 키가 서비스로 들어가거나 IPC 응답에 실리는 경로가 없는가
- 전송 페이로드는 `advisor.ts`의 `buildAdvisorRequest` / `toAdvisorItem` 한 곳에서만 만드는가.
  `...item` 같은 펼치기로 필드가 조용히 따라 나가지 않는가.
  `tests/advisor.test.ts`의 "허용된 필드만 보낸다"·"절대 경로와 사용자 이름은 어디에도 없다"가 살아 있는가
- 응답 스키마(`ADVICE_SCHEMA`)에 `trash` 같은 삭제 동작이 없는가. AI는 이동·분류만 제안한다
- AI 호출이 사용자가 누른 뒤에만 일어나는가. 스캔이나 계획 세우기가 자동으로 부르는 경로가 없는가
- 키·페이로드·응답을 `console.log`로 남기지 않는가

## 3. 일반 결함

불변 조건을 통과했으면 아래를 본다. 이 프로젝트에서 실제로 문제가 됐던 것들이다.

- **비동기 정리** — `useEffect`에서 구독하고 해제하는가. 컴포넌트가 사라진 뒤 `setState` 하지 않는가
- **테스트가 실제로 도는가** — `it.skipIf`의 조건이 수집 시점에 평가된다. `beforeAll`에서 정한 값을
  조건으로 쓰면 테스트가 조용히 건너뛰어진다. 스킵된 테스트가 있으면 의도된 것인지 확인
- **에러를 삼키지 않는가** — `catch {}`로 넘어갈 거면 왜 안전한지 주석이 있는가.
  스캐너의 권한 오류처럼 의도된 무시는 카운트라도 남겨야 한다
- **큰 목록 처리** — 수만 건에 대해 `O(n²)`가 되지 않는가 (중복 탐지는 크기 그룹핑으로 먼저 좁힌다)
- **주석** — 무엇을 하는지가 아니라 **왜 그렇게 했는지**를 적었는가.
  코드를 읽으면 알 수 있는 내용을 다시 적은 주석은 지운다

## 4. 확인 명령

지적한 것이 실제로 깨지는지 확인한다. 통과하지 못한 채로 리뷰를 끝내지 않는다.

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## 5. 보고 형식

찾은 것만 적는다. 없으면 없다고 한다. **문제를 만들어내지 않는다.**

심각도 순으로:

1. **치명** — 파일 손실, 데이터 유출, 무한 루프로 이어지는 것. 위 불변 조건 위반은 대부분 여기
2. **결함** — 잘못된 수치, 잘못된 분기, 놓친 예외 처리
3. **개선** — 중복 제거, 단순화, 테스트 보강

각 항목은 `파일:줄` — 무엇이 잘못됐는지 한 문장 — **어떤 입력에서 어떻게 터지는지**를 적는다.
재현 시나리오를 못 쓰겠으면 그건 아직 결함이 아니라 의심이다. 의심은 따로 묶어 적는다.
