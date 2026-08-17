/**
 * tests/unit/hooks/useSummary.test.tsx – 循环 15
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSummary } from "@/hooks/useSummary";
import * as endpoints from "@/api/endpoints";
import type { ReactNode } from "react";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useSummary", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("symbolId 为 null 时不查询", () => {
    const spy = vi.spyOn(endpoints, "getSummary");
    const { result } = renderHook(() => useSummary(null), {
      wrapper: createWrapper(),
    });
    expect(result.current.summary).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it("有缓存时返回摘要", async () => {
    const mockSummary = {
      symbol_id: 1,
      summary_text: "这是一个测试函数",
      model: "gpt-4",
      cached: true,
    };
    vi.spyOn(endpoints, "getSummary").mockResolvedValue(mockSummary);

    const { result } = renderHook(() => useSummary(1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.summary).toEqual(mockSummary);
    });
  });

  it("无缓存时 generate 触发生成", async () => {
    vi.spyOn(endpoints, "getSummary").mockRejectedValue(new Error("404"));
    const mockCreate = vi
      .spyOn(endpoints, "createSummary")
      .mockResolvedValue({
        symbol_id: 1,
        summary_text: "新生成的摘要",
        model: "gpt-4",
        cached: false,
      });

    const { result } = renderHook(() => useSummary(1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });

    result.current.generate();

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(1);
    });
  });

  it("生成成功后写入缓存", async () => {
    vi.spyOn(endpoints, "getSummary").mockRejectedValue(new Error("404"));
    const mockResponse = {
      symbol_id: 1,
      summary_text: "新生成的摘要",
      model: "gpt-4",
      cached: false,
    };
    vi.spyOn(endpoints, "createSummary").mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useSummary(1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });

    result.current.generate();

    await waitFor(() => {
      expect(result.current.summary).toEqual(mockResponse);
    });
  });
});
