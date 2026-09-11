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

### 1. 1단계는 조회 전용. 사용자 파일에 쓰는 코드는 한 줄도 없다

스캔 결과가 정확하다는 확신이 서기 전에 되돌릴 수 없는 동작을 붙이면, 버그 하나가 곧바로 사용자
파일 손실이 된다. **허용되는 쓰기는 `services/store.ts`의 설정 파일(`userData/settings.json`)
저장뿐이다.** 레지스트리도 조회만 한다 (`Set-ItemProperty` / `Remove-Item` / `New-Item` 금지).

`writeFile`·`unlink`·`rename`·`trashItem` 같은 호출을 `src/main/services/`나 `src/main/ipc/`에
추가해야 할 것 같으면, 그건 2단계 작업이다. 먼저 확인을 받는다.

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

## 아키텍처

```
src/shared/     main·renderer 공용 계약 (types / channels / api). IPC를 넘는 값은 순수 데이터
src/main/       파일시스템·레지스트리를 만지는 유일한 곳
  ipc/          채널 등록만. 로직 없음
  services/     scan(조율) · scanner(순회) · opportunities · summarize · categorize · temp · apps · drives · store
  lib/          powershell · hash
src/preload/    contextBridge 다리
src/renderer/   React UI. Node 권한 없음
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
직렬화 비용만으로 화면이 눈에 띄게 버벅인다. 2단계의 이동 계획은 main에서 이 원본을 쓴다.

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

## 다음 단계 (아직 구현 없음)

`src/shared/types.ts`의 `PlannedAction` / `ExecutionResult` / `UndoEntry`는 2단계
(**미리보기 → 승인 → 실행 → 실행취소**)를 위해 자리만 잡아둔 타입이다. 1단계 코드는 이 값을
만들지 않는다. 삭제는 항상 휴지통을 경유하고, 중복은 지우기 전에 전체 해시로 다시 확인해야 한다.
