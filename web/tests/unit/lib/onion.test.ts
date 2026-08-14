import { describe, it, expect } from "vitest";
import { flattenCallChain } from "@/lib/onion";
import type { SymbolOut } from "@/api/types";

function makeSym(id: number, name: string): SymbolOut {
  return {
    id,
    name,
    kind: "function",
    file_path: `${name}.py`,
    line: id * 10,
    col: 0,
    end_line: id * 10 + 5,
  };
}

describe("flattenCallChain — 循环 11 基础", () => {
  it("无 callers → 单条路径 [target]", () => {
    const target = makeSym(1, "main");
    const map = new Map<number, SymbolOut[]>();
    const { paths, truncated } = flattenCallChain(target, map);
    expect(paths).toHaveLength(1);
    expect(paths[0].symbols).toEqual([target]);
    expect(truncated).toBe(false);
  });

  it("单路径 A→B→C（C 是 target）", () => {
    const a = makeSym(1, "entry");
    const b = makeSym(2, "middle");
    const c = makeSym(3, "target");
    const map = new Map([
      [3, [b]], // C 的 caller 是 B
      [2, [a]], // B 的 caller 是 A
      [1, []], // A 是入口
    ]);
    const { paths, truncated } = flattenCallChain(c, map);
    expect(paths).toHaveLength(1);
    expect(paths[0].symbols).toEqual([a, b, c]);
    expect(truncated).toBe(false);
  });

  it("多路径：target 有两个 callers，各自有入口", () => {
    const entry1 = makeSym(1, "entry1");
    const entry2 = makeSym(2, "entry2");
    const caller1 = makeSym(3, "caller1");
    const caller2 = makeSym(4, "caller2");
    const target = makeSym(5, "target");
    const map = new Map([
      [5, [caller1, caller2]],
      [3, [entry1]],
      [4, [entry2]],
      [1, []],
      [2, []],
    ]);
    const { paths } = flattenCallChain(target, map);
    expect(paths).toHaveLength(2);
    // 路径 1: entry1 → caller1 → target
    expect(paths[0].symbols).toEqual([entry1, caller1, target]);
    // 路径 2: entry2 → caller2 → target
    expect(paths[1].symbols).toEqual([entry2, caller2, target]);
  });
});

describe("flattenCallChain — 循环 11 限制", () => {
  it("maxDepth=2 → 超过 2 层截断 + truncated=true", () => {
    const a = makeSym(1, "a");
    const b = makeSym(2, "b");
    const c = makeSym(3, "c");
    const d = makeSym(4, "d");
    const map = new Map([
      [4, [c]],
      [3, [b]],
      [2, [a]],
      [1, []],
    ]);
    const { paths, truncated } = flattenCallChain(d, map, { maxDepth: 2 });
    expect(truncated).toBe(true);
    // 深度 2 → 路径最多 3 个节点（d, c, b），b 的 callers 被截断
    expect(paths[0].symbols.length).toBeLessThanOrEqual(3);
  });

  it("maxWidth=1 → 每层只取第 1 个 caller", () => {
    const caller1 = makeSym(1, "c1");
    const caller2 = makeSym(2, "c2");
    const target = makeSym(3, "target");
    const map = new Map([
      [3, [caller1, caller2]],
      [1, []],
      [2, []],
    ]);
    const { paths } = flattenCallChain(target, map, { maxWidth: 1 });
    expect(paths).toHaveLength(1);
    expect(paths[0].symbols).toEqual([caller1, target]);
  });

  it("maxTotal=1 → 超过 1 条路径 → truncated=true", () => {
    const c1 = makeSym(1, "c1");
    const c2 = makeSym(2, "c2");
    const target = makeSym(3, "target");
    const map = new Map([
      [3, [c1, c2]],
      [1, []],
      [2, []],
    ]);
    const { paths, truncated } = flattenCallChain(target, map, { maxTotal: 1 });
    expect(truncated).toBe(true);
    expect(paths).toHaveLength(1);
  });
});

describe("flattenCallChain — 循环 11 环/自环", () => {
  it("自环（A 调 A）→ 跳过", () => {
    const a = makeSym(1, "a");
    const target = makeSym(2, "target");
    // target 的 callers = [a, target]（target 调自己）
    const map = new Map([
      [2, [a, target]],
      [1, []],
    ]);
    const { paths } = flattenCallChain(target, map);
    // target 调自己 → 跳过自环 → 只通过 a 追溯
    expect(paths).toHaveLength(1);
    expect(paths[0].symbols).toEqual([a, target]);
  });

  it("环 A→B→A → 跳过", () => {
    const a = makeSym(1, "a");
    const b = makeSym(2, "b");
    const target = makeSym(3, "target");
    // target ← b ← a ← b（环）
    const map = new Map([
      [3, [b]],
      [2, [a]],
      [1, [b]], // a 的 caller 是 b（环回）
    ]);
    const { paths } = flattenCallChain(target, map);
    expect(paths).toHaveLength(1);
    // 路径：b → a 被截断（因为 a 的 caller b 已访问）
    // 实际：target ← b ← a，a 的 callers = [b]，但 b 已在 visited 中 → 跳过
    // 所以路径 = [a, b, target]（a 作为入口）
    expect(paths[0].symbols).toEqual([a, b, target]);
  });
});
