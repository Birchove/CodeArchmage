import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SymbolOutline } from "@/components/SymbolOutline";
import type { SymbolOut } from "@/api/types";

function sym(partial: Partial<SymbolOut>): SymbolOut {
  return {
    id: 1,
    name: "foo",
    kind: "function",
    file_path: "a.py",
    line: 1,
    col: 0,
    end_line: 3,
    signature: "def foo()",
    bases: [],
    decorators: [],
    ...partial,
  };
}

describe("SymbolOutline — 渲染", () => {
  it('空列表显示"无符号"', () => {
    render(<SymbolOutline symbols={[]} onSelect={vi.fn()} />);
    expect(screen.getByText(/无符号/)).toBeInTheDocument();
  });

  it("渲染符号列表（名字 + kind）", () => {
    const symbols = [
      sym({ id: 1, name: "foo", kind: "function", line: 1 }),
      sym({ id: 2, name: "Bar", kind: "class", line: 10 }),
    ];
    render(<SymbolOutline symbols={symbols} onSelect={vi.fn()} />);
    expect(screen.getByText("foo")).toBeInTheDocument();
    expect(screen.getByText("Bar")).toBeInTheDocument();
    // kind 标记可见
    expect(screen.getByText(/function/i)).toBeInTheDocument();
    expect(screen.getByText(/class/i)).toBeInTheDocument();
  });

  it("按行号排序显示", () => {
    const symbols = [
      sym({ id: 2, name: "second", line: 20 }),
      sym({ id: 1, name: "first", line: 5 }),
    ];
    render(<SymbolOutline symbols={symbols} onSelect={vi.fn()} />);
    const items = screen.getAllByRole("button");
    expect(items[0]).toHaveTextContent("first");
    expect(items[1]).toHaveTextContent("second");
  });
});

describe("SymbolOutline — 交互", () => {
  it("点符号 → 触发 onSelect(symbol)", () => {
    const onSelect = vi.fn();
    const target = sym({ id: 5, name: "target", line: 42 });
    render(<SymbolOutline symbols={[target]} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("target"));
    expect(onSelect).toHaveBeenCalledWith(target);
  });

  it("可点击项为 button（a11y O-6）", () => {
    render(
      <SymbolOutline symbols={[sym({ name: "foo" })]} onSelect={vi.fn()} />,
    );
    const btn = screen.getByText("foo").closest("button");
    expect(btn).not.toBeNull();
    expect(btn).toHaveAttribute("type", "button");
  });
});
