import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import {
  createTestQueryClient,
  createQueryClientWrapper,
} from "@/test/test-utils";
import { defaultHandlers } from "@/test/msw-handlers";
import { useFileTree } from "@/hooks/useFileTree";
import { useFileContent } from "@/hooks/useFileContent";
import { useIndexStatus } from "@/hooks/useIndexStatus";
import { useHealth } from "@/hooks/useHealth";

const server = setupServer(...defaultHandlers());

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  server.resetHandlers();
  // 恢复默认 handlers（resetHandlers 会清掉 override 但保留初始）
  server.use(...defaultHandlers());
});

describe("useHealth", () => {
  it('成功路径 → 返回 { status: "ok" }', async () => {
    const { result } = renderHook(() => useHealth(), {
      wrapper: createQueryClientWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ status: "ok" });
  });

  it("后端不可用（500）→ isError", async () => {
    server.use(
      http.get("*/api/health", () => new HttpResponse(null, { status: 500 })),
    );
    const { result } = renderHook(() => useHealth(), {
      wrapper: createQueryClientWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useIndexStatus", () => {
  it("成功路径 → 返回索引状态", async () => {
    const { result } = renderHook(() => useIndexStatus(), {
      wrapper: createQueryClientWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.file_count).toBe(3);
    expect(result.current.data?.repo_root).toBe("/tmp/repo");
  });
});

describe("useFileTree", () => {
  it("成功路径 → 返回 paths", async () => {
    const { result } = renderHook(() => useFileTree(), {
      wrapper: createQueryClientWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.paths).toEqual(["main.py", "pkg/helper.py"]);
  });

  it("后端不可用（503）→ isError（O-3）", async () => {
    server.use(
      http.get(
        "*/api/files/tree",
        () => new HttpResponse("locked", { status: 503 }),
      ),
    );
    const { result } = renderHook(() => useFileTree(), {
      wrapper: createQueryClientWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useFileContent", () => {
  it("成功路径 → 返回 content + symbols + calls", async () => {
    const { result } = renderHook(() => useFileContent("main.py"), {
      wrapper: createQueryClientWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.content).toBe("x = 1");
    expect(result.current.data?.symbols).toHaveLength(1);
    expect(result.current.data?.calls).toEqual([]);
  });

  it("filePath 为 null → 不发请求（enabled 控制）", () => {
    const { result } = renderHook(() => useFileContent(null), {
      wrapper: createQueryClientWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });

  it("文件不存在（404）→ isError（O-3）", async () => {
    server.use(
      http.get(
        "*/api/files/missing.py",
        () => new HttpResponse("not found", { status: 404 }),
      ),
    );
    const { result } = renderHook(() => useFileContent("missing.py"), {
      wrapper: createQueryClientWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
