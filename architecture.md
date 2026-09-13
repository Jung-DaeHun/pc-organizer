# 아키텍처

코드가 어디에 있고 어떻게 흐르는지를 적는다. 어기면 안 되는 규칙(불변 조건)은 `CLAUDE.md`에 있고 이 문서보다
먼저다 — 여기 적힌 구조는 그 규칙을 지키기 위한 모양이다. 서비스·IPC 채널·화면을 추가하거나 흐름을 바꾸면
이 문서도 같이 고친다.

## 층 구조

```
src/shared/     main·renderer 공용 계약 (types / channels / api / folderName / format / rules). IPC를 넘는 값은 순수 데이터
                rules — 분류 규칙의 기본표(확장자 → 카테고리)와 정규화. store 의 검증과 설정 화면이 같은 표를 쓴다
src/main/       파일시스템·레지스트리·네트워크를 만지는 유일한 곳
  index.ts      창 생성(저장된 테마로 배경색·nativeTheme), will-navigate 차단
  ipc/          채널 등록만. 로직 없음 (API 키로 StructuredCall, node:fs + shell.trashItem 으로 ExecutorIo,
                lib/recycleBin 으로 RecycleBinLookup 을 만들어 주입하는 것까지)
  services/     scan(조율, lastEntries·lastDuplicateGroups) · scanner(순회) · opportunities(집계, groupDuplicates) ·
                summarize · categorize(규칙 → 조회 함수, createCategorizer) · temp · apps · drives · store(settings.json 정규화)
                plan(조율, lastPlan, executeApproved) · topLevel(루트 한 단계) · planner(분류 규칙) · advisor(AI 요청·검증·병합)
                dedupe(조율, lastTrashPlan, executeTrashApproved — 중복 후보 → 휴지통)
                executor(이동·되돌리기·휴지통, io 주입 — 사용자 파일에 쓰는 유일한 곳) · journal(실행 기록, userData) · undo(조율)
                activity(스캔·실행·실행취소·휴지통 자물쇠 — 한 번에 하나만)
  lib/          powershell · hash(hashHead 앞 4KB · hashFull 전체) · cloudOnly · paths · recycleBin(휴지통 한도·사용량 조회)
                webUrl(새 창 요청 중 기본 브라우저로 넘길 http(s) 판별) · structured(계약) · anthropic(SDK, 유일한 네트워크)
src/preload/    contextBridge 다리. 채널마다 감싼 함수 하나
src/renderer/   React UI. Node 권한 없음. App 이 view 상태로 Dashboard / PlanPage / TrashPage / SettingsPage / AppsPage 를 고른다
  hooks/        useScan · usePlan · useUndo · useTrash · useApps — IPC 호출과 화면 상태 (useScan·useApps 는 App 이 한 번 들고 내려보낸다)
  lib/          planEdit · trashEdit · settingsEdit · appsView — 판·설정·앱 목록의 편집·정렬 규칙(순수 함수, tests/ 가 검증) · format · theme
  components/   plan/(칸반·ExecuteDialog) · trash/(그룹 카드·TrashDialog) · settings/(테마·분류 규칙·판정 기준 카드) ·
                ui/ · 대시보드 카드들
tests/          Vitest, node 환경. 서비스는 가짜 io 로, 일부는 임시 디렉터리의 실제 fs 로 돈다
```

## IPC 채널을 하나 추가하려면 네 곳을 같이 고쳐야 한다

하나라도 빠지면 런타임에야 드러난다.

1. `src/shared/channels.ts` — 채널 이름
2. `src/shared/api.ts` — `RendererApi` 인터페이스
3. `src/main/ipc/handlers.ts` — `ipcMain.handle` 등록
4. `src/preload/index.ts` — 감싼 함수 노출

main 이 renderer 로 미는 진행 이벤트(`scan:progress`, `plan:execute-progress`, `trash:execute-progress`)도 같은
네 곳이다 — preload 가 `on…` 함수로 감싸고 해제 함수를 돌려준다.

## 스캔 파이프라인

`services/scan.ts`가 조율한다. `scanFolders`로 파일 목록을 만들고, `groupDuplicates`(크기 + 앞 4KB 해시, 그룹
보존)와 `measureTempAndTrash`를 병렬로 돌린 뒤 `summarizeDuplicates`로 집계한다.

원본 `FileEntry[]`는 `scan.ts`의 모듈 변수 `lastEntries`에 **main 쪽에만** 남는다(`getLastEntries()`로 꺼낸다).
중복 후보 그룹도 `lastDuplicateGroups`로 같이 남아 휴지통 계획이 쓴다(`getLastDuplicateGroups()`). renderer로는
집계 수치만 보낸다 — 파일 수만 개를 IPC로 넘기면 직렬화 비용만으로 화면이 눈에 띄게 버벅인다. 목록·그룹과
`lastScannedAt`은 스캔이 **끝났을 때** 함께 바뀌고, `markStale()`이 셋을 같이 버린다.

## 한 번에 하나만 — `activity.ts`

스캔·실행·실행취소·휴지통은 `services/activity.ts`의 자물쇠 하나를 넷이 같이 잡는다(`beginActivity`, `finally`에서
놓는다). 스캔 도중 파일이 움직이면, 실행취소가 `markStale()`로 목록을 비워도 스캔이 끝나며 옮기기 전 위치로
잡힌 목록으로 `lastEntries`를 덮어써 그 뒤의 계획이 없는 파일을 가리킨다. 계획 세우기(`buildPlan`·`buildTrashPlan`)는
잠그지 않되 `assertIdle`로 아무 작업도 없을 때만 응한다. 네 작업이 서로의 플래그를 보게 하지 않는다 — 검사가
여러 곳으로 흩어져 하나만 빠져도 조용히 깨진다.

## 정리 계획

`services/plan.ts`가 조율하고 마지막 계획을 `lastPlan`에 main 쪽에만 둔다. `buildPlan(root, scannedAt)`은
renderer가 보고 있는 `ScanResult.scannedAt`과 main의 목록이 같은 스캔인지 확인한 뒤에만 응한다. 대상은 감시
폴더 **바로 아래**의 파일과 폴더(통째로)뿐이다(`topLevel.ts` — 루트 한 단계만 `readdir`, 폴더 용량은
`lastEntries`를 경로 접두로 집계). `planner.ts`가 분류 규칙(`Settings.rules`)으로 초안을 만들고 `advisor.ts`가 그 위에
AI 추천을 얹는다. 루트 바로 아래 파일은 `listTopLevel`이 **지금 규칙**으로 다시 분류하므로, 스캔 뒤에 규칙을 고쳐도
계획은 새 규칙을 따른다(집계 카드는 다시 스캔해야 맞는다). `OrganizePlan`은 유한한 목록이라 renderer로 넘기지만, 실행은 renderer가 돌려보낸 `{id, toFolder}`를
`lastPlan`과 대조한 뒤에만 한다. 클라우드 전용 파일·링크·`desktop.ini`는 계획에서 뺀다(`skipped`에 이유 코드와
함께). 바로가기(`.lnk`·`.url`)는 정리 대상이다 — 어디로 옮겨도 그대로 열린다.

**계획은 목적지를 폴더 이름으로만 말한다.** `PlanItem.toFolder`는 root 바로 아래 폴더의 이름이고 경로가
아니다. renderer는 경로를 한 번도 조립하지 않으며, 실제 경로는 실행 단계에서 main이 `join(root, toFolder,
item.name)`으로 만든다. 폴더 이름 규칙(`sanitizeFolderName`, `folderKey`)은 `src/shared/folderName.ts` 한 곳에
있어 AI 응답 검증과 사용자가 직접 만든 폴더가 같은 검사를 받는다.

**계획 화면은 칸반 보드다.** 폴더 = 열, 항목 = 카드. 카드가 있는 열이 곧 결정이라 승인 체크박스는 없다
(`그대로 두기` 열 = 옮기지 않음). 판 편집 규칙은 `renderer/src/lib/planEdit.ts`의 순수 함수에 모여 있고
`tests/planEdit.test.ts`가 검증한다. 드래그는 네이티브 HTML5 DnD(의존성 없음). 판도 main과 같은 규칙을
지킨다 — **목적지로 쓰이는 폴더는 옮기지 않는다.** 열과 같은 이름의 폴더 카드는 그 열 자체라 옮길 수 없고
(`isDestinationDir`, 카드에 '정리 폴더' 배지), 이미 다른 열로 보낸 폴더 카드의 이름으로는 열을 만들 수 없다.
열 이름은 `skipped`에 간 이름과도 대조한다(폴더면 '기존 폴더', 파일·링크면 거부 — 실행 단계의 `mkdir`이
`EEXIST`로 터지지 않게).

## 실행과 실행취소

`plan.ts`의 `executeApproved(requests, {io, journalPath, onProgress})`가 조율한다. `executor.ts`의
`resolveMoves`(계획 대조) → `preflight`(읽기 전용 점검, 하나라도 걸리면 `blocked`) → 저널에 빈 기록 저장 →
`executeMoves`(항목마다 `mkdir`+`rename`, 실패해도 계속, 결과마다 저널 갱신). 끝나면 `lastPlan = null`,
`markStale()`.

실행취소는 `undo.ts`가 저널에서 기록을 찾아 `undoMoves`로 ok 였던 이동을 역순으로 되돌린 뒤 `createdFolders`
중 빈 것을 `rmdir`(비재귀)로 치우고 `undoneAt`을 찍는다(한 번만). 비어 있지 않은 폴더는 `keptFolders`로
돌려주고 남긴다 — 저널에도 같이 적는다. 화면은 `createdFolders - removedFolders`로 계산하지 않는다(사용자가
이미 지운 폴더는 어느 쪽도 아니다). `undoMoves`는 기록의 두 경로가 `join(root, name)` → `join(root, 폴더, name)`
꼴인지 다시 본 뒤에만 `rename`한다.

renderer 는 `usePlan.execute` → `ExecuteDialog`(확인 → 진행 → 결과) → `scan.invalidate()` 순서로 움직이고,
대시보드의 `RecentRunCard`가 저널을 보여주며 실행취소 버튼을 준다.

## 중복 후보 → 휴지통

`services/dedupe.ts`가 조율하고 `plan.ts`와 같은 구조다. `buildTrashPlan(scannedAt)`은 `assertIdle`과
`scannedAt` 대조를 거쳐 `lastDuplicateGroups`를 `TrashPlan`으로 바꾼다 — 그룹마다 남길 파일(`chooseKeeper`:
가장 최근 손댄 것, 동률이면 경로가 짧은 것)을 고르고 확보량이 큰 그룹부터 정렬한다. 계획은 파일을 읽지
않는다. 마지막 계획은 `lastTrashPlan`으로 main 에만 둔다.

실행은 `executeTrashApproved(requests, {io, hashIo, recycleBin, journalPath, onProgress})`다. 자물쇠 →
`scannedAt` 대조 → `executor.ts`의 `resolveTrash`(계획 대조 — 요청은 `{groupId, keepId}`뿐이라 경로는 계획에서
온다) → `preflightTrash`(읽기 전용 — 볼륨의 휴지통 한도·사용량(파일 하나가 한도 이상, 사용량 + 보낼 합계가
한도 이상, 휴지통 안 씀, 모름) → 모든 파일 `lstat` → 전체 해시 → 휴지통 한도·사용량을 **한 번 더**(해시하는 동안
찼을 수 있다), 하나라도 걸리면 `blocked`) → 저널에 `kind: 'trash'` 빈 기록 → `executeTrash`(파일마다 남길 파일이 아직 있는지 다시 본 뒤
`trashItem`, 실패해도 계속, 결과마다 저널 갱신). 끝나면 `lastTrashPlan = null`, `clearLastPlan()`,
`markStale()`. 왜 이 순서여야 하는지는 `CLAUDE.md` 불변 조건 1에 있다. 기록의 `keptPaths`는 계획 시점의
남길 파일 목록이 아니라 **실제로 파일을 보낸 그룹**의 남길 파일이다(`onResult`에서 `ok`일 때 채운다) —
보내는 도중 남길 파일이 사라져 하나도 보내지 않은 그룹은 남긴 것도 없으므로 세지 않는다.

renderer 는 `useTrash` → `TrashPage`(그룹 카드마다 남길 파일 라디오와 포함 체크박스, 편집 규칙은
`renderer/src/lib/trashEdit.ts`의 순수 함수 — `toTrashRequests`가 포함된 그룹만 `{groupId, keepId}`로 바꾼다)
→ `TrashDialog`(확인 → 진행: 전체 해시 비교 / 보내는 중 → 결과 또는 blocked) → `scan.invalidate()` 순서다.
대시보드 `OpportunityCard`의 '중복 후보' 행 버튼이 이 화면으로 들어온다.

## 설정 화면 — 분류 규칙과 테마

대시보드 헤더의 톱니 버튼이 `SettingsPage`를 연다. 카드는 셋 — 화면 테마 · 분류 규칙 · 판정 기준(대용량·오래된 파일
기준). 새 IPC 채널은 없다: 전부 `Settings`의 필드이고 감시 폴더와 같은 `updateSettings` 하나로 간다. 저장이
돌아오면 `App`의 `settings`를 갈아 끼워 테마가 따라간다. 파일은 건드리지 않는다.

**판정 기준(`largeFileBytes` · `oldFileDays`)** 은 다음 스캔부터 쓰인다. 스캔은 수치를 낸 기준을
`Opportunities.thresholds`에 같이 실어 보내고, 대시보드 `OpportunityCard`의 힌트 문구("100 MB 이상")는 현재
`settings`가 아니라 그 값을 보여준다 — 스캔 뒤 기준을 바꿔도 낡은 수치 옆에 새 기준이 붙어 숫자가 문구를
배신하는 일이 없다.

**분류 규칙(`Settings.rules`)** 은 카테고리(일곱 개, '기타' 제외)마다 `{ folderName, extensions, enabled }` 하나다.
카테고리 자체는 고정이다 — 차트 색·집계가 카테고리에 묶여 있어 새 카테고리를 만들 수 없다. 기본표와 정규화
(`normalizeRules` — 항상 일곱 개 순서대로, 한 확장자는 한 카테고리에만, 폴더 이름은 `sanitizeFolderName`)는
`shared/rules.ts`에 있어 `store.ts`의 검증과 설정 화면의 '기본값으로'가 같은 값을 쓴다. `categorize.ts`의
`createCategorizer(rules)`가 조회 함수를 만들고, 스캔(`scan.ts` → `scanner.ts`)과 계획(`plan.ts` → `topLevel.ts`)이
같은 규칙으로 만든 함수를 주입받는다 — 집계의 '이미지'가 계획의 '이미지'다. `planner.ts`는 `enabled`가 꺼진
카테고리를 '기타'처럼 그대로 두고, 두 카테고리가 같은 폴더 이름을 쓰면 폴더 하나로 모은다(대소문자만 다르면
앞선 카테고리의 표기). 초안은 renderer 의 사본이고 편집 규칙은 `lib/settingsEdit.ts`의 순수 함수다 —
다른 카테고리에 있던 확장자를 넣으면 거기서 빼 온다. '저장'을 누르기 전에는 아무것도 바뀌지 않는다.

**테마(`Settings.theme`)** 는 `'dark' | 'light'`, 기본 `dark`. `<html>`의 `.dark` 클래스 하나로 갈린다
(`index.css`의 변수 두 벌, `@custom-variant dark`). `App`이 `settings.theme`을 보고 `lib/theme.ts`의 `applyTheme`으로
클래스를 맞추고, 같은 값을 `localStorage`에 사본으로 남긴다 — 다음 실행의 **첫 페인트**를 저장된 테마로 시작하기
위한 힌트일 뿐 진짜 값은 `settings.json`이다(`main.tsx`가 렌더 전에 `applyCachedTheme`). main 은 창을 만들기 전에
설정을 읽어 창 배경색과 `nativeTheme.themeSource`(스크롤바·select 목록)를 맞추고, `settings:update` 핸들러가
바뀔 때마다 따라간다.

## 설치된 앱 — 제거 안내

대시보드 '설치된 앱' 카드의 버튼이 `AppsPage`를 연다. 목록은 `services/apps.ts`가 PowerShell 로 '프로그램 추가/제거'와
같은 레지스트리 키 세 곳을 **읽은** 것이고(`apps:list`, Microsoft Store 앱은 없다), 화면은 검색·정렬(`lib/appsView.ts` —
용량 큰 순 · 설치일 오래된 순 · 이름순, 값을 모르는 앱은 어느 기준이든 뒤)로 훑어보게 할 뿐이다. 설치일은 레지스트리
`InstallDate`를 `parseInstallDate`가 확실한 모양(`YYYYMMDD`·`YYYY-MM-DD`·`YYYY/MM/DD`)만 받고 나머지는 모름(`-`)으로 둔다
— `M/D/YYYY`는 1월 2일과 2월 1일이 갈리지 않아 받지 않는다.

조회 실패는 빈 목록과 구분한다. 두 스크립트는 `ConvertTo-Json -InputObject @(...)`로 끝나 항목이 없어도 `[]`를 내므로,
`runPowerShellJson`의 `null`(PowerShell 차단·타임아웃)은 실패뿐이고 `listApps`(`createAppsLister`)가 **거부**해 훅의
`error` 경로로 보낸다 — 빈 목록으로 흘려보내면 화면이 "설치된 앱이 없습니다"라고 거꾸로 말한다(`tests/apps.test.ts`).

**제거는 앱이 하지 않는다.** 어떤 앱을 지우라고 고르지도 않는다(설치일이 오래됐다고 안 쓰는 앱이 아니고 크다고 지워도
되는 앱이 아니다). '윈도우 설정에서 제거' 버튼이 `apps:open-settings`로 `shell.openExternal(WINDOWS_APPS_SETTINGS_URI)`
(`ms-settings:appsfeatures`)를 부르는 것까지다 — URI 는 `services/apps.ts`의 상수 하나이고 renderer 에서 오는 인자는 없어
임의 URI 를 열 수 없다. 레지스트리의 `UninstallString`은 실행하지 않는다: 임의 프로그램을 돌리는 것이고 그 프로그램이
무엇을 지울지 앱이 알 수 없다. 돌아온 뒤 목록은 '다시 읽기'로 갱신한다.

## 저널

`services/journal.ts`가 `userData/journal.json` 한 파일에 이동 기록(`UndoEntry`)과 휴지통 기록(`TrashEntry`)을
`kind`로 구분해 시간순으로 둔다(`JournalEntry` — `kind`가 없으면 휴지통이 생기기 전의 이동 기록). 디스크의
JSON이라 읽을 때 원소 모양까지 검사한다(`isEntry`). `undo.ts`는 `kind === 'trash'`를 거부하고, 대시보드
`RecentRunCard`는 휴지통 기록에 실행취소 버튼 대신 "윈도우 휴지통에서 복원" 안내를 붙인다.

`saveEntry`는 **저장하려는 항목을 무조건 남기고** 나머지만 `JOURNAL_LIMIT`에 맞춰 자른다. 시각으로 정렬한
뒤 자르면 시계가 뒤로 간 뒤에 방금 실행한 기록이 잘려 "기록 없는 실행"이 된다. 한도는 **종류마다 따로**다
(이동 20 + 휴지통 20) — 한도를 같이 쓰면 되돌릴 수 없는 휴지통 기록이 쌓일수록 되돌릴 수 있는 이동 기록이
밀려난다. 옮긴 뒤 마지막 저장이 실패하면
`ExecuteOutcome.journalError` / `TrashOutcome.journalError`로 화면에 알린다(저널이 뒤처져 실행취소가 마지막
항목을 놓칠 수 있다).

## 서비스는 `electron`을 import 하지 않는다

그래야 Vitest에서 그대로 돌고 나중에 `worker_threads`로 옮길 수 있다. `store.ts`만 예외다(`app.getPath`).
앱 경로 같은 값은 import가 아니라 인자로 받는다. I/O가 필요한 로직은 `groupDuplicates(entries, hashHead)`,
`executeTrashApproved(requests, {io, hashIo, recycleBin, …})`처럼 함수를 주입받는다 — 실체는 `ipc/handlers.ts`가
만든다.

## PowerShell

드라이브 목록·설치된 앱·볼륨의 휴지통 한도는 Node API로 얻을 수 없어 `lib/powershell.ts`가 `powershell.exe`를
부른다. 전부 조회 전용이고, 실패하면 예외 대신 `null`을 돌려준다(카드 하나가 비는 게 앱이 죽는 것보다 낫다 —
휴지통 설정은 `null`이면 "모른다 = 보내지 않는다"). 휴지통의 현재 사용량은 PowerShell이 아니라
`lib/recycleBin.ts`의 `measureRecycleBinUsage`가 `<root>$Recycle.Bin\<SID>`를 `readdir`·`lstat`으로 읽는다
(SID는 한도 조회에 같이 실려 오고 `S-1-…` 모양만 경로에 쓴다). 같은 조회가 `Win32_MountPoint`의 마운트 폴더
목록도 실어 온다 — 드라이브 문자 없이 폴더에 마운트된 볼륨은 휴지통이 자기 것이라, 그 아래 파일은
`recycle-bin-unknown`으로 막는다(`mountPointOf`). Shell COM의 휴지통 열거는 쓰지 않는다 — 그
열거 자체가 한도 초과분 밀어내기를 트리거할 가능성을 배제하지 못했다. `drives.ts`는 PowerShell이 막힌 환경을 위해 `fs.statfs`
대비책을 가지고 있다. 파이프로 끝나는 `| ConvertTo-Json`은 항목이 하나면 배열이 아닌 객체를 내고 없으면 아무것도 내지
않는다(빈 출력 = `null` = 실패와 겹친다) — `toArray()`로 받고, 빈 결과와 실패를 갈라야 하는 곳(`apps.ts`)은
`ConvertTo-Json -InputObject @(...)`로 항상 배열을 낸다.

## 윈도우 경로

문자열로 조립하지 말고 `node:path`의 `join`/`sep`을 쓴다. 드라이브 루트는 `'C:'`가 아니라 `` `C:${sep}` ``이다
(`'C:'`만 쓰면 드라이브 기준 상대 경로가 된다). PowerShell 스크립트의 레지스트리 경로처럼 백슬래시 리터럴이
필요하면 `String.raw`를 쓴다.

## 경로 별칭

`@shared`, `@`는 세 곳에 각각 적혀 있다 — `tsconfig.json`, `electron.vite.config.ts`, `vitest.config.ts`.
별칭을 바꾸면 세 파일 모두 고쳐야 한다.
