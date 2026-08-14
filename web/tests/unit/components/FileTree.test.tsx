import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileTree } from "@/components/FileTree";
import { buildTree, type TreeNode } from "@/lib/tree";

function treeOf(...paths: string[]): TreeNode[] {
  return buildTree(paths);
}

describe("FileTree — 渲染", () => {
  it('空树显示"无文件"提示', () => {
    render(<FileTree nodes={[]} onSelect={vi.fn()} />);
    expect(screen.getByText(/无文件/)).toBeInTheDocument();
  });

  it("渲染顶层文件 + 文件夹", () => {
    render(<FileTree nodes={treeOf("main.py", "pkg/helper.py")} />);
    expect(screen.getByText("main.py")).toBeInTheDocument();
    expect(screen.getByText("pkg")).toBeInTheDocument();
    // 子文件默认折叠，不显示
    expect(screen.queryByText("helper.py")).not.toBeInTheDocument();
  });
});

describe("FileTree — 交互", () => {
  it("点文件夹 → 展开/折叠子项", () => {
    render(<FileTree nodes={treeOf("pkg/helper.py")} onSelect={vi.fn()} />);
    const pkg = screen.getByText("pkg");
    // 初始折叠
    expect(screen.queryByText("helper.py")).not.toBeInTheDocument();
    // 展开
    fireEvent.click(pkg);
    expect(screen.getByText("helper.py")).toBeInTheDocument();
    // 再折叠
    fireEvent.click(pkg);
    expect(screen.queryByText("helper.py")).not.toBeInTheDocument();
  });

  it("点文件 → 触发 onSelect(path)", () => {
    const onSelect = vi.fn();
    render(
      <FileTree
        nodes={treeOf("main.py", "pkg/helper.py")}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByText("main.py"));
    expect(onSelect).toHaveBeenCalledWith("main.py");
  });

  it("展开后点子文件 → 触发 onSelect(完整路径)", () => {
    const onSelect = vi.fn();
    render(<FileTree nodes={treeOf("pkg/helper.py")} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("pkg"));
    fireEvent.click(screen.getByText("helper.py"));
    expect(onSelect).toHaveBeenCalledWith("pkg/helper.py");
  });

  it("可点击项为 button（a11y O-6）", () => {
    render(<FileTree nodes={treeOf("main.py")} onSelect={vi.fn()} />);
    const item = screen.getByText("main.py").closest("button");
    expect(item).not.toBeNull();
    expect(item).toHaveAttribute("type", "button");
  });
});
