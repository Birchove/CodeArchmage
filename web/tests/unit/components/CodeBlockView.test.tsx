/**
 * tests/unit/components/CodeBlockView.test.tsx – Stage 7b：导读代码块。
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
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderWithQueryClient } from "@/test/test-utils";
import { CodeBlockView } from "@/components/CodeBlockView";
import type { FileContentOut } from "@/api/types";

const server = setupServer(
  http.get("*/api/files/pkg/a.py", () =>
    HttpResponse.json<FileContentOut>({
      path: "pkg/a.py",
      content: "def f1():\n    return 1\n\ndef f2():\n    return f1()\n",
      language: "python",
      symbols: [],
      calls: [],
    }),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => server.resetHandlers());

describe("CodeBlockView", () => {
  it("渲染文件定位头 + 切片代码（含真实行号）", async () => {
    renderWithQueryClient(
      <CodeBlockView filePath="pkg/a.py" startLine={4} endLine={5} />,
    );

    await waitFor(() =>
      expect(screen.getByText(/pkg\/a.py:4-5/)).toBeInTheDocument(),
    );
    // 切片内容（第 4-5 行）；CM 按 token 拆分文本，用 textContent 断言
    await waitFor(() =>
      expect(
        document.querySelector(".guide-code-view .cm-content"),
      ).toHaveTextContent("def f2(): return f1()"),
    );
    // 真实行号可见
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("点击定位头 → onJump(file, startLine)", async () => {
    const onJump = vi.fn();
    renderWithQueryClient(
      <CodeBlockView
        filePath="pkg/a.py"
        startLine={1}
        endLine={2}
        onJump={onJump}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/pkg\/a.py:1-2/)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText(/pkg\/a.py:1-2/));
    expect(onJump).toHaveBeenCalledWith("pkg/a.py", 1);
  });
});
