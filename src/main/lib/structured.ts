import type { z } from 'zod'

/**
 * '프롬프트를 보내고 스키마에 맞는 JSON 을 받는다'는 계약.
 *
 * 실제 구현은 lib/anthropic.ts 하나뿐이고, 서비스는 이 함수를 인자로 받는다.
 * 그래서 서비스 코드는 SDK 를 모르고, 테스트는 네트워크 없이 가짜를 넣어 돌린다.
 */
export interface StructuredRequest<T> {
  system: string
  user: string
  schema: z.ZodType<T>
  maxTokens: number
}

export type StructuredCall = <T>(request: StructuredRequest<T>) => Promise<T>
