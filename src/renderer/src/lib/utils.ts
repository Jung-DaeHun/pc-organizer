import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** 조건부 클래스 조합 + Tailwind 클래스 충돌 정리 (shadcn/ui 규약) */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
