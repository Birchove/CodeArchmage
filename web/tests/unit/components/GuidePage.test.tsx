/**
 * tests/unit/components/GuidePage.test.tsx – Stage 7b：导读整页视图；
 * Stage 8：批量生成（进度/跳过 cached/禁用态）+ 自动生成一次性触发。
 *
 * 组件级：用 MSW mock 导读 API；生成流式逻辑已在 useGuide 单测覆盖。
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderWithQueryClient } from "@/test/test-utils";
import { GuidePage } from "@/components/GuidePage";
import type {
  FileContentOut,
  GuideOut,
  GuideTreeOut,
  LLMConfigOut,
} from "@/api/types";

const TREE: GuideTreeOut = {
  project: { scope: "project", path: "", status: "cached" },
  modules: [{ scope: "module", path: "pkg", status: "none" }],
  files: [
    { scope: "file", path: "main.py", status: "cached" },
    { scope: "file", path: "other.py", status: "stale" },
  ],
};

const FILE_GUIDE: GuideOut = {
  scope: "file",
  path: "main.py",
  content_md: "讲解段落。\n\n```code file=main.py lines=1-2\n```\n",
  blocks: [
    { type: "text", text: "讲解段落。" },
    {
      type: "code",
      file_path: "main.py",
      start_line: 1,
      end_line: 2,
    },
  ],
  stale: false,
  model: "m1",
};

const PROJECT_GUIDE: GuideOut = {
  scope: "project",
  path: "",
  content_md: "这是项目导读。",
  blocks: [{ type: "text", text: "这是项目导读。" }],
  stale: false,
  model: "m1",
};

function handlers() {
  return [
    http.get("*/api/guides/tree", () => HttpResponse.json(TREE)),
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
    http.get("*/api/guides", ({ request }) => {
      const url = new URL(request.url);
      const scope = url.searchParams.get("scope");
      const path = url.searchParams.get("path");
      if (scope === "file" && path === "main.py") {
        return HttpResponse.json(FILE_GUIDE);
      }
      if (scope === "project") {
        return HttpResponse.json(PROJECT_GUIDE);
      }
      return new HttpResponse(null, { status: 404 });
    }),
    http.get("*/api/files/main.py", () =>
      HttpResponse.json<FileContentOut>({
        path: "main.py",
        content: "def main():\n    pass\n",
        language: "python",
        symbols: [],
        calls: [],
      }),
    ),
    http.post("*/api/guides/generate", async ({ request }) => {
      const body = (await request.json()) as { scope: string; path: string };
      generateCalls.push(`${body.scope}:${body.path}`);
      // 真实后端格式：SSE content 字段
      const sse = `data: ${JSON.stringify({ content: "生成完成" })}\n\ndata: [DONE]\n\n`;
      return new HttpResponse(sse, {
        headers: { "Content-Type": "text/event-stream" },
      });
    }),
  ];
}

/** 记录批量/自动生成实际发出的生成请求（scope:path）。 */
const generateCalls: string[] = [];

const server = setupServer(...handlers());
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  generateCalls.length = 0;
  server.resetHandlers();
  server.use(...handlers());
});

function renderPage(
  onJumpToSource = vi.fn(),
  props: { autoGenerate?: boolean; initialSelection?: { scope: "project" | "module" | "file"; path: string } } = {},
) {
  return renderWithQueryClient(
    <GuidePage onJumpToSource={onJumpToSource} {...props} />,
  );
}

describe("GuidePage — 目录渲染", () => {
  it("项目 / 模块 / 文件三级条目 + 状态标记", async () => {
    renderPage();

    // 项目条目（默认选中）
    await waitFor(() =>
      expect(screen.getByText("项目总览")).toBeInTheDocument(),
    );
    expect(screen.getByText(/pkg/)).toBeInTheDocument();
    expect(screen.getByText("main.py")).toBeInTheDocument();
    expect(screen.getByText("other.py")).toBeInTheDocument();

    // 状态标记：stale 的条目有"已过期"字样
    await waitFor(() => expect(screen.getByText(/已过期/)).toBeInTheDocument());
  });
});

describe("GuidePage — 正文渲染", () => {
  it("选中 cached 文件 → 渲染 text 块与代码块", async () => {
    const onJumpToSource = vi.fn();
    renderPage(onJumpToSource);

    // 默认选中项目导读
    await waitFor(() =>
      expect(screen.getByText("这是项目导读。")).toBeInTheDocument(),
    );

    // 点击 main.py 条目
    fireEvent.click(screen.getByText("main.py"));

    await waitFor(() =>
      expect(screen.getByText("讲解段落。")).toBeInTheDocument(),
    );
    // 代码块：文件定位头 + 真实代码内容（CM 按 token 拆分，用 textContent 断言）
    await waitFor(() =>
      expect(screen.getByText(/main.py:1-2/)).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        document.querySelector(".guide-code-view .cm-content"),
      ).toHaveTextContent("def main():"),
    );

    // 点代码块 → 跳回阅读模式定位
    fireEvent.click(screen.getByText(/main.py:1-2/));
    expect(onJumpToSource).toHaveBeenCalledWith("main.py", 1);
  });

  it("none 状态 → 显示「生成导读」按钮", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/📁 pkg/)).toBeInTheDocument());

    fireEvent.click(screen.getByText(/📁 pkg/));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /生成导读/ }),
      ).toBeInTheDocument(),
    );
  });
});

// ---------------------------------------------------------------------------
// Stage 8：批量生成
// ---------------------------------------------------------------------------

const ALL_CACHED_TREE: GuideTreeOut = {
  project: { scope: "project", path: "", status: "cached" },
  modules: [{ scope: "module", path: "pkg", status: "cached" }],
  files: [{ scope: "file", path: "main.py", status: "cached" }],
};

/** 挂起的 SSE 流（发一块后不关闭，模拟长生成；用于进度/中止断言）。 */
function hangingSseResponse(): HttpResponse {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(`data: {"content":"x"}\n\n`),
      );
      // 不 close：模拟仍在生成
    },
  });
  return new HttpResponse(stream, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("GuidePage — 批量生成（Stage 8）", () => {
  it("跳过 cached：只生成 none 与 stale，按 模块→文件 顺序", async () => {
    renderPage();

    const btn = await screen.findByRole("button", { name: /生成本库导读/ });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);

    // project(cached) 与 main.py(cached) 跳过；pkg(none) 与 other.py(stale) 生成
    await waitFor(() =>
      expect(generateCalls).toEqual(["module:pkg", "file:other.py"]),
    );
    // 跑完后回到按钮态
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /生成本库导读/ }),
      ).toBeInTheDocument(),
    );
  });

  it("生成中显示进度（N/M + 当前目标）并可中止", async () => {
    // 第一个请求挂起 → 批量停留在运行态
    server.use(
      http.post("*/api/guides/generate", async ({ request }) => {
        const body = (await request.json()) as { scope: string; path: string };
        generateCalls.push(`${body.scope}:${body.path}`);
        return hangingSseResponse();
      }),
    );

    renderPage();
    const btn = await screen.findByRole("button", { name: /生成本库导读/ });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);

    // 进度：0/2 · pkg（第一个目标挂起中）
    await waitFor(() => {
      const progress = document.querySelector(".guide-batch-progress");
      expect(progress?.textContent).toContain("正在生成 0/2");
      expect(progress?.textContent).toContain("pkg");
    });

    // 中止 → 回到按钮态，且第二个目标未发起
    fireEvent.click(screen.getByRole("button", { name: "中止" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /生成本库导读/ }),
      ).toBeInTheDocument(),
    );
    expect(generateCalls).toEqual(["module:pkg"]);
  });

  it("LLM 未配置 → 按钮禁用并提示原因", async () => {
    server.use(
      http.get("*/api/llm/config", () =>
        HttpResponse.json<LLMConfigOut>({
          configured: false,
          status: "not_found",
          message: "未找到 .env 文件",
          env_path: null,
          missing_fields: [],
        }),
      ),
    );

    renderPage();
    const btn = await screen.findByRole("button", { name: /生成本库导读/ });
    await waitFor(() => expect(btn).toBeDisabled());
    expect(btn).toHaveAttribute("title", "未找到 .env 文件");
    expect(generateCalls).toEqual([]);
  });

  it("全部已生成 → 按钮禁用并显示「导读已全部生成」", async () => {
    server.use(
      http.get("*/api/guides/tree", () => HttpResponse.json(ALL_CACHED_TREE)),
    );

    renderPage();
    const btn = await screen.findByRole("button", {
      name: /导读已全部生成/,
    });
    await waitFor(() => expect(btn).toBeDisabled());
  });
});

// ---------------------------------------------------------------------------
// Stage 8：自动生成（「生成并查看导读」入口）
// ---------------------------------------------------------------------------

describe("GuidePage — 自动生成（Stage 8）", () => {
  it("autoGenerate + initialSelection → 自动触发生成一次，不循环", async () => {
    renderPage(vi.fn(), {
      autoGenerate: true,
      initialSelection: { scope: "file", path: "other.py" },
    });

    // other.py 无缓存（404）→ 自动开跑一次
    await waitFor(() => expect(generateCalls).toEqual(["file:other.py"]));

    // 生成完成后缓存失效重取仍 404 → 不得二次触发（防无限循环）
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^生成导读$/ })).toBeInTheDocument(),
    );
    expect(generateCalls).toEqual(["file:other.py"]);
  });

  it("无 autoGenerate 信号 → 不自动生成", async () => {
    renderPage(vi.fn(), {
      initialSelection: { scope: "file", path: "other.py" },
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^生成导读$/ })).toBeInTheDocument(),
    );
    expect(generateCalls).toEqual([]);
  });
});
