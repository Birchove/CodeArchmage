import { describe, it, expect } from "vitest";
import { buildCallGraph } from "@/lib/callgraph";
import type { SymbolOut } from "@/api/types";

function makeSym(overrides: Partial<SymbolOut> = {}): SymbolOut {
  return {
    id: 1,
    name: "test",
    kind: "function",
    file_path: "test.py",
    line: 1,
    col: 0,
    end_line: 2,
    ...overrides,
  };
}

describe("buildCallGraph — 循环 7", () => {
  it("只有 center → 1 个节点 0 条边", () => {
    const center = makeSym({ id: 1, name: "main" });
    const { nodes, edges } = buildCallGraph(center, [], []);
    expect(nodes).toHaveLength(1);
    expect(edges).toHaveLength(0);
    expect(nodes[0].data.isCenter).toBe(true);
    expect(nodes[0].data.label).toBe("main");
  });

  it("center + 2 callers + 2 callees → 5 节点 4 边", () => {
    const center = makeSym({ id: 1, name: "process" });
    const callers = [
      makeSym({ id: 10, name: "main" }),
      makeSym({ id: 11, name: "cli_run" }),
    ];
    const callees = [
      makeSym({ id: 20, name: "validate" }),
      makeSym({ id: 21, name: "transform" }),
    ];
    const { nodes, edges } = buildCallGraph(center, callers, callees);

    expect(nodes).toHaveLength(5);
    expect(edges).toHaveLength(4);

    // center 在中列 (x=200)
    const centerNode = nodes.find((n) => n.data.isCenter);
    expect(centerNode?.position.x).toBe(200);

    // callers 在左列 (x=0)
    const callerNodes = nodes.filter(
      (n) => !n.data.isCenter && n.position.x === 0,
    );
    expect(callerNodes).toHaveLength(2);

    // callees 在右列 (x=400)
    const calleeNodes = nodes.filter(
      (n) => !n.data.isCenter && n.position.x === 400,
    );
    expect(calleeNodes).toHaveLength(2);
  });

  it("边方向：caller → center → callee", () => {
    const center = makeSym({ id: 1, name: "process" });
    const callers = [makeSym({ id: 10, name: "main" })];
    const callees = [makeSym({ id: 20, name: "validate" })];
    const { edges } = buildCallGraph(center, callers, callees);

    // caller → center
    expect(edges).toContainEqual({
      id: "edge-10-1",
      source: "sym-10",
      target: "sym-1",
    });
    // center → callee
    expect(edges).toContainEqual({
      id: "edge-1-20",
      source: "sym-1",
      target: "sym-20",
    });
  });

  it("空 callers/callees → 只有 center", () => {
    const center = makeSym({ id: 1, name: "main" });
    const { nodes, edges } = buildCallGraph(center, [], []);
    expect(nodes).toHaveLength(1);
    expect(edges).toHaveLength(0);
  });

  it("节点 id 唯一（sym-{id}）", () => {
    const center = makeSym({ id: 1, name: "a" });
    const callers = [makeSym({ id: 2, name: "b" })];
    const callees = [makeSym({ id: 3, name: "c" })];
    const { nodes } = buildCallGraph(center, callers, callees);
    const ids = nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("单个 caller → y=0（不偏移）", () => {
    const center = makeSym({ id: 1, name: "a" });
    const callers = [makeSym({ id: 2, name: "b" })];
    const { nodes } = buildCallGraph(center, callers, []);
    const callerNode = nodes.find((n) => n.id === "sym-2");
    expect(callerNode?.position.y).toBe(0);
  });

  it("多个 callers → 围绕 y=0 对称分布", () => {
    const center = makeSym({ id: 1, name: "a" });
    const callers = [
      makeSym({ id: 2, name: "b" }),
      makeSym({ id: 3, name: "c" }),
    ];
    const { nodes } = buildCallGraph(center, callers, []);
    const ys = nodes.filter((n) => n.position.x === 0).map((n) => n.position.y);
    // 两个 callers → y = -40 和 +40
    expect(ys).toContain(-40);
    expect(ys).toContain(40);
  });
});
