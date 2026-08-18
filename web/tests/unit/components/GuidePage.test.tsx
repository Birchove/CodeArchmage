/**
 * tests/unit/components/GuidePage.test.tsx – Stage 7b：导读整页视图。
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
import type { FileContentOut, GuideOut, GuideTreeOut } from "@/api/types";

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
    http.post("*/api/guides/generate", () =>
      HttpResponse.json({ detail: "not-used-in-unit-tests" }),
    ),
  ];
}

const server = setupServer(...handlers());
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  server.resetHandlers();
  server.use(...handlers());
});

function renderPage(onJumpToSource = vi.fn()) {
  return renderWithQueryClient(<GuidePage onJumpToSource={onJumpToSource} />);
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
