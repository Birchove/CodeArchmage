/**
 * MSW mock handlers（单元/集成测试用）。
 *
 * 用通配 URL 匹配任意 host（路径形如 '星号/api/...'），
 * 因为前端 fetch 用相对路径。
 */

import { http, HttpResponse } from "msw";
import type {
  FileContentOut,
  FileTreeOut,
  IndexStatusOut,
  LLMConfigOut,
  SymbolOut,
} from "@/api/types";

/** 构造一个 SymbolOut fixture。 */
export function makeSymbol(partial: Partial<SymbolOut>): SymbolOut {
  return {
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
    ...partial,
  };
}

/** 默认成功 handlers（可按需 override）。 */
export function defaultHandlers() {
  return [
    http.get("*/api/health", () => HttpResponse.json({ status: "ok" })),
    http.get("*/api/llm/config", () =>
      HttpResponse.json<LLMConfigOut>({
        configured: true,
        status: "ok",
        message: "LLM 已配置（模型：test）",
        model: "test",
        env_path: null,
        missing_fields: [],
      }),
    ),
    http.get("*/api/index/status", () =>
      HttpResponse.json<IndexStatusOut>({
        file_count: 3,
        symbol_count: 10,
        schema_version: "1",
        repo_root: "/tmp/repo",
        db_path: "/tmp/repo/.code_archmage_index/index.db",
      }),
    ),
    http.get("*/api/files/tree", () =>
      HttpResponse.json<FileTreeOut>({ paths: ["main.py", "pkg/helper.py"] }),
    ),
    http.get("*/api/files/main.py", () =>
      HttpResponse.json<FileContentOut>({
        path: "main.py",
        content: "x = 1",
        language: "python",
        symbols: [makeSymbol({ name: "main", line: 1 })],
        calls: [],
      }),
    ),
  ];
}
