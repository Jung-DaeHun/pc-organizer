import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    // 대상이 파일시스템 로직이라 DOM은 필요 없다
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
})
