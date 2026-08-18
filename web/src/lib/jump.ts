/**
 * 跳定义纯逻辑（可单元测试；coordsAtPos 反查留 E2E）。
 *
 * 决策 10：
 * - 命中且有 callee_id → 精确跳（jump-by-id）
 * - 命中但 callee_id 为 null → 名称匹配降级（jump-by-name）
 * - 未命中 → 无动作
 */

import type { CallOut } from "@/api/types";

/** 点击位置与调用点列的基础容差（A-3）。 */
const TOLERANCE_BASE = 2;

/**
 * 在调用点列表中查找与点击位置匹配的调用（Stage 7a A-3 列容差匹配）。
 *
 * 背景（B-6 修复）：parser 的 col 是 tree-sitter UTF-8 字节偏移，
 * 前端 CodeView 给的是 JS UTF-16 code-unit 偏移。含非 ASCII 的行
 * （中文注释/字符串很常见）两者不等，精确匹配会漏。
 *
 * 规则：同一行内，取满足 |点击列 - 调用列| ≤ 名字长度 + 基础容差
 * 的最近调用点；都不满足 → null。名字越长容差越大（覆盖
 * 长名字内部的点击），短名字不误伤相邻调用。
 */
export function findCallAt(
  calls: CallOut[],
  line: number,
  col: number,
): CallOut | null {
  let best: CallOut | null = null;
  let bestDist = Infinity;
  for (const c of calls) {
    if (c.line !== line) continue;
    const dist = Math.abs(col - c.col);
    if (dist <= c.callee_name.length + TOLERANCE_BASE && dist < bestDist) {
      best = c;
      bestDist = dist;
    }
  }
  return best;
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
