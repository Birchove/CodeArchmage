import { describe, it, expect } from "vitest";
import { findCallAt, decideJump } from "@/lib/jump";
import type { CallOut } from "@/api/types";

function call(partial: Partial<CallOut>): CallOut {
  return { callee_name: "foo", callee_id: 1, line: 5, col: 4, ...partial };
}

describe("lib/jump — findCallAt", () => {
  it("精确匹配行+列 → 返回调用点", () => {
    const calls = [call({ line: 5, col: 4, callee_name: "foo" })];
    expect(findCallAt(calls, 5, 4)?.callee_name).toBe("foo");
  });

  it("行匹配但列远超容差 → null", () => {
    const calls = [call({ line: 5, col: 4 })];
    expect(findCallAt(calls, 5, 40)).toBeNull();
  });

  it("无匹配 → null", () => {
    expect(findCallAt([], 1, 0)).toBeNull();
  });

  it("多个调用点 → 返回第一个匹配", () => {
    const calls = [
      call({ callee_name: "a", line: 1, col: 0 }),
      call({ callee_name: "b", line: 2, col: 0 }),
    ];
    expect(findCallAt(calls, 2, 0)?.callee_name).toBe("b");
  });

  // Stage 7a A-3：列容差匹配（UTF-8 字节列 vs UTF-16 列偏移修复）
  it("点击列略小于调用列（中文在前）→ 命中最近的调用点", () => {
    // "# 中文 foo()"：parser 存 UTF-8 字节列，CodeMirror 给 UTF-16 列，
    // 点击位置比记录列小（每个中文字符差 2 列）
    const calls = [call({ callee_name: "foo", line: 5, col: 8 })];
    expect(findCallAt(calls, 5, 6)?.callee_name).toBe("foo");
  });

  it("点击列略大于调用列 → 命中（覆盖反向偏移）", () => {
    const calls = [call({ callee_name: "foo", line: 5, col: 4 })];
    expect(findCallAt(calls, 5, 6)?.callee_name).toBe("foo");
  });

  it("点击列距调用点太远 → null（不误伤相邻调用）", () => {
    const calls = [call({ callee_name: "foo", line: 5, col: 20 })];
    expect(findCallAt(calls, 5, 0)).toBeNull();
  });

  it("同一行两个调用点 → 命中列最近的那个", () => {
    const calls = [
      call({ callee_name: "f", line: 5, col: 0 }),
      call({ callee_name: "g", line: 5, col: 6 }),
    ];
    expect(findCallAt(calls, 5, 5)?.callee_name).toBe("g");
    expect(findCallAt(calls, 5, 1)?.callee_name).toBe("f");
  });

  it("容差随调用名长度伸缩：长名字允许更大偏移", () => {
    // 名字 10 字符 + 容差 → 偏移 11 仍命中；短名字同样偏移则不命中
    const calls = [
      call({ callee_name: "very_long_fn", line: 1, col: 20 }),
      call({ callee_name: "ab", line: 2, col: 20 }),
    ];
    expect(findCallAt(calls, 1, 9)?.callee_name).toBe("very_long_fn");
    expect(findCallAt(calls, 2, 9)).toBeNull();
  });
});

describe("lib/jump — decideJump", () => {
  it("有 callee_id → jump-by-id（精确跳）", () => {
    const action = decideJump(call({ callee_id: 42 }));
    expect(action).toEqual({ type: "jump-by-id", calleeId: 42 });
  });

  it("callee_id 为 null → jump-by-name（名称匹配降级）", () => {
    const action = decideJump(call({ callee_id: null, callee_name: "bar" }));
    expect(action).toEqual({ type: "jump-by-name", calleeName: "bar" });
  });

  it("call 为 null → no-action", () => {
    expect(decideJump(null)).toEqual({ type: "no-action" });
  });
});
