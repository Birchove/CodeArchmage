/**
 * 剥洋葱纯函数（阶段 5 循环 11）。
 *
 * 从目标符号向上递归追溯 callers，展平成「入口 → ... → 目标」的路径[]。
 *
 * 三重限制（cc B-5/B-6）：
 *   maxDepth=5   调用链最大层数
 *   maxWidth=10  每层最多取前 10 个 callers（后端已 ORDER BY file_path, line）
 *   maxTotal=50  最多 50 条路径（非节点数）
 *
 * cc S-2 已知限制：
 *   callers 按名匹配，同名符号的调用者会合并。
 *   方法符号（如 calc.add）的 callers 可能包含其他类的同名方法调用者。
 *   自环（A 调 A）和环（A→B→A）通过 visited 集合跳过。
 */

import type { SymbolOut } from "@/api/types";

export interface CallChainPath {
  /** 从入口（index 0）到目标（index -1）的有序符号列表。 */
  symbols: SymbolOut[];
}

export interface FlattenResult {
  paths: CallChainPath[];
  truncated: boolean;
}

const DEFAULT_MAX_DEPTH = 5;
const DEFAULT_MAX_WIDTH = 10;
const DEFAULT_MAX_TOTAL = 50;

export function flattenCallChain(
  target: SymbolOut,
  callersMap: Map<number, SymbolOut[]>,
  options: {
    maxDepth?: number;
    maxWidth?: number;
    maxTotal?: number;
  } = {},
): FlattenResult {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxWidth = options.maxWidth ?? DEFAULT_MAX_WIDTH;
  const maxTotal = options.maxTotal ?? DEFAULT_MAX_TOTAL;

  const paths: CallChainPath[] = [];
  let truncated = false;

  function dfs(
    current: SymbolOut,
    reversePath: SymbolOut[],
    visited: Set<number>,
    depth: number,
  ): void {
    if (paths.length >= maxTotal) {
      truncated = true;
      return;
    }

    const callers = (callersMap.get(current.id) ?? []).slice(0, maxWidth);
    // 过滤已访问的 callers（环/自环跳过）
    const validCallers = callers.filter((c) => !visited.has(c.id));

    if (validCallers.length === 0 || depth >= maxDepth) {
      if (depth >= maxDepth && callers.length > 0) truncated = true;
      // reversePath = [target, ..., entry] → 反转 = [entry, ..., target]
      paths.push({ symbols: [...reversePath].reverse() });
      return;
    }

    for (const caller of validCallers) {
      dfs(
        caller,
        [...reversePath, caller],
        new Set(visited).add(caller.id),
        depth + 1,
      );
    }
  }

  dfs(target, [target], new Set([target.id]), 0);

  return { paths, truncated };
}
