/**
 * tests/unit/hooks/useChat.test.ts – 循环 11
 * Stage 7a A-2：对话按符号保留（useChat(symbolId) 多会话）
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChat } from "@/hooks/useChat";

// Mock fetchChat + parseSSEStream at module level
vi.mock("@/api/endpoints", () => ({
  fetchChat: vi.fn(),
}));

vi.mock("@/lib/sse", () => ({
  parseSSEStream: vi.fn(),
}));

import { fetchChat } from "@/api/endpoints";
import { parseSSEStream } from "@/lib/sse";

const mockedFetchChat = vi.mocked(fetchChat);
const mockedParseSSEStream = vi.mocked(parseSSEStream);

function makeOkResponse(): Response {
  return new Response("", { status: 200 });
}

async function* makeDeltas(...deltas: string[]) {
  for (const d of deltas) {
    yield { delta: d };
  }
}

describe("useChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetchChat.mockResolvedValue(makeOkResponse());
  });

  it("initial state is empty", () => {
    const { result } = renderHook(() => useChat(null));
    expect(result.current.messages).toEqual([]);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("appends user message on send", async () => {
    mockedParseSSEStream.mockReturnValue(makeDeltas("hi"));

    const { result } = renderHook(() => useChat(null));
    act(() => {
      result.current.send("你好");
    });

    expect(result.current.messages[0]).toEqual({
      role: "user",
      content: "你好",
    });
  });

  it("accumulates streaming deltas into assistant message", async () => {
    mockedParseSSEStream.mockReturnValue(makeDeltas("你", "好", "！"));

    const { result } = renderHook(() => useChat(null));
    act(() => {
      result.current.send("test");
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });

    const last = result.current.messages.at(-1);
    expect(last?.role).toBe("assistant");
    expect(last?.content).toBe("你好！");
  });

  it("sets error on stream error chunk", async () => {
    async function* errorGen() {
      yield { error: "LLM 错误" };
    }
    mockedParseSSEStream.mockReturnValue(errorGen());

    const { result } = renderHook(() => useChat(null));
    act(() => {
      result.current.send("test");
    });

    await waitFor(() => {
      expect(result.current.error).toBe("LLM 错误");
    });
  });

  it("clear resets messages and error", async () => {
    mockedParseSSEStream.mockReturnValue(makeDeltas("hi"));

    const { result } = renderHook(() => useChat(null));
    act(() => {
      result.current.send("test");
    });
    await waitFor(() => !result.current.isStreaming);

    act(() => {
      result.current.clear();
    });
    expect(result.current.messages).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("sets error on HTTP error", async () => {
    mockedFetchChat.mockResolvedValue(new Response("", { status: 503 }));
    mockedParseSSEStream.mockReturnValue(makeDeltas());

    const { result } = renderHook(() => useChat(null));
    act(() => {
      result.current.send("x");
    });

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });
  });
});

describe("useChat — Stage 7a A-2 按符号保留对话历史", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetchChat.mockResolvedValue(makeOkResponse());
  });

  it("切换符号后再切回 → 对话历史保留", async () => {
    mockedParseSSEStream.mockReturnValue(makeDeltas("回答"));

    const { result, rerender } = renderHook(
      ({ symbolId }) => useChat(symbolId),
      { initialProps: { symbolId: 1 as number | null } },
    );

    act(() => result.current.send("问题 A"));
    await waitFor(() => !result.current.isStreaming);
    expect(result.current.messages).toHaveLength(2);

    // 切到符号 2 → 空会话
    rerender({ symbolId: 2 });
    expect(result.current.messages).toEqual([]);

    // 切回符号 1 → 历史恢复
    rerender({ symbolId: 1 });
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].content).toBe("问题 A");
    expect(result.current.messages[1].content).toBe("回答");
  });

  it("切换符号期间流式继续 → 增量写入原符号会话", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    async function* slowDeltas() {
      yield { delta: "一" };
      await gate;
      yield { delta: "二" };
    }
    mockedParseSSEStream.mockReturnValue(slowDeltas());

    const { result, rerender } = renderHook(
      ({ symbolId }) => useChat(symbolId),
      { initialProps: { symbolId: 1 as number | null } },
    );

    act(() => result.current.send("问题"));
    await waitFor(() =>
      expect(result.current.messages.at(-1)?.content).toBe("一"),
    );

    // 流式中途切到符号 2（视图上看到空会话）
    rerender({ symbolId: 2 });
    expect(result.current.messages).toEqual([]);

    // 放行剩余增量 → 写入符号 1 的会话（不是当前视图）
    act(() => release());
    await waitFor(() => !result.current.isStreaming);

    // 切回符号 1 → 完整回答
    rerender({ symbolId: 1 });
    expect(result.current.messages.at(-1)?.content).toBe("一二");
  });

  it("clear 只清空当前符号的会话", async () => {
    mockedParseSSEStream.mockReturnValue(makeDeltas("回答"));

    const { result, rerender } = renderHook(
      ({ symbolId }) => useChat(symbolId),
      { initialProps: { symbolId: 1 as number | null } },
    );

    act(() => result.current.send("问题 A"));
    await waitFor(() => !result.current.isStreaming);

    // 符号 2 也有一段对话
    rerender({ symbolId: 2 });
    act(() => result.current.send("问题 B"));
    await waitFor(() => !result.current.isStreaming);

    // 清空符号 2 → 符号 1 不受影响
    act(() => result.current.clear());
    expect(result.current.messages).toEqual([]);
    rerender({ symbolId: 1 });
    expect(result.current.messages).toHaveLength(2);
  });

  it("retry 作用于当前符号的最后一条用户消息", async () => {
    mockedParseSSEStream.mockReturnValue(makeDeltas("第一次"));

    const { result } = renderHook(({ symbolId }) => useChat(symbolId), {
      initialProps: { symbolId: 7 as number | null },
    });

    act(() => result.current.send("问题"));
    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.messages.at(-1)?.content).toBe("第一次");
    });

    mockedParseSSEStream.mockReturnValue(makeDeltas("第二次"));
    act(() => result.current.retry());
    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.messages.at(-1)?.content).toBe("第二次");
    });

    expect(result.current.messages).toHaveLength(2);
    // retry 请求带的是当前符号 id
    expect(mockedFetchChat).toHaveBeenLastCalledWith(
      "问题",
      7,
      [],
      expect.any(AbortSignal),
    );
  });
});
