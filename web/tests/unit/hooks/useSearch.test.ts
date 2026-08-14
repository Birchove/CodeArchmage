import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { createQueryClientWrapper } from "@/test/test-utils";
import { useSearch } from "@/hooks/useSearch";
import type { SearchHitOut } from "@/api/types";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => server.resetHandlers());

describe("useSearch — 阶段 5 循环 1", () => {
  it("输入关键词 → 返回 SearchHit[]，显式传 limit=20", async () => {
    let requestedLimit = "";
    let requestedQ = "";
    const hits: SearchHitOut[] = [
      {
        symbol_id: 1,
        name: "add",
        kind: "function",
        file_path: "calculator.py",
        line: 9,
        snippet: "def add",
      },
    ];
    server.use(
      http.get("*/api/search", ({ request }) => {
        const url = new URL(request.url);
        requestedQ = url.searchParams.get("q") ?? "";
        requestedLimit = url.searchParams.get("limit") ?? "";
        return HttpResponse.json(hits);
      }),
    );

    // debounceMs=0 跳过防抖时序，聚焦数据契约
    const { result } = renderHook(() => useSearch("add", 0), {
      wrapper: createQueryClientWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(hits);
    expect(requestedQ).toBe("add");
    expect(requestedLimit).toBe("20");
  });

  it("空输入 → 不发请求（enabled 控制）", () => {
    const { result } = renderHook(() => useSearch("", 0), {
      wrapper: createQueryClientWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });

  it("纯空格输入 → 不发请求", () => {
    const { result } = renderHook(() => useSearch("   ", 0), {
      wrapper: createQueryClientWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("后端 400（空 q）→ isError", async () => {
    server.use(
      http.get(
        "*/api/search",
        () => new HttpResponse("关键词不能为空", { status: 400 }),
      ),
    );
    const { result } = renderHook(() => useSearch("x", 0), {
      wrapper: createQueryClientWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
