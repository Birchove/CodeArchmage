/**
 * Smoke test — 验证 vitest + React Testing Library 链路畅通。
 * 阶段 0 的唯一前端测试目标：确认测试框架能跑、组件能渲染。
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../../src/App'

describe('App smoke test', () => {
  it('渲染标题', () => {
    render(<App />)
    expect(screen.getByText('Code Archmage')).toBeInTheDocument()
  })

  it('渲染说明文字', () => {
    render(<App />)
    expect(screen.getByText(/只读源码拆解浏览器/)).toBeInTheDocument()
  })
})
