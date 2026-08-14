import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EmptyState } from "@/components/EmptyState";

describe("EmptyState", () => {
  it("显示引导文案（兼容未索引/无 .py，B-4）", () => {
    render(<EmptyState onTriggerIndex={vi.fn()} />);
    expect(screen.getByText(/尚未索引|无 Python 文件/i)).toBeInTheDocument();
  });

  it("显示索引按钮", () => {
    render(<EmptyState onTriggerIndex={vi.fn()} />);
    expect(screen.getByRole("button", { name: /索引/i })).toBeInTheDocument();
  });

  it("点击 → 触发 onTriggerIndex", () => {
    const onTrigger = vi.fn();
    render(<EmptyState onTriggerIndex={onTrigger} />);
    fireEvent.click(screen.getByRole("button", { name: /索引/i }));
    expect(onTrigger).toHaveBeenCalledOnce();
  });
});
