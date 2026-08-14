import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { createQueryClientWrapper } from "@/test/test-utils";
import { useCallees } from "@/hooks/useCallees";
import type { SymbolOut } from "@/api/types";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => server.resetHandlers());

const mockCallees: SymbolOut[] = [
  {
    id: 20,
    name: "add_numbers",
    kind: "function",
    file_path: "operations.py",
    line: 5,
    col: 0,
    end_line: 6,
  },
];

describe("useCallees — 循环 6", () => {
  it("symbolId 有效 → 返回 callees", async () => {
    server.use(
      http.get("*/api/symbols/1/callees", () => HttpResponse.json(mockCallees)),
    );
    const { result } = renderHook(() => useCallees(1), {
      wrapper: createQueryClientWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockCallees);
  });

  it("symbolId 为 null → 不发请求", () => {
    const { result } = renderHook(() => useCallees(null), {
      wrapper: createQueryClientWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("后端 404 → isError", async () => {
    server.use(
      http.get(
        "*/api/symbols/999/callees",
        () => new HttpResponse("not found", { status: 404 }),
      ),
    );
    const { result } = renderHook(() => useCallees(999), {
      wrapper: createQueryClientWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
