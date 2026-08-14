/**
 * 测试全局 setup：注册 jest-dom matchers + 自动清理 DOM。
 */
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// CodeMirror 6 需要 ResizeObserver（jsdom 无原生实现）
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

// 每个 test 后自动清理 DOM，避免渲染叠加
afterEach(() => {
  cleanup();
});
