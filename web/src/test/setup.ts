/**
 * 测试全局 setup：注册 jest-dom matchers + 自动清理 DOM。
 */
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// 每个 test 后自动清理 DOM，避免渲染叠加
afterEach(() => {
  cleanup()
})
