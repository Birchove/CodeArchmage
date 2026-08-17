import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { CodeView, type CodeViewHandle } from "@/components/CodeView";

describe("CodeView — 基础渲染", () => {
  it("小文件挂载 CodeMirror（.cm-content 存在）", () => {
    const { container } = render(<CodeView content={"x = 1\ny = 2\n"} />);
    expect(container.querySelector(".cm-content")).not.toBeNull();
  });

  it("显示传入的代码文本", () => {
    const { container } = render(
      <CodeView content={"def hello():\n    pass\n"} />,
    );
    // CodeMirror 在 jsdom 中将文本渲染到 .cm-line 里
    const lines = container.querySelectorAll(".cm-line");
    expect(lines.length).toBeGreaterThan(0);
    expect(container.textContent).toContain("def hello");
    expect(container.textContent).toContain("pass");
  });

  it("挂载成功（readOnly 配置在源码中，编辑行为留 E2E）", () => {
    const { container } = render(<CodeView content="x = 1" />);
    // CodeMirror 挂载成功即说明 extensions（含 readOnly）未崩
    expect(container.querySelector(".cm-content")).not.toBeNull();
  });

  it("显示行号（.cm-gutter 存在）", () => {
    const { container } = render(<CodeView content={"a = 1\nb = 2\n"} />);
    // lineNumbers() 会渲染行号槽
    expect(container.querySelector(".cm-gutter")).not.toBeNull();
    expect(container.querySelector(".cm-lineNumbers")).not.toBeNull();
  });

  it("语法高亮：关键字被拆成带样式的 span", () => {
    const { container } = render(
      <CodeView content={"def hello():\n    pass\n"} />,
    );
    const line = container.querySelector(".cm-line");
    expect(line).not.toBeNull();
    expect(line!.querySelectorAll("span").length).toBeGreaterThan(0);
    expect(container.textContent).toContain("def");
  });

  it("调用点带 cm-call-mark 标记", () => {
    const { container } = render(
      <CodeView
        content={"foo()\n"}
        calls={[{ callee_name: "foo", callee_id: 1, line: 1, col: 0 }]}
      />,
    );
    expect(container.querySelector(".cm-call-mark")).not.toBeNull();
    expect(container.querySelector(".cm-call-mark")?.textContent).toContain(
      "foo",
    );
  });
});

describe("CodeView — 大文件护栏（O-4）", () => {
  it("超 2 万行 → 不挂 CodeMirror，显示截断提示", () => {
    const huge = Array(20001).fill("x = 1").join("\n");
    const { container } = render(<CodeView content={huge} />);
    expect(container.querySelector(".cm-content")).toBeNull();
    expect(screen.getByText(/文件过大|截断/i)).toBeInTheDocument();
  });

  it("超 1MB → 不挂 CodeMirror，显示截断提示", () => {
    const huge = "x".repeat(1024 * 1024 + 1);
    const { container } = render(<CodeView content={huge} />);
    expect(container.querySelector(".cm-content")).toBeNull();
    expect(screen.getByText(/文件过大|截断/i)).toBeInTheDocument();
  });

  it("恰好 2 万行 → 正常挂载（边界值）", () => {
    const exact = Array(20000).fill("x = 1").join("\n");
    const { container } = render(<CodeView content={exact} />);
    expect(container.querySelector(".cm-content")).not.toBeNull();
  });
});

describe("CodeView — scrollToLine ref", () => {
  it("ref 暴露 scrollToLine 方法（可调用，不崩）", () => {
    const ref = createRef<CodeViewHandle>();
    const { container } = render(
      <CodeView ref={ref} content={"a = 1\nb = 2\nc = 3\n"} />,
    );
    expect(typeof ref.current?.scrollToLine).toBe("function");
    // 调用不崩（实际滚动效果留 E2E）
    expect(() => ref.current?.scrollToLine(3)).not.toThrow();
    expect(container.querySelector(".cm-jump-line")).not.toBeNull();
  });
});
