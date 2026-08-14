import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { useCallChain } from "@/hooks/useCallChain";
import type { SymbolOut } from "@/api/types";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => server.resetHandlers());

function makeSym(id: number, name: string): SymbolOut {
  return {
    id,
    name,
    kind: "function",
    file_path: `${name}.py`,
    line: id * 10,
    col: 0,
    end_line: id * 10 + 5,
  };
}

describe("useCallChain — 循环 12", () => {
  it("symbolId 有效 → 递归查 callers → 返回路径", async () => {
    const target = makeSym(3, "target");
    const caller = makeSym(2, "caller");
    const entry = makeSym(1, "entry");

    server.use(
      http.get("*/api/symbols/3", () => HttpResponse.json(target)),
      http.get("*/api/symbols/3/callers", () => HttpResponse.json([caller])),
      http.get("*/api/symbols/2/callers", () => HttpResponse.json([entry])),
      http.get("*/api/symbols/1/callers", () => HttpResponse.json([])),
    );

    const { result } = renderHook(() => useCallChain(3));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.paths).toHaveLength(1);
    expect(result.current.paths[0].symbols).toEqual([entry, caller, target]);
    expect(result.current.truncated).toBe(false);
  });

  it("symbolId 为 null → 空结果", () => {
    const { result } = renderHook(() => useCallChain(null));
    expect(result.current.paths).toEqual([]);
    expect(result.current.truncated).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it("多路径：target 有两个 callers", async () => {
    const target = makeSym(5, "target");
    const c1 = makeSym(3, "c1");
    const c2 = makeSym(4, "c2");
    const e1 = makeSym(1, "e1");
    const e2 = makeSym(2, "e2");

    server.use(
      http.get("*/api/symbols/5", () => HttpResponse.json(target)),
      http.get("*/api/symbols/5/callers", () => HttpResponse.json([c1, c2])),
      http.get("*/api/symbols/3/callers", () => HttpResponse.json([e1])),
      http.get("*/api/symbols/4/callers", () => HttpResponse.json([e2])),
      http.get("*/api/symbols/1/callers", () => HttpResponse.json([])),
      http.get("*/api/symbols/2/callers", () => HttpResponse.json([])),
    );

    const { result } = renderHook(() => useCallChain(5));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.paths).toHaveLength(2);
  });

  it("缓存：同一节点不重复查（环防护）", async () => {
    const target = makeSym(1, "a");
    const b = makeSym(2, "b");

    let bCallersCount = 0;
    server.use(
      http.get("*/api/symbols/1", () => HttpResponse.json(target)),
      http.get("*/api/symbols/1/callers", () => HttpResponse.json([b])),
      http.get("*/api/symbols/2/callers", () => {
        bCallersCount++;
        return HttpResponse.json([target]); // b 的 caller 是 a（环回）
      }),
    );

    const { result } = renderHook(() => useCallChain(1));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // b 的 callers 只查一次（缓存/visited 防护）
    expect(bCallersCount).toBe(1);
    // 路径存在（环被正确处理）
    expect(result.current.paths.length).toBeGreaterThan(0);
  });

  it("加载中 → isLoading=true", async () => {
    server.use(
      http.get("*/api/symbols/1", () => HttpResponse.json(makeSym(1, "a"))),
      http.get("*/api/symbols/1/callers", () => HttpResponse.json([])),
    );

    const { result } = renderHook(() => useCallChain(1));
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });
});
