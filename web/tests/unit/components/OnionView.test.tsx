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
import { OnionView } from "@/components/OnionView";
import type { SymbolOut } from "@/api/types";

// SummaryInline 内嵌于 OnionView，mock useSummary 避免需要 QueryClientProvider
vi.mock("@/hooks/useSummary", () => ({
  useSummary: () => ({
    summary: undefined,
    isLoading: false,
    error: null,
    generate: vi.fn(),
    isGenerating: false,
    generateError: null,
  }),
}));

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => server.resetHandlers());

function makeSym(id: number, name: string): SymbolOut {
  return {
    id,
    name,
    kind: "function",
    file_path: `${name}.py`,
    line: id * 10,
    col: 0,
    end_line: id * 10 + 5,
  };
}

describe("OnionView — 循环 13", () => {
  it("加载中 → Spinner", () => {
    server.use(
      http.get("*/api/symbols/1", () => HttpResponse.json(makeSym(1, "a"))),
      http.get("*/api/symbols/1/callers", () => HttpResponse.json([])),
    );
    render(<OnionView symbolId={1} onNodeSelect={vi.fn()} />);
    expect(document.querySelector(".spinner")).toBeInTheDocument();
  });

  it("单路径 → 渲染入口→目标", async () => {
    const target = makeSym(3, "target");
    const caller = makeSym(2, "caller");
    const entry = makeSym(1, "entry");

    server.use(
      http.get("*/api/symbols/3", () => HttpResponse.json(target)),
      http.get("*/api/symbols/3/callers", () => HttpResponse.json([caller])),
      http.get("*/api/symbols/2/callers", () => HttpResponse.json([entry])),
      http.get("*/api/symbols/1/callers", () => HttpResponse.json([])),
    );

    render(<OnionView symbolId={3} onNodeSelect={vi.fn()} />);

    await waitFor(() => screen.getByText(/路径 1/i));
    expect(screen.getByText("entry")).toBeInTheDocument();
    expect(screen.getByText("caller")).toBeInTheDocument();
    expect(screen.getByText("target")).toBeInTheDocument();
  });

  it("当前符号（路径末尾）高亮", async () => {
    const target = makeSym(2, "target");
    const entry = makeSym(1, "entry");

    server.use(
      http.get("*/api/symbols/2", () => HttpResponse.json(target)),
      http.get("*/api/symbols/2/callers", () => HttpResponse.json([entry])),
      http.get("*/api/symbols/1/callers", () => HttpResponse.json([])),
    );

    render(<OnionView symbolId={2} onNodeSelect={vi.fn()} />);

    await waitFor(() => screen.getByText("target"));
    const targetBtn = screen.getByText("target").closest("li");
    expect(targetBtn).toHaveClass("onion-current");
  });

  it("诚实文案存在", async () => {
    server.use(
      http.get("*/api/symbols/1", () => HttpResponse.json(makeSym(1, "a"))),
      http.get("*/api/symbols/1/callers", () => HttpResponse.json([])),
    );

    render(<OnionView symbolId={1} onNodeSelect={vi.fn()} />);

    await waitFor(() => screen.getByText(/路径 1/i));
    expect(screen.getByText(/按名匹配.*同名符号可能交叉/i)).toBeInTheDocument();
  });

  it("点击节点 → onNodeSelect", async () => {
    const target = makeSym(2, "target");
    const entry = makeSym(1, "entry");
    const onSelect = vi.fn();

    server.use(
      http.get("*/api/symbols/2", () => HttpResponse.json(target)),
      http.get("*/api/symbols/2/callers", () => HttpResponse.json([entry])),
      http.get("*/api/symbols/1/callers", () => HttpResponse.json([])),
    );

    render(<OnionView symbolId={2} onNodeSelect={onSelect} />);

    await waitFor(() => screen.getByText("entry"));
    fireEvent.click(screen.getByText("entry"));
    expect(onSelect).toHaveBeenCalledWith(entry);
  });
});
