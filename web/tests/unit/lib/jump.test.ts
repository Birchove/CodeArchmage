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

  it("行匹配但列不匹配 → null", () => {
    const calls = [call({ line: 5, col: 4 })];
    expect(findCallAt(calls, 5, 0)).toBeNull();
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
