import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { createQueryClientWrapper } from "@/test/test-utils";
import { useCallers } from "@/hooks/useCallers";
import type { SymbolOut } from "@/api/types";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => server.resetHandlers());

const mockCallers: SymbolOut[] = [
  {
    id: 10,
    name: "main",
    kind: "function",
    file_path: "main.py",
    line: 5,
    col: 0,
    end_line: 10,
  },
];

describe("useCallers — 循环 6", () => {
  it("symbolId 有效 → 返回 callers", async () => {
    server.use(
      http.get("*/api/symbols/1/callers", () => HttpResponse.json(mockCallers)),
    );
    const { result } = renderHook(() => useCallers(1), {
      wrapper: createQueryClientWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockCallers);
  });

  it("symbolId 为 null → 不发请求", () => {
    const { result } = renderHook(() => useCallers(null), {
      wrapper: createQueryClientWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("后端 404 → isError", async () => {
    server.use(
      http.get(
        "*/api/symbols/999/callers",
        () => new HttpResponse("not found", { status: 404 }),
      ),
    );
    const { result } = renderHook(() => useCallers(999), {
      wrapper: createQueryClientWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
