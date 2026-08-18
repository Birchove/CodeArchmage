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
    mode: "read" as const,
    onModeChange: vi.fn(),
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

  it("已索引 → 按钮文案为「重新索引」（A-5）", () => {
    renderHeader({ indexStatus: "indexed", fileCount: 5 });
    expect(
      screen.getByRole("button", { name: /重新索引/i }),
    ).toBeInTheDocument();
  });
});

describe("Header — 索引统计（Stage 7a A-5）", () => {
  it("lastIndex → 显示「更新 X / 跳过 Y」", () => {
    renderHeader({
      indexStatus: "indexed",
      fileCount: 10,
      lastIndex: {
        files_total: 10,
        files_updated: 2,
        files_skipped: 8,
        duration_ms: 100,
      },
    });
    expect(screen.getByText(/更新 2/)).toBeInTheDocument();
    expect(screen.getByText(/跳过 8/)).toBeInTheDocument();
  });

  it("无 lastIndex → 不显示统计明细", () => {
    renderHeader({ indexStatus: "indexed", fileCount: 10 });
    expect(screen.queryByText(/更新/)).not.toBeInTheDocument();
  });
});

describe("Header — 阅读/导读模式切换（Stage 7b）", () => {
  it("渲染分段控件：阅读 / 导读", () => {
    renderHeader();
    expect(screen.getByRole("button", { name: "阅读" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导读" })).toBeInTheDocument();
  });

  it("当前模式高亮（aria-pressed）", () => {
    renderHeader({ mode: "guide" });
    expect(screen.getByRole("button", { name: "导读" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "阅读" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("点击导读 → onModeChange('guide')", () => {
    const onModeChange = vi.fn();
    renderHeader({ onModeChange });
    fireEvent.click(screen.getByRole("button", { name: "导读" }));
    expect(onModeChange).toHaveBeenCalledWith("guide");
  });

  it("mode=guide 时点击阅读 → onModeChange('read')", () => {
    const onModeChange = vi.fn();
    renderHeader({ mode: "guide", onModeChange });
    fireEvent.click(screen.getByRole("button", { name: "阅读" }));
    expect(onModeChange).toHaveBeenCalledWith("read");
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
