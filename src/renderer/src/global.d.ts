import type { RendererApi } from '@shared/api'

declare global {
  interface Window {
    /** preload가 contextBridge로 붙여준 다리. 이것 말고는 main에 닿을 방법이 없다. */
    api: RendererApi
  }
}

export {}
