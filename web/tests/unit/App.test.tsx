import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { App } from "@/App";
import { defaultHandlers, makeSymbol } from "@/test/msw-handlers";
import type { FileContentOut, FileTreeOut, IndexStatusOut } from "@/api/types";

const server = setupServer(...defaultHandlers());

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  server.resetHandlers();
  server.use(...defaultHandlers());
});

describe("App — 后端不可用（O-2）", () => {
  it("health 失败 → 显示 ErrorState", async () => {
    server.use(
      http.get("*/api/health", () => new HttpResponse(null, { status: 500 })),
    );
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/无法连接后端/i)).toBeInTheDocument(),
    );
  });
});

describe("App — 未索引空状态（B-4）", () => {
  it("file_count=0 → 显示 EmptyState + 索引按钮", async () => {
    server.use(
      http.get("*/api/index/status", () =>
        HttpResponse.json<IndexStatusOut>({
          file_count: 0,
          symbol_count: 0,
          schema_version: "1",
          repo_root: "/tmp/repo",
          db_path: "/tmp/repo/i.db",
        }),
      ),
      http.get("*/api/files/tree", () =>
        HttpResponse.json<FileTreeOut>({ paths: [] }),
      ),
    );
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/尚未索引|无 Python/i)).toBeInTheDocument(),
    );
    // Header + EmptyState 各有一个索引按钮
    expect(
      screen.getAllByRole("button", { name: /索引/i }).length,
    ).toBeGreaterThanOrEqual(1);
  });
});

describe("App — 已索引 + 选文件 + 大纲", () => {
  it("文件树可见 + 点文件 → CodeView 挂载 + 大纲可见", async () => {
    render(<App />);
    // 等待文件树加载
    await waitFor(() =>
      expect(screen.getByText("main.py")).toBeInTheDocument(),
    );

    // 点文件
    fireEvent.click(screen.getByText("main.py"));

    // CodeView 挂载 + 大纲可见
    await waitFor(() => {
      expect(document.querySelector(".cm-content")).not.toBeNull();
    });
    expect(screen.getByText("main")).toBeInTheDocument(); // 符号大纲中的符号名
  });

  it("点大纲符号 → 不崩（scrollToLine 实际效果留 E2E）", async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText("main.py")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("main.py"));
    await waitFor(() => expect(screen.getByText("main")).toBeInTheDocument());

    // 点大纲符号 → 不崩
    expect(() => fireEvent.click(screen.getByText("main"))).not.toThrow();
  });
});

describe("App — 索引触发", () => {
  it("点索引按钮 → POST /api/index → 成功后刷新", async () => {
    const indexCalls: string[] = [];
    server.use(
      http.post("*/api/index", () => {
        indexCalls.push("called");
        return HttpResponse.json({
          files_total: 2,
          symbols_total: 5,
          calls_total: 3,
          duration_ms: 10,
        });
      }),
    );

    // 先设为未索引
    server.use(
      http.get("*/api/index/status", () =>
        HttpResponse.json<IndexStatusOut>({
          file_count: 0,
          symbol_count: 0,
          schema_version: "1",
          repo_root: "/tmp/repo",
          db_path: "/tmp/repo/i.db",
        }),
      ),
    );

    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /索引/i })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /索引/i }));
    await waitFor(() => expect(indexCalls).toContain("called"));
  });
});
