import { useCallback, useState } from 'react'

/** 카드에 이름 말고 무엇을 더 보여줄지. 이름(과 폴더의 파일 수)은 항상 보인다 */
export interface CardFields {
  size: boolean
  mtime: boolean
  category: boolean
  reason: boolean
}

export const CARD_FIELD_LABELS: Record<keyof CardFields, string> = {
  size: '크기',
  mtime: '수정일',
  category: '종류',
  reason: '이유'
}

const DEFAULT_FIELDS: CardFields = { size: true, mtime: false, category: false, reason: true }
const STORAGE_KEY = 'plan.cardFields'

function load(): CardFields {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_FIELDS
    const parsed = JSON.parse(raw) as Partial<Record<keyof CardFields, unknown>>
    // 모르는 키는 버리고, 불리언이 아닌 값은 기본값으로
    const next = { ...DEFAULT_FIELDS }
    for (const key of Object.keys(DEFAULT_FIELDS) as (keyof CardFields)[]) {
      if (typeof parsed[key] === 'boolean') next[key] = parsed[key] as boolean
    }
    return next
  } catch {
    return DEFAULT_FIELDS
  }
}

/** 화면 취향은 renderer 의 localStorage 에 둔다. main 의 settings.json 은 스캔·정리 동작에만 쓴다 */
export function useCardFields(): [CardFields, (key: keyof CardFields, value: boolean) => void] {
  const [fields, setFields] = useState<CardFields>(load)

  const setField = useCallback((key: keyof CardFields, value: boolean) => {
    setFields((current) => {
      const next = { ...current, [key]: value }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // 저장이 안 돼도 이번 세션 동안은 유지된다
      }
      return next
    })
  }, [])

  return [fields, setField]
}
