/**
 * tests/unit/hooks/useChat.test.ts – 循环 11
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
  });

  it("initial state is empty", () => {
    const { result } = renderHook(() => useChat());
    expect(result.current.messages).toEqual([]);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("appends user message on send", async () => {
    mockedFetchChat.mockResolvedValue(makeOkResponse());
    mockedParseSSEStream.mockReturnValue(makeDeltas("hi"));

    const { result } = renderHook(() => useChat());
    act(() => {
      result.current.send("你好", null);
    });

    expect(result.current.messages[0]).toEqual({ role: "user", content: "你好" });
  });

  it("accumulates streaming deltas into assistant message", async () => {
    mockedFetchChat.mockResolvedValue(makeOkResponse());
    mockedParseSSEStream.mockReturnValue(makeDeltas("你", "好", "！"));

    const { result } = renderHook(() => useChat());
    act(() => {
      result.current.send("test", null);
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });

    const last = result.current.messages.at(-1);
    expect(last?.role).toBe("assistant");
    expect(last?.content).toBe("你好！");
  });

  it("sets error on stream error chunk", async () => {
    mockedFetchChat.mockResolvedValue(makeOkResponse());
    async function* errorGen() {
      yield { error: "LLM 错误" };
    }
    mockedParseSSEStream.mockReturnValue(errorGen());

    const { result } = renderHook(() => useChat());
    act(() => {
      result.current.send("test", null);
    });

    await waitFor(() => {
      expect(result.current.error).toBe("LLM 错误");
    });
  });

  it("clear resets messages and error", async () => {
    mockedFetchChat.mockResolvedValue(makeOkResponse());
    mockedParseSSEStream.mockReturnValue(makeDeltas("hi"));

    const { result } = renderHook(() => useChat());
    act(() => {
      result.current.send("test", null);
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

    const { result } = renderHook(() => useChat());
    act(() => {
      result.current.send("x", null);
    });

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });
  });
});
