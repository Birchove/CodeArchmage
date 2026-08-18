/**
 * CandidatePicker（Stage 7a A-1）。
 *
 * 多候选跳转的选择浮层：同名符号有多个定义时，列出候选让用户点选，
 * 替代原来的静默失败。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CandidatePicker } from "@/components/CandidatePicker";
import { makeSymbol } from "@/test/msw-handlers";

const candidates = [
  makeSymbol({
    id: 1,
    name: "dup",
    kind: "function",
    file_path: "src/a.py",
    line: 10,
    signature: "dup(x)",
  }),
  makeSymbol({
    id: 2,
    name: "dup",
    kind: "method",
    file_path: "pkg/b.py",
    line: 30,
    signature: "dup(self, y)",
  }),
];

describe("CandidatePicker — 渲染", () => {
  it("candidates 为 null → 不渲染", () => {
    const { container } = render(
      <CandidatePicker candidates={null} onPick={vi.fn()} onClose={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("渲染标题 + 每个候选（名字 + 文件:行 + 签名）", () => {
    render(
      <CandidatePicker
        candidates={candidates}
        onPick={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getAllByText("dup")).toHaveLength(2);
    expect(screen.getByText(/src\/a.py:10/)).toBeInTheDocument();
    expect(screen.getByText(/pkg\/b.py:30/)).toBeInTheDocument();
    expect(screen.getByText("dup(self, y)")).toBeInTheDocument();
  });
});

describe("CandidatePicker — 交互", () => {
  it("点击候选 → onPick(该符号)", () => {
    const onPick = vi.fn();
    render(
      <CandidatePicker
        candidates={candidates}
        onPick={onPick}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("dup(self, y)"));
    expect(onPick).toHaveBeenCalledWith(candidates[1]);
  });

  it("点击关闭 → onClose", () => {
    const onClose = vi.fn();
    render(
      <CandidatePicker
        candidates={candidates}
        onPick={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /关闭/ }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("点遮罩背景 → onClose（点候选区域不关）", () => {
    const onClose = vi.fn();
    render(
      <CandidatePicker
        candidates={candidates}
        onPick={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByText(/点击跳转/)); // 对话框内容
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(document.querySelector(".candidate-backdrop")!);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
