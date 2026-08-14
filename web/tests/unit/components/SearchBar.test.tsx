import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderWithQueryClient } from "@/test/test-utils";
import { SearchBar } from "@/components/SearchBar";
import type { SearchHitOut } from "@/api/types";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => server.resetHandlers());

const mockHits: SearchHitOut[] = [
  {
    symbol_id: 1,
    name: "add",
    kind: "function",
    file_path: "calculator.py",
    line: 9,
    snippet: "def add",
  },
  {
    symbol_id: 2,
    name: "add_numbers",
    kind: "function",
    file_path: "operations.py",
    line: 5,
    snippet: "def add_numbers",
  },
];

function renderSearchBar(
  isIndexed = true,
  onSelectResult = () => {},
): ReturnType<typeof render> {
  return renderWithQueryClient(
    <SearchBar isIndexed={isIndexed} onSelectResult={onSelectResult} />,
  );
}

describe("SearchBar — 循环 2 基础渲染", () => {
  it("渲染搜索输入框", () => {
    renderSearchBar();
    expect(
      screen.getByRole("combobox", { name: /搜索符号/i }),
    ).toBeInTheDocument();
  });

  it("未索引 → 禁用 + title=请先索引", () => {
    renderSearchBar(false);
    const input = screen.getByRole("combobox", { name: /搜索符号/i });
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute("title", "请先索引");
  });

  it("已索引 → 不禁用，无 title", () => {
    renderSearchBar(true);
    const input = screen.getByRole("combobox", { name: /搜索符号/i });
    expect(input).not.toBeDisabled();
    expect(input).not.toHaveAttribute("title");
  });
});

describe("SearchBar — 循环 2 输入+结果", () => {
  it("输入关键词 → 浮层显示结果", async () => {
    server.use(http.get("*/api/search", () => HttpResponse.json(mockHits)));
    renderSearchBar();

    const input = screen.getByRole("combobox", { name: /搜索符号/i });
    fireEvent.change(input, { target: { value: "add" } });

    await waitFor(() => {
      expect(screen.getByText("add")).toBeInTheDocument();
      expect(screen.getByText("add_numbers")).toBeInTheDocument();
    });
    expect(screen.getByText(/calculator.py:9/)).toBeInTheDocument();
  });

  it("点击结果 → onSelectResult 被调用 + 浮层关闭", async () => {
    server.use(http.get("*/api/search", () => HttpResponse.json(mockHits)));
    const onSelect = vi.fn();
    renderSearchBar(true, onSelect);

    const input = screen.getByRole("combobox", { name: /搜索符号/i });
    fireEvent.change(input, { target: { value: "add" } });

    const resultBtn = await screen.findByText("add");
    fireEvent.click(resultBtn);

    expect(onSelect).toHaveBeenCalledWith(mockHits[0]);
    // 浮层关闭
    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
  });

  it("无结果 → 不显示浮层", async () => {
    server.use(http.get("*/api/search", () => HttpResponse.json([])));
    renderSearchBar();

    fireEvent.change(screen.getByRole("combobox", { name: /搜索符号/i }), {
      target: { value: "xyz" },
    });

    await waitFor(() => {
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
  });
});

describe("SearchBar — 循环 3 键盘导航", () => {
  it("↓ → 高亮下移，Enter → 选中并关闭", async () => {
    server.use(http.get("*/api/search", () => HttpResponse.json(mockHits)));
    const onSelect = vi.fn();
    renderSearchBar(true, onSelect);

    const input = screen.getByRole("combobox", { name: /搜索符号/i });
    fireEvent.change(input, { target: { value: "add" } });
    await screen.findByText("add");

    // 默认高亮第 0 项
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    // ↓ 高亮第 1 项
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options[1]).toHaveAttribute("aria-selected", "true");

    // Enter 选中第 1 项
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(mockHits[1]);
  });

  it("↑ → 高亮上移（不越界到 -1）", async () => {
    server.use(http.get("*/api/search", () => HttpResponse.json(mockHits)));
    renderSearchBar();

    const input = screen.getByRole("combobox", { name: /搜索符号/i });
    fireEvent.change(input, { target: { value: "add" } });
    await screen.findByText("add");

    const options = screen.getAllByRole("option");
    // 在第 0 项按 ↑ → 仍停在第 0 项
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(options[0]).toHaveAttribute("aria-selected", "true");
  });

  it("Esc → 关闭浮层", async () => {
    server.use(http.get("*/api/search", () => HttpResponse.json(mockHits)));
    renderSearchBar();

    const input = screen.getByRole("combobox", { name: /搜索符号/i });
    fireEvent.change(input, { target: { value: "add" } });
    await screen.findByText("add");
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
  });
});

describe("SearchBar — 循环 3 外部点击关闭", () => {
  it("点击外部 → 关闭浮层", async () => {
    server.use(http.get("*/api/search", () => HttpResponse.json(mockHits)));
    renderSearchBar();

    const input = screen.getByRole("combobox", { name: /搜索符号/i });
    fireEvent.change(input, { target: { value: "add" } });
    await screen.findByText("add");
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    // 模拟点击搜索框外部
    fireEvent.mouseDown(document.body);

    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
  });
});
