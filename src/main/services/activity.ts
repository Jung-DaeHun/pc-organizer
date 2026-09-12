/**
 * 파일시스템을 훑거나 움직이는 작업(스캔·실행·실행취소)은 **한 번에 하나만** 돈다.
 *
 * 겹치면 무엇이 깨지는가 — 스캔 도중 실행취소로 파일이 움직이면, 실행취소가 markStale() 로 목록을
 * 비워도 스캔이 끝나며 옮기기 전 위치로 잡힌 파일이 든 목록으로 lastEntries 를 덮어쓴다. 그 목록은
 * renderer 의 scannedAt 과 일치해 buildPlan 을 통과하고, 없는 파일을 가리키는 계획이 나온다.
 * 실행과 실행취소가 겹치면 같은 항목을 두 경로가 만진다.
 *
 * 세 작업이 서로의 플래그를 들여다보게 하면 검사가 여섯 곳(3×2)이 되고 하나만 빠져도 조용히 깨진다.
 * 대신 자물쇠 하나를 같이 잡는다. 계획 세우기처럼 스스로는 잠그지 않되 아무 작업도 돌고 있지 않아야
 * 하는 곳은 assertIdle 로 본다.
 */
export type Activity = 'scan' | 'execute' | 'undo'

/** 오류 문장용. 조사까지 붙여 둔다 */
const SUBJECT: Record<Activity, string> = { scan: '스캔이', execute: '실행이', undo: '실행취소가' }
const VERB: Record<Activity, string> = { scan: '스캔하세요', execute: '실행하세요', undo: '되돌리세요' }

let current: Activity | null = null

export function currentActivity(): Activity | null {
  return current
}

/** 아무 작업도 돌고 있지 않아야 한다. `what` 은 "끝난 뒤에 …" 뒤에 붙는 말 */
export function assertIdle(what: string): void {
  if (current !== null) {
    throw new Error(`${SUBJECT[current]} 진행 중입니다. 끝난 뒤에 ${what}`)
  }
}

/**
 * 자물쇠를 잡는다. 다른 작업이 돌고 있으면 예외를 던지고 아무것도 하지 않는다.
 * 돌려주는 함수로 놓는다 — 반드시 finally 에서. 놓지 않으면 앱을 다시 켤 때까지 모든 작업이 막힌다.
 */
export function beginActivity(kind: Activity): () => void {
  if (current === kind) throw new Error(`${SUBJECT[kind]} 이미 진행 중입니다`)
  assertIdle(VERB[kind])
  current = kind
  return () => {
    current = null
  }
}
