import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/test-utils";
import { Header } from "@/components/Header";

function renderHeader(overrides: Record<string, unknown> = {}) {
  const props = {
    repoRoot: "/tmp/myrepo",
    indexStatus: "idle" as const,
    isIndexing: false,
    onTriggerIndex: vi.fn(),
    isSearchEnabled: false,
    onSearchSelect: vi.fn(),
    ...overrides,
  };
  return renderWithQueryClient(<Header {...props} />);
}

describe("Header — 渲染", () => {
  it("显示仓库名 + 索引状态", () => {
    renderHeader();
    expect(screen.getByText("/tmp/myrepo")).toBeInTheDocument();
    expect(screen.getByText(/未索引|idle/i)).toBeInTheDocument();
  });

  it("索引完成状态显示文件数", () => {
    renderHeader({ indexStatus: "indexed", fileCount: 42 });
    expect(screen.getByText(/42/)).toBeInTheDocument();
  });
});

describe("Header — 索引按钮", () => {
  it("显示索引按钮", () => {
    renderHeader();
    expect(screen.getByRole("button", { name: /索引/i })).toBeInTheDocument();
  });

  it("点击 → 触发 onTriggerIndex", () => {
    const onTrigger = vi.fn();
    renderHeader({ onTriggerIndex: onTrigger });
    fireEvent.click(screen.getByRole("button", { name: /索引/i }));
    expect(onTrigger).toHaveBeenCalledOnce();
  });

  it('索引中 → 按钮 disabled + "索引中…"（S-4）', () => {
    renderHeader({ isIndexing: true });
    const btn = screen.getByRole("button", { name: /索引/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent(/索引中/i);
  });

  it("indexError → 显示错误文案（B-3：409 互斥）", () => {
    renderHeader({ indexError: "索引正在进行中" });
    expect(screen.getByText("索引正在进行中")).toBeInTheDocument();
  });
});

describe("Header — 阶段 5 搜索框嵌入", () => {
  it("渲染搜索输入框", () => {
    renderHeader({ isSearchEnabled: true });
    expect(
      screen.getByRole("combobox", { name: /搜索符号/i }),
    ).toBeInTheDocument();
  });

  it("isSearchEnabled=false → 搜索框禁用", () => {
    renderHeader({ isSearchEnabled: false });
    expect(screen.getByRole("combobox", { name: /搜索符号/i })).toBeDisabled();
  });
});
