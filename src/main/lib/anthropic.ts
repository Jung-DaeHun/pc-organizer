import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { StructuredCall, StructuredRequest } from './structured'

/**
 * 프로젝트에서 Anthropic SDK 를 import 하는 유일한 파일 (ESLint 가 강제).
 *
 * 여기서는 '문자열을 보내고 스키마에 맞는 값을 받는' 일만 한다.
 * 무엇을 보낼지는 services/advisor.ts 가 정하고, 키는 ipc/handlers.ts 가 넣어준다.
 * 키와 페이로드는 로그에 남기지 않는다.
 */
export const ADVISOR_MODEL = 'claude-opus-5'

export function createStructuredCall(apiKey: string): StructuredCall {
  const client = new Anthropic({ apiKey })

  return async <T>(request: StructuredRequest<T>): Promise<T> => {
    let parsed: T | null | undefined
    let stopReason: string | null

    try {
      const message = await client.messages.parse({
        model: ADVISOR_MODEL,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
        output_config: { format: zodOutputFormat(request.schema) }
      })
      parsed = message.parsed_output
      stopReason = message.stop_reason
    } catch (err) {
      throw toUserError(err)
    }

    if (stopReason === 'refusal') {
      throw new Error('AI가 이 요청에 답하지 않았습니다')
    }
    if (stopReason === 'max_tokens') {
      throw new Error('AI 응답이 잘렸습니다. 항목 수를 줄여 다시 시도하세요')
    }
    if (parsed == null) {
      throw new Error('AI 응답을 해석할 수 없습니다')
    }

    return parsed
  }
}

/** SDK 예외를 화면에 그대로 보여줄 수 있는 한국어 메시지로 바꾼다. 구체적인 것부터 */
function toUserError(err: unknown): Error {
  if (err instanceof Anthropic.AuthenticationError) {
    return new Error('API 키가 올바르지 않습니다')
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new Error('요청 한도를 넘었습니다. 잠시 뒤 다시 시도하세요')
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new Error('Anthropic API에 연결할 수 없습니다. 네트워크를 확인하세요')
  }
  if (err instanceof Anthropic.APIError) {
    return new Error(`Anthropic API 오류 (${err.status ?? '?'}): ${err.message}`)
  }
  return err instanceof Error ? err : new Error(String(err))
}
