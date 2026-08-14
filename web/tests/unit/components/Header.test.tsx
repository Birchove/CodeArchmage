import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Header } from "@/components/Header";

describe("Header — 渲染", () => {
  it("显示仓库名 + 索引状态", () => {
    render(
      <Header
        repoRoot="/tmp/myrepo"
        indexStatus="idle"
        isIndexing={false}
        onTriggerIndex={vi.fn()}
      />,
    );
    expect(screen.getByText("/tmp/myrepo")).toBeInTheDocument();
    expect(screen.getByText(/未索引|idle/i)).toBeInTheDocument();
  });

  it("索引完成状态显示文件数", () => {
    render(
      <Header
        repoRoot="/tmp/myrepo"
        indexStatus="indexed"
        fileCount={42}
        isIndexing={false}
        onTriggerIndex={vi.fn()}
      />,
    );
    expect(screen.getByText(/42/)).toBeInTheDocument();
  });
});

describe("Header — 索引按钮", () => {
  it("显示索引按钮", () => {
    render(
      <Header
        repoRoot="/r"
        indexStatus="idle"
        isIndexing={false}
        onTriggerIndex={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /索引/i })).toBeInTheDocument();
  });

  it("点击 → 触发 onTriggerIndex", () => {
    const onTrigger = vi.fn();
    render(
      <Header
        repoRoot="/r"
        indexStatus="idle"
        isIndexing={false}
        onTriggerIndex={onTrigger}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /索引/i }));
    expect(onTrigger).toHaveBeenCalledOnce();
  });

  it('索引中 → 按钮 disabled + "索引中…"（S-4）', () => {
    render(
      <Header
        repoRoot="/r"
        indexStatus="idle"
        isIndexing={true}
        onTriggerIndex={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent(/索引中/i);
  });

  it("indexError → 显示错误文案（B-3：409 互斥）", () => {
    render(
      <Header
        repoRoot="/r"
        indexStatus="idle"
        isIndexing={false}
        indexError="索引正在进行中"
        onTriggerIndex={vi.fn()}
      />,
    );
    expect(screen.getByText("索引正在进行中")).toBeInTheDocument();
  });
});
