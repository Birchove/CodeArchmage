import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CallGraph } from "@/components/CallGraph";
import type { SymbolOut } from "@/api/types";

// Mock @xyflow/react — jsdom 不支持 ResizeObserver 等 Web API
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({
    nodes,
    onNodeClick,
  }: {
    nodes: Array<{
      id: string;
      data: { label: string; symbol: SymbolOut; isCenter: boolean };
      className?: string;
    }>;
    onNodeClick?: (e: unknown, node: unknown) => void;
  }) => (
    <div data-testid="react-flow">
      {nodes.map((n) => (
        <button
          key={n.id}
          data-testid={`node-${n.id}`}
          data-center={n.data.isCenter ? "true" : "false"}
          onClick={(e) => onNodeClick?.(e, n)}
        >
          {n.data.label}
        </button>
      ))}
    </div>
  ),
  Background: () => null,
  Controls: () => null,
}));

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

function renderCallGraph(
  center: SymbolOut,
  callers: SymbolOut[] = [],
  callees: SymbolOut[] = [],
  onNodeSelect = vi.fn(),
) {
  return render(
    <CallGraph
      center={center}
      callers={callers}
      callees={callees}
      onNodeSelect={onNodeSelect}
    />,
  );
}

describe("CallGraph — 循环 8", () => {
  it("只有 center（无 callers/callees）→ 空状态", () => {
    const center = makeSym({ id: 1, name: "main" });
    renderCallGraph(center);
    expect(screen.getByText(/选中符号后显示调用关系/i)).toBeInTheDocument();
  });

  it("center + callers + callees → 渲染所有节点", () => {
    const center = makeSym({ id: 1, name: "process" });
    const callers = [makeSym({ id: 10, name: "main" })];
    const callees = [makeSym({ id: 20, name: "validate" })];
    renderCallGraph(center, callers, callees);

    expect(screen.getByTestId("react-flow")).toBeInTheDocument();
    expect(screen.getByTestId("node-sym-1")).toBeInTheDocument();
    expect(screen.getByTestId("node-sym-10")).toBeInTheDocument();
    expect(screen.getByTestId("node-sym-20")).toBeInTheDocument();
  });

  it("中心节点标记 data-center=true", () => {
    const center = makeSym({ id: 1, name: "process" });
    const callers = [makeSym({ id: 10, name: "main" })];
    renderCallGraph(center, callers);

    expect(screen.getByTestId("node-sym-1")).toHaveAttribute(
      "data-center",
      "true",
    );
    expect(screen.getByTestId("node-sym-10")).toHaveAttribute(
      "data-center",
      "false",
    );
  });

  it("诚实提示文案存在", () => {
    const center = makeSym({ id: 1, name: "process" });
    const callers = [makeSym({ id: 10, name: "main" })];
    renderCallGraph(center, callers);

    expect(screen.getByText(/按名匹配.*可能不准/i)).toBeInTheDocument();
  });
});

describe("CallGraph — 循环 9 节点点击", () => {
  it("点击节点 → onNodeSelect 被调用", () => {
    const center = makeSym({ id: 1, name: "process" });
    const callers = [makeSym({ id: 10, name: "main" })];
    const onNodeSelect = vi.fn();
    renderCallGraph(center, callers, [], onNodeSelect);

    fireEvent.click(screen.getByTestId("node-sym-10"));
    expect(onNodeSelect).toHaveBeenCalledWith(callers[0]);
  });

  it("点击中心节点 → onNodeSelect 被调用", () => {
    const center = makeSym({ id: 1, name: "process" });
    const callers = [makeSym({ id: 10, name: "main" })];
    const onNodeSelect = vi.fn();
    renderCallGraph(center, callers, [], onNodeSelect);

    fireEvent.click(screen.getByTestId("node-sym-1"));
    expect(onNodeSelect).toHaveBeenCalledWith(center);
  });
});
