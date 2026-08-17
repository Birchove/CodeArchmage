/**
 * tests/unit/components/MessageBubble.test.tsx – 循环 12
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageBubble } from "@/components/MessageBubble";
import type { ChatMessage } from "@/api/types";

describe("MessageBubble", () => {
  it("用户消息渲染纯文本", () => {
    const msg: ChatMessage = { role: "user", content: "这是什么写法？" };
    render(<MessageBubble message={msg} />);
    expect(screen.getByText("这是什么写法？")).toBeTruthy();
    expect(screen.getByText("你")).toBeTruthy();
  });

  it("assistant 消息渲染 Markdown（代码块）", () => {
    const msg: ChatMessage = {
      role: "assistant",
      content: "这是一个函数：\n```python\ndef foo():\n    pass\n```",
    };
    const { container } = render(<MessageBubble message={msg} />);
    expect(screen.getByText("AI")).toBeTruthy();
    expect(container.querySelector("code")).toBeTruthy();
    expect(container.querySelector("pre")).toBeTruthy();
  });

  it("assistant 消息渲染 Markdown（列表 + 加粗）", () => {
    const msg: ChatMessage = {
      role: "assistant",
      content: "**重点**：\n- 第一\n- 第二",
    };
    const { container } = render(<MessageBubble message={msg} />);
    expect(container.querySelector("strong")).toBeTruthy();
    expect(container.querySelectorAll("li").length).toBe(2);
  });

  it("assistant 空内容显示打字占位", () => {
    const msg: ChatMessage = { role: "assistant", content: "" };
    render(<MessageBubble message={msg} />);
    expect(screen.getByText("…")).toBeTruthy();
  });

  it("不渲染 raw HTML（XSS 防护）", () => {
    const msg: ChatMessage = {
      role: "assistant",
      content: "<script>alert('xss')</script>",
    };
    const { container } = render(<MessageBubble message={msg} />);
    expect(container.querySelector("script")).toBeNull();
  });
});
