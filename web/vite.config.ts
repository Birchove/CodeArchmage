/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // 测试环境：组件测试需要 DOM
    environment: 'jsdom',
    // 全局 setup（jest-dom matchers 等）
    setupFiles: ['./src/test/setup.ts'],
    // 默认跑 unit 下的测试；E2E 由 playwright 独立跑
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    // 排除 E2E（由 @playwright/test 独立运行）
    exclude: ['node_modules', 'tests/e2e'],
    // 覆盖率
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', 'src/main.tsx', 'src/vite-env.d.ts'],
    },
  },
})
