#!/usr/bin/env node
/**
 * git commit 직전에 린트 / 타입 검사 / 테스트 / 빌드를 돌린다.
 *
 * 하나라도 실패하면 커밋 명령 자체를 막는다. 깨진 상태의 커밋이 히스토리에 남으면
 * 나중에 어느 지점이 정상이었는지 되짚기 어려워지기 때문이다.
 *
 * Claude Code 의 PreToolUse 훅으로 붙어 stdin 으로 도구 호출 정보를 받는다.
 * git 자체의 pre-commit 훅이 아니라서, 터미널에서 직접 치는 git 에는 걸리지 않는다.
 */

import { execSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 실패했을 때 보여줄 로그 줄 수. 너무 길면 정작 원인이 위로 밀려 올라간다. */
const LOG_TAIL_LINES = 25

const STEPS = [
  { name: '린트', command: 'npm run lint' },
  { name: '타입 검사', command: 'npm run typecheck' },
  { name: '테스트', command: 'npm test' },
  // npm run build 는 타입 검사를 한 번 더 돈다. 여기서는 번들만 확인한다.
  { name: '빌드', command: 'npx electron-vite build' }
]

/**
 * 명령의 맨 앞이거나 구분자 바로 뒤에 오는 git commit 만 잡는다.
 * 이렇게 하지 않으면 git log --grep="git commit" 같은 명령에도 헛돌아
 * 매번 몇십 초씩 잡아먹는다.
 */
const GIT_COMMIT = /(?:^|[;&|]\s*)git\s+commit\b/

async function main() {
  const payload = await readStdin()

  let command = ''
  try {
    command = JSON.parse(payload)?.tool_input?.command ?? ''
  } catch {
    // 입력을 못 읽었으면 막지 않는다. 훅 때문에 작업이 멈추는 쪽이 더 나쁘다.
    process.exit(0)
  }

  if (!GIT_COMMIT.test(command)) process.exit(0)

  for (const step of STEPS) {
    const failure = run(step)
    if (failure) block(step, failure)
  }

  pass()
}

/** 실패하면 출력 로그를, 성공하면 null 을 돌려준다 */
function run(step) {
  try {
    execSync(step.command, {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      // 훅에서 도는 중이라는 걸 알려, 필요하면 하위 도구가 색상 등을 끌 수 있게
      env: { ...process.env, CI: '1' }
    })
    return null
  } catch (err) {
    const output = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim()
    return output || err.message
  }
}

function block(step, log) {
  const tail = log.split(/\r?\n/).slice(-LOG_TAIL_LINES).join('\n')

  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: [
        `커밋 전 검사에서 '${step.name}' 단계가 실패해 커밋을 막았습니다.`,
        ``,
        `실행한 명령: ${step.command}`,
        ``,
        tail,
        ``,
        `고친 뒤 다시 커밋하세요. 검사를 건너뛰려면 .claude/settings.json 의 훅을 잠시 끄면 됩니다.`
      ].join('\n')
    }
  })
}

function pass() {
  emit({
    systemMessage: `커밋 전 검사 통과 (${STEPS.map((s) => s.name).join(' · ')})`,
    suppressOutput: true
  })
}

function emit(payload) {
  process.stdout.write(JSON.stringify(payload))
  process.exit(0)
}

function readStdin() {
  return new Promise((resolvePayload) => {
    if (process.stdin.isTTY) return resolvePayload('')

    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => (data += chunk))
    process.stdin.on('end', () => resolvePayload(data))
    process.stdin.on('error', () => resolvePayload(''))
  })
}

await main()
