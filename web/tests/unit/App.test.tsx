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

describe("App — 阅读模式导读入口（Stage 7b）", () => {
  it("打开的文件有导读 → 显示「查看导读」，点击切到导读模式", async () => {
    server.use(
      http.get("*/api/guides", () =>
        HttpResponse.json({
          scope: "file",
          path: "main.py",
          content_md: "文件导读。",
          blocks: [{ type: "text", text: "文件导读。" }],
          stale: false,
          model: "m1",
        }),
      ),
      http.get("*/api/guides/tree", () =>
        HttpResponse.json({
          project: { scope: "project", path: "", status: "none" },
          modules: [],
          files: [{ scope: "file", path: "main.py", status: "cached" }],
        }),
      ),
      http.post("*/api/guides/generate", () =>
        HttpResponse.json({ detail: "x" }),
      ),
    );

    render(<App />);
    await waitFor(() =>
      expect(screen.getByText("main.py")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("main.py"));
    await waitFor(() =>
      expect(document.querySelector(".cm-content")).not.toBeNull(),
    );

    // 有导读 → 入口按钮出现
    const btn = await screen.findByRole("button", { name: /查看导读/ });
    fireEvent.click(btn);

    // 切到导读模式 → 导读目录可见
    await waitFor(() =>
      expect(screen.getByText("导读目录")).toBeInTheDocument(),
    );
  });
});

describe("App — 阅读模式导读入口（Stage 8：任何打开的文件都有入口）", () => {
  it("无导读 → 显示「生成并查看导读」，点击切导读模式并自动生成一次", async () => {
    const generateCalls: string[] = [];
    server.use(
      http.get("*/api/guides/tree", () =>
        HttpResponse.json({
          project: { scope: "project", path: "", status: "none" },
          modules: [],
          files: [{ scope: "file", path: "main.py", status: "none" }],
        }),
      ),
      http.post("*/api/guides/generate", async ({ request }) => {
        const body = (await request.json()) as { scope: string; path: string };
        generateCalls.push(`${body.scope}:${body.path}`);
        const sse = `data: ${JSON.stringify({ content: "生成完成" })}\n\ndata: [DONE]\n\n`;
        return new HttpResponse(sse, {
          headers: { "Content-Type": "text/event-stream" },
        });
      }),
    );

    render(<App />);
    await waitFor(() =>
      expect(screen.getByText("main.py")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("main.py"));
    await waitFor(() =>
      expect(document.querySelector(".cm-content")).not.toBeNull(),
    );

    // 无导读（默认 handlers 返回 404）→ 入口为「生成并查看导读」
    const btn = await screen.findByRole("button", {
      name: /生成并查看导读/,
    });
    fireEvent.click(btn);

    // 切到导读模式，聚焦该文件并自动触发生成（仅一次）
    await waitFor(() =>
      expect(screen.getByText("导读目录")).toBeInTheDocument(),
    );
    await waitFor(() => expect(generateCalls).toEqual(["file:main.py"]));
  });

  it("导读已 stale → 入口为「生成并查看导读」（而非查看导读）", async () => {
    server.use(
      http.get("*/api/guides", () =>
        HttpResponse.json({
          scope: "file",
          path: "main.py",
          content_md: "旧导读。",
          blocks: [{ type: "text", text: "旧导读。" }],
          stale: true,
          model: "m1",
        }),
      ),
    );

    render(<App />);
    await waitFor(() =>
      expect(screen.getByText("main.py")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("main.py"));
    await waitFor(() =>
      expect(document.querySelector(".cm-content")).not.toBeNull(),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /生成并查看导读/ }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: /^📖 查看导读$/ }),
    ).not.toBeInTheDocument();
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
          files_updated: 2,
          files_skipped: 0,
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
