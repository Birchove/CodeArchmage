import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiGet, apiPost, ApiError } from "@/api/client";
import type {
  SymbolOut,
  CallOut,
  FileContentOut,
  FileTreeOut,
  IndexResultOut,
  IndexStatusOut,
} from "@/api/types";

/** 构造一个 mock Response，绕过 TS 对 Response 类型的严格要求。 */
function mockResponse(status: number, body: unknown): Response {
  const ok = status >= 200 && status < 300;
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi
      .fn()
      .mockResolvedValue(
        typeof body === "string" ? body : JSON.stringify(body),
      ),
  } as unknown as Response;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("api/client — ApiError", () => {
  it("ApiError 携带 status 字段且 message 可读", () => {
    const err = new ApiError(404, "not found");
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(404);
    expect(err.message).toBe("not found");
  });
});

describe("api/client — apiGet", () => {
  it("对 200 响应返回解析后的 JSON", async () => {
    const fake: FileTreeOut = { paths: ["a.py", "b/c.py"] };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse(200, fake));

    const result = await apiGet<FileTreeOut>("/files/tree");
    expect(result).toEqual(fake);
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/files/tree");
  });

  it("对非 2xx 响应抛 ApiError 且携带 status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse(403, "forbidden"),
    );

    await expect(apiGet("/files/../etc/passwd")).rejects.toMatchObject({
      status: 403,
      message: "forbidden",
    });
  });

  it("网络错误（fetch reject）原样抛出", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("Failed to fetch"),
    );

    await expect(apiGet("/health")).rejects.toThrow("Failed to fetch");
  });
});

describe("api/client — apiPost", () => {
  it("对 200 响应返回解析后的 JSON", async () => {
    const fake: IndexResultOut = {
      files_total: 3,
      symbols_total: 10,
      calls_total: 5,
      duration_ms: 42,
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse(200, fake));

    const result = await apiPost<IndexResultOut>("/index");
    expect(result).toEqual(fake);
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/index", {
      method: "POST",
    });
  });

  it("对 409 响应抛 ApiError（索引互斥）", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse(409, "索引中"),
    );

    await expect(apiPost("/index")).rejects.toBeInstanceOf(ApiError);
    await expect(apiPost("/index")).rejects.toMatchObject({ status: 409 });
  });

  it("带 body 时通过 JSON 发送", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse(200, {}));

    await apiPost("/index", { force: true });
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/index", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
  });
});

describe("api/types — 类型可导入（含 S-1 CallOut）", () => {
  // 编译期断言：这些类型存在且字段对齐手写契约。
  // 字段与 Pydantic 的一致性靠 E2E + openapi 断言验证（B-5），此处不测。
  it("SymbolOut / CallOut / FileContentOut 等类型可被引用", () => {
    const sym: SymbolOut = {
      id: 1,
      name: "foo",
      kind: "function",
      file_path: "a.py",
      line: 1,
      col: 0,
      end_line: 3,
      signature: "def foo()",
      bases: [],
      decorators: [],
    };
    const call: CallOut = { callee_name: "foo", callee_id: 1, line: 5, col: 4 };
    const file: FileContentOut = {
      path: "a.py",
      content: "x = 1",
      language: "python",
      symbols: [sym],
      calls: [call],
    };
    const status: IndexStatusOut = {
      file_count: 1,
      symbol_count: 1,
      schema_version: "1",
      repo_root: "/tmp/r",
      db_path: "/tmp/r/i.db",
    };
    expect(sym.id).toBe(1);
    expect(call.callee_id).toBe(1);
    expect(file.calls).toHaveLength(1);
    expect(status.file_count).toBe(1);
  });
});
