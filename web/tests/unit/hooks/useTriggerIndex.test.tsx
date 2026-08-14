import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { QueryClient } from "@tanstack/react-query";
import { createQueryClientWrapper } from "@/test/test-utils";
import { useTriggerIndex } from "@/hooks/useTriggerIndex";
import { useFileTree } from "@/hooks/useFileTree";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => server.resetHandlers());

describe("useTriggerIndex — S-4 状态机", () => {
  it("成功 → 返回 IndexResultOut", async () => {
    server.use(
      http.post("*/api/index", () =>
        HttpResponse.json({
          files_total: 3,
          symbols_total: 10,
          calls_total: 5,
          duration_ms: 42,
        }),
      ),
    );
    const { result } = renderHook(() => useTriggerIndex(), {
      wrapper: createQueryClientWrapper(),
    });

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.files_total).toBe(3);
  });

  it("成功后 clear 全部缓存（cc S-3：符号 id 跨 reindex 不稳定）", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const clearSpy = vi.spyOn(queryClient, "clear");

    server.use(
      http.post("*/api/index", () =>
        HttpResponse.json({
          files_total: 1,
          symbols_total: 1,
          calls_total: 0,
          duration_ms: 1,
        }),
      ),
    );

    const wrapper = createQueryClientWrapper(queryClient);
    const { result } = renderHook(() => useTriggerIndex(), { wrapper });

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // cc S-3：clear() 清空全部缓存
    expect(clearSpy).toHaveBeenCalled();
  });

  it("409（索引互斥）→ isError", async () => {
    server.use(
      http.post(
        "*/api/index",
        () => new HttpResponse("索引中", { status: 409 }),
      ),
    );
    const { result } = renderHook(() => useTriggerIndex(), {
      wrapper: createQueryClientWrapper(),
    });

    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("pending 期间 isPending 为 true（S-4）", async () => {
    // 用一个可控的延迟 handler 让 pending 状态可被 waitFor 捕获
    server.use(
      http.post("*/api/index", async () => {
        await new Promise((r) => setTimeout(r, 300));
        return HttpResponse.json({
          files_total: 1,
          symbols_total: 1,
          calls_total: 0,
          duration_ms: 1,
        });
      }),
    );
    const { result } = renderHook(() => useTriggerIndex(), {
      wrapper: createQueryClientWrapper(),
    });

    result.current.mutate();
    // waitFor 轮询捕获 pending 瞬态（300ms 延迟保证窗口足够）
    await waitFor(() => expect(result.current.isPending).toBe(true));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
