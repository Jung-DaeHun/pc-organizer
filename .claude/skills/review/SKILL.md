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

### 2-2. 1단계는 조회 전용 — 쓰기 금지

지금 단계에서 파일을 바꾸는 코드는 **한 줄도 없어야 한다**. 스캔 결과가 정확하다는 확신이 서기 전에
되돌릴 수 없는 동작을 붙이면, 버그 하나가 곧바로 사용자 파일 손실이 된다.

```bash
grep -rn "writeFile\|unlink\|rmdir\|rm(\|rename\|copyFile\|mkdir\|trashItem\|shell.moveItemToTrash" src/main/services/ src/main/ipc/
```

허용되는 예외는 `store.ts`의 설정 파일 저장뿐이다. 그 밖에 사용자 파일을 건드리는 호출이 있으면 보고한다.
레지스트리도 마찬가지로 조회만 해야 한다 — `Set-ItemProperty`, `Remove-Item`, `New-Item`이 있으면 보고.

```bash
grep -n "Set-ItemProperty\|Remove-Item\|New-Item\|Stop-Process" src/main/services/apps.ts
```

### 2-3. 클라우드 전용 파일을 읽지 않는가

바탕화면이 OneDrive 아래에 있다. 클라우드에만 있는 파일의 **내용을 읽는 순간** 자동 다운로드가
시작되어 스캔 한 번에 수 GB가 샌다. 메타데이터(`stat`)만 읽는 건 안전하다.

- 파일 내용을 읽는 코드(`hashHead`, `open`, `readFile`, `createReadStream`)를 부르기 전에
  `isCloudOnly` / `entry.isCloudOnly`로 걸러내는가
- `findDuplicates`의 후보 필터에서 `!e.isCloudOnly` 가 빠지지 않았는가

```bash
grep -rn "isCloudOnly" src/main/
```

이 조건을 건드리는 변경이면 `tests/opportunities.test.ts`의 "클라우드 전용 파일은 절대 읽지 않는다"와
`tests/scanner.test.ts`의 `isCloudOnly` 테스트가 여전히 그 동작을 잡아내는지 확인한다.

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
- renderer로 파일 목록 전체를 넘기지 않는가. 집계 수치만 넘어가야 한다

### 2-7. 테스트 가능성

`scanner` / `categorize` / `opportunities` / `summarize`는 `electron`을 import 하지 않아야 한다.
그래야 Vitest에서 그대로 돌고, 나중에 worker_threads로 옮길 수 있다.

```bash
grep -rn "from 'electron'" src/main/services/
```

`store.ts`(userData 경로), `temp.ts`(간접 의존)만 예외다.
I/O가 필요한 로직은 `findDuplicates(entries, hashHead)`처럼 함수를 주입받는 형태인가.

### 2-8. 윈도우 경로

- 경로를 문자열로 조립하지 않고 `node:path`의 `join`/`sep`을 쓰는가
- 드라이브 루트가 `'C:'`가 아니라 `'C:' + sep`인가 (`'C:'`만 쓰면 드라이브 기준 상대 경로가 된다)
- 레지스트리 경로처럼 백슬래시 리터럴이 꼭 필요하면 `String.raw`를 쓰는가

### 2-9. 차트와 색

- 색이 정렬 순위가 아니라 **카테고리에 고정**으로 붙는가. 정렬이 바뀌어도 '이미지'는 같은 색이어야 한다
- 색 값을 새로 넣거나 바꿨다면 검증기를 돌렸는가 (눈대중 금지)
- 색만으로 정보를 전달하는 구간이 없는가 (범례 겸 표가 값을 항상 같이 보여줘야 한다)
- 누적 띠의 순서가 데이터가 아니라 고정 카테고리 순서인가

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
