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
import { SidePanel } from "@/components/SidePanel";
import type { SymbolOut } from "@/api/types";

// Mock CallGraph 和 OnionView 以避免 react-flow / API 调用在 jsdom 中的问题
vi.mock("@/components/CallGraph", () => ({
  CallGraph: ({
    center,
    callers,
    callees,
  }: {
    center: SymbolOut;
    callers: SymbolOut[];
    callees: SymbolOut[];
  }) => (
    <div data-testid="callgraph">
      <span data-testid="center-name">{center.name}</span>
      <span data-testid="caller-count">{callers.length}</span>
      <span data-testid="callee-count">{callees.length}</span>
    </div>
  ),
}));

vi.mock("@/components/OnionView", () => ({
  OnionView: ({ symbolId }: { symbolId: number }) => (
    <div data-testid="onion-view" data-symbol-id={symbolId} />
  ),
}));

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => server.resetHandlers());

function makeSym(overrides: Partial<SymbolOut> = {}): SymbolOut {
  return {
    id: 1,
    name: "test",
    kind: "function",
    file_path: "test.py",
    line: 1,
    col: 0,
    end_line: 2,
    ...overrides,
  };
}

describe("SidePanel — 循环 10", () => {
  it("无 selectedSymbol → 空状态", () => {
    renderWithQueryClient(
      <SidePanel selectedSymbol={null} onNodeSelect={vi.fn()} />,
    );
    expect(screen.getByText(/选中符号后显示调用关系/i)).toBeInTheDocument();
  });

  it("有 selectedSymbol → 默认显示调用图标签", async () => {
    const sym = makeSym({ id: 1, name: "process" });
    server.use(
      http.get("*/api/symbols/1/callers", () => HttpResponse.json([])),
      http.get("*/api/symbols/1/callees", () => HttpResponse.json([])),
    );
    renderWithQueryClient(
      <SidePanel selectedSymbol={sym} onNodeSelect={vi.fn()} />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("callgraph")).toBeInTheDocument(),
    );
  });

  it("点击剥洋葱标签 → 切换到剥洋葱", async () => {
    const sym = makeSym({ id: 1, name: "process" });
    server.use(
      http.get("*/api/symbols/1/callers", () => HttpResponse.json([])),
      http.get("*/api/symbols/1/callees", () => HttpResponse.json([])),
    );
    renderWithQueryClient(
      <SidePanel selectedSymbol={sym} onNodeSelect={vi.fn()} />,
    );

    const onionTab = screen.getByRole("tab", { name: /剥洋葱/i });
    fireEvent.click(onionTab);

    await waitFor(() =>
      expect(screen.getByTestId("onion-view")).toBeInTheDocument(),
    );
  });

  it("标签页 aria-selected 状态正确", () => {
    renderWithQueryClient(
      <SidePanel selectedSymbol={null} onNodeSelect={vi.fn()} />,
    );
    const callgraphTab = screen.getByRole("tab", { name: /调用图/i });
    const onionTab = screen.getByRole("tab", { name: /剥洋葱/i });

    expect(callgraphTab).toHaveAttribute("aria-selected", "true");
    expect(onionTab).toHaveAttribute("aria-selected", "false");
  });
});

describe("SidePanel — cc B-2 标签页保持挂载", () => {
  it("切到剥洋葱后调用图仍挂载（visibility 控制）", async () => {
    const sym = makeSym({ id: 1, name: "process" });
    server.use(
      http.get("*/api/symbols/1/callers", () => HttpResponse.json([])),
      http.get("*/api/symbols/1/callees", () => HttpResponse.json([])),
    );
    renderWithQueryClient(
      <SidePanel selectedSymbol={sym} onNodeSelect={vi.fn()} />,
    );

    // 等调用图加载
    await waitFor(() =>
      expect(screen.getByTestId("callgraph")).toBeInTheDocument(),
    );

    // 切到剥洋葱
    fireEvent.click(screen.getByRole("tab", { name: /剥洋葱/i }));
    await waitFor(() =>
      expect(screen.getByTestId("onion-view")).toBeInTheDocument(),
    );

    // 调用图仍挂载（在 DOM 中，只是 visibility:hidden）
    expect(screen.getByTestId("callgraph")).toBeInTheDocument();
  });
});

describe("SidePanel — 折叠功能", () => {
  it("折叠按钮存在", () => {
    renderWithQueryClient(
      <SidePanel selectedSymbol={null} onNodeSelect={vi.fn()} />,
    );
    expect(
      screen.getByRole("button", { name: /折叠面板/i }),
    ).toBeInTheDocument();
  });

  it("点击折叠 → aside 加 aside-collapsed class", () => {
    renderWithQueryClient(
      <SidePanel selectedSymbol={null} onNodeSelect={vi.fn()} />,
    );
    const toggleBtn = screen.getByRole("button", { name: /折叠面板/i });
    fireEvent.click(toggleBtn);

    const aside = document.querySelector(".app-aside");
    expect(aside).toHaveClass("aside-collapsed");
    // 按钮文案变为展开
    expect(
      screen.getByRole("button", { name: /展开面板/i }),
    ).toBeInTheDocument();
  });
});
