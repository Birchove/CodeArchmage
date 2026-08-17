/**
 * tests/unit/components/ChatPanel.test.tsx – 循环 13
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatPanel } from "@/components/ChatPanel";
import type { ChatMessage } from "@/api/types";

const defaultProps = {
  messages: [] as ChatMessage[],
  isStreaming: false,
  error: null,
  draft: "",
  symbolName: null,
  llmConfigured: true,
  onDraftChange: vi.fn(),
  onSend: vi.fn(),
  onClear: vi.fn(),
  onAbort: vi.fn(),
};

function renderPanel(overrides: Partial<typeof defaultProps> = {}) {
  const props = { ...defaultProps, ...overrides };
  return render(<ChatPanel {...props} />);
}

describe("ChatPanel", () => {
  it("无消息时显示空状态", () => {
    renderPanel();
    expect(screen.getByText("选中符号后开始对话")).toBeTruthy();
  });

  it("有消息时渲染消息列表", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ];
    renderPanel({ messages });
    expect(screen.getByText("hello")).toBeTruthy();
    expect(screen.getByText("hi there")).toBeTruthy();
  });

  it("显示上下文提示（符号名）", () => {
    renderPanel({ symbolName: "myFunc" });
    expect(screen.getByText("myFunc")).toBeTruthy();
  });

  it("LLM 未配置时显示警告", () => {
    renderPanel({ llmConfigured: false });
    expect(screen.getByText(/LLM 未配置/)).toBeTruthy();
  });

  it("输入框值由 draft prop 控制", () => {
    renderPanel({ draft: "test input" });
    expect(screen.getByDisplayValue("test input")).toBeTruthy();
  });

  it("onDraftChange 在输入时触发", () => {
    const onDraftChange = vi.fn();
    renderPanel({ onDraftChange });
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "new text" } });
    expect(onDraftChange).toHaveBeenCalledWith("new text");
  });

  it("Enter 键触发 onSend", () => {
    const onSend = vi.fn();
    renderPanel({ draft: "hello", onSend });
    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onSend).toHaveBeenCalled();
  });

  it("Shift+Enter 不触发 onSend", () => {
    const onSend = vi.fn();
    renderPanel({ draft: "hello", onSend });
    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("发送按钮在 draft 为空时禁用", () => {
    renderPanel({ draft: "" });
    expect(screen.getByText("发送")).toBeDisabled();
  });

  it("发送按钮在 LLM 未配置时禁用", () => {
    renderPanel({ draft: "hello", llmConfigured: false });
    expect(screen.getByText("发送")).toBeDisabled();
  });

  it("清空按钮在无消息时禁用", () => {
    renderPanel({ messages: [] });
    expect(screen.getByText("清空")).toBeDisabled();
  });

  it("点击清空按钮触发 onClear", () => {
    const onClear = vi.fn();
    const messages: ChatMessage[] = [
      { role: "user", content: "hi" },
    ];
    renderPanel({ messages, onClear });
    fireEvent.click(screen.getByText("清空"));
    expect(onClear).toHaveBeenCalled();
  });

  it("流式时显示停止按钮替代发送", () => {
    renderPanel({ isStreaming: true });
    expect(screen.getByText("停止")).toBeTruthy();
    expect(screen.queryByText("发送")).toBeNull();
  });

  it("点击停止按钮触发 onAbort", () => {
    const onAbort = vi.fn();
    renderPanel({ isStreaming: true, onAbort });
    fireEvent.click(screen.getByText("停止"));
    expect(onAbort).toHaveBeenCalled();
  });

  it("显示错误信息", () => {
    renderPanel({ error: "连接失败" });
    expect(screen.getByText("连接失败")).toBeTruthy();
  });
});
