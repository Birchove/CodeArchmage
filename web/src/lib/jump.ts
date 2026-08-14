/**
 * 跳定义纯逻辑（可单元测试；coordsAtPos 反查留 E2E）。
 *
 * 决策 10：
 * - 命中且有 callee_id → 精确跳（jump-by-id）
 * - 命中但 callee_id 为 null → 名称匹配降级（jump-by-name）
 * - 未命中 → 无动作
 */

import type { CallOut } from "@/api/types";

/**
 * 在调用点列表中查找匹配行+列的调用。
 *
 * 已知限制（B-6）：parser 的 col 是 tree-sitter 字节偏移，
 * 前端 CodeView 给的是 JS UTF-16 code-unit 偏移。
 * 含非 ASCII 的行（中文注释）两者不等，点击可能匹配不到。
 * 阶段 5 修：字节偏移转码点偏移，或前端做 ±N 列容差匹配。
 */
export function findCallAt(
  calls: CallOut[],
  line: number,
  col: number,
): CallOut | null {
  return calls.find((c) => c.line === line && c.col === col) ?? null;
}

export type JumpAction =
  | { type: "jump-by-id"; calleeId: number }
  | { type: "jump-by-name"; calleeName: string }
  | { type: "no-action" };

/** 根据调用点决定跳转动作。 */
export function decideJump(call: CallOut | null): JumpAction {
  if (!call) return { type: "no-action" };
  if (call.callee_id !== null)
    return { type: "jump-by-id", calleeId: call.callee_id };
  return { type: "jump-by-name", calleeName: call.callee_name };
}
