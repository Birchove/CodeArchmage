/**
 * tests/unit/hooks/useBatchGenerate.test.ts – Stage 8：全库导读批量生成。
 *
 * 只 mock fetchGuideGenerate（fetch 层）；SSE 解析走真实的 parseSSEStream，
 * 中止用例用可被 AbortSignal 打断的 ReadableStream 模拟真实 fetch 行为。
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClientWrapper } from "@/test/test-utils";
import { useBatchGenerate } from "@/hooks/useBatchGenerate";
import type { BatchTarget } from "@/hooks/useBatchGenerate";

vi.mock("@/api/endpoints", () => ({
  fetchGuideGenerate: vi.fn(),
}));

import { fetchGuideGenerate } from "@/api/endpoints";

const mockedFetch = vi.mocked(fetchGuideGenerate);

/** 一次性给出完整导读的 SSE 响应（content 字段 → 后端真实格式）。 */
function sseResponse(content: string): Response {
  const body = `data: ${JSON.stringify({ content })}\n\ndata: [DONE]\n\n`;
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

const TARGETS: BatchTarget[] = [
  { scope: "project", path: "" },
  { scope: "module", path: "pkg" },
  { scope: "file", path: "main.py" },
];

describe("useBatchGenerate", () => {
  beforeEach(() => {
    // resetAllMocks：连同未消费的 mockResolvedValueOnce 队列一起清掉，
    // 避免上一个用例排队的响应泄漏到下一个用例
    vi.resetAllMocks();
  });

  it("串行生成全部目标：按顺序调用 + 进度递增", async () => {
    mockedFetch.mockImplementation(async (scope, path) =>
      sseResponse(`ok:${scope}:${path}`),
    );

    const { result } = renderHook(() => useBatchGenerate(), {
      wrapper: createQueryClientWrapper(),
    });

    act(() => {
      result.current.start(TARGETS);
    });

    await waitFor(() => expect(result.current.isRunning).toBe(false));

    expect(mockedFetch).toHaveBeenCalledTimes(3);
    expect(mockedFetch.mock.calls.map(([scope, path]) => [scope, path])).toEqual(
      [
        ["project", ""],
        ["module", "pkg"],
        ["file", "main.py"],
      ],
    );
    expect(result.current.done).toBe(3);
    expect(result.current.total).toBe(3);
    expect(result.current.batchError).toBeNull();
    expect(result.current.currentLabel).toBeNull();
  });

  it("SSE 流内 error 事件 → 记录错误并停止后续目标", async () => {
    const errorBody = `data: ${JSON.stringify({ error: "LLM 挂了" })}\n\n`;
    mockedFetch
      .mockResolvedValueOnce(
        new Response(errorBody, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      )
      .mockResolvedValueOnce(sseResponse("不该轮到我"));

    const { result } = renderHook(() => useBatchGenerate(), {
      wrapper: createQueryClientWrapper(),
    });

    act(() => {
      result.current.start(TARGETS.slice(0, 2));
    });

    await waitFor(() => expect(result.current.isRunning).toBe(false));
    expect(result.current.batchError).toBe("LLM 挂了");
    expect(mockedFetch).toHaveBeenCalledTimes(1); // 第二项未执行
    expect(result.current.done).toBe(0);
  });

  it("HTTP 错误（如 503）→ 记录错误并停止", async () => {
    mockedFetch.mockResolvedValue(new Response("", { status: 503 }));

    const { result } = renderHook(() => useBatchGenerate(), {
      wrapper: createQueryClientWrapper(),
    });

    act(() => {
      result.current.start(TARGETS);
    });

    await waitFor(() => expect(result.current.isRunning).toBe(false));
    expect(result.current.batchError).toBe("HTTP 503");
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it("中止：打断进行中的流，后续目标不再生成", async () => {
    // 第一个目标：发出一个块后挂起，abort 时以 AbortError 打断（模拟真实 fetch）
    mockedFetch
      .mockImplementationOnce(async (_scope, _path, signal) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const chunk = `data: ${JSON.stringify({ content: "第一块" })}\n\n`;
            controller.enqueue(new TextEncoder().encode(chunk));
            signal?.addEventListener("abort", () => {
              controller.error(new DOMException("Aborted", "AbortError"));
            });
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      })
      .mockResolvedValueOnce(sseResponse("不该轮到我"));

    const { result } = renderHook(() => useBatchGenerate(), {
      wrapper: createQueryClientWrapper(),
    });

    act(() => {
      result.current.start(TARGETS.slice(0, 2));
    });

    // 等第一个请求发出（其流挂起，永远不会自行完成）
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.abort();
    });

    await waitFor(() => expect(result.current.isRunning).toBe(false));
    expect(mockedFetch).toHaveBeenCalledTimes(1); // 中止后不再继续
    expect(result.current.batchError).toBeNull(); // 中止不算错误
  });

  it("运行中再次 start → 忽略（不并发双跑）", async () => {
    mockedFetch.mockImplementation(async () => sseResponse("ok"));

    const { result } = renderHook(() => useBatchGenerate(), {
      wrapper: createQueryClientWrapper(),
    });

    act(() => {
      result.current.start(TARGETS);
      result.current.start(TARGETS); // 第二次应被忽略
    });

    await waitFor(() => expect(result.current.isRunning).toBe(false));
    expect(mockedFetch).toHaveBeenCalledTimes(3);
  });

  it("空目标列表 → 不进入运行态", () => {
    const { result } = renderHook(() => useBatchGenerate(), {
      wrapper: createQueryClientWrapper(),
    });

    act(() => {
      result.current.start([]);
    });

    expect(result.current.isRunning).toBe(false);
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});
