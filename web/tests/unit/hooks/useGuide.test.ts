/**
 * tests/unit/hooks/useGuide.test.ts – Stage 7b：导读数据 hooks；
 * Stage 8：useAutoGenerate（生成并查看，防无限循环）。
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClientWrapper } from "@/test/test-utils";
import { useAutoGenerate, useGuide, useGuideTree } from "@/hooks/useGuide";
import type { GuideOut, GuideTreeOut } from "@/api/types";

vi.mock("@/api/endpoints", () => ({
  getGuideTree: vi.fn(),
  getGuide: vi.fn(),
  fetchGuideGenerate: vi.fn(),
}));

vi.mock("@/lib/sse", () => ({
  parseSSEStream: vi.fn(),
}));

import { fetchGuideGenerate, getGuide, getGuideTree } from "@/api/endpoints";
import { parseSSEStream } from "@/lib/sse";

const mockedGetGuideTree = vi.mocked(getGuideTree);
const mockedGetGuide = vi.mocked(getGuide);
const mockedFetch = vi.mocked(fetchGuideGenerate);
const mockedParseSSE = vi.mocked(parseSSEStream);

const TREE: GuideTreeOut = {
  project: { scope: "project", path: "", status: "none" },
  modules: [{ scope: "module", path: "pkg", status: "cached" }],
  files: [{ scope: "file", path: "main.py", status: "stale" }],
};

const CACHED: GuideOut = {
  scope: "file",
  path: "main.py",
  content_md: "讲解。",
  blocks: [{ type: "text", text: "讲解。" }],
  stale: false,
  model: "m1",
};

async function* contentDeltas(...parts: string[]) {
  for (const p of parts) {
    yield { delta: p };
  }
}

describe("useGuideTree", () => {
  beforeEach(() => vi.clearAllMocks());

  it("加载导读目录", async () => {
    mockedGetGuideTree.mockResolvedValue(TREE);
    const { result } = renderHook(() => useGuideTree(), {
      wrapper: createQueryClientWrapper(),
    });
    await waitFor(() => expect(result.current.data).toEqual(TREE));
  });
});

describe("useGuide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetch.mockResolvedValue(new Response("", { status: 200 }));
  });

  it("有缓存 → guide 命中", async () => {
    mockedGetGuide.mockResolvedValue(CACHED);
    const { result } = renderHook(() => useGuide("file", "main.py"), {
      wrapper: createQueryClientWrapper(),
    });
    await waitFor(() => expect(result.current.guide).toEqual(CACHED));
    expect(result.current.isGenerating).toBe(false);
  });

  it("generate：流式拼接 markdown，结束后 guide 可读", async () => {
    mockedGetGuide.mockResolvedValue(CACHED);
    mockedParseSSE.mockReturnValue(contentDeltas("第一段", "第二段"));

    const { result } = renderHook(() => useGuide("file", "main.py"), {
      wrapper: createQueryClientWrapper(),
    });

    act(() => {
      void result.current.generate();
    });

    await waitFor(() => expect(result.current.isGenerating).toBe(false));
    expect(result.current.streamMd).toBe("第一段第二段");
    expect(result.current.generateError).toBeNull();
  });

  it("generate：网关错误 → generateError", async () => {
    mockedGetGuide.mockResolvedValue(CACHED);
    async function* errGen() {
      yield { error: "LLM 挂了" };
    }
    mockedParseSSE.mockReturnValue(errGen());

    const { result } = renderHook(() => useGuide("file", "main.py"), {
      wrapper: createQueryClientWrapper(),
    });

    act(() => {
      void result.current.generate();
    });

    await waitFor(() => expect(result.current.generateError).toBe("LLM 挂了"));
  });
});

// ---------------------------------------------------------------------------
// Stage 8：useAutoGenerate（「生成并查看导读」一次性自动触发）
// ---------------------------------------------------------------------------

const STALE: GuideOut = { ...CACHED, stale: true };

describe("useAutoGenerate（Stage 8）", () => {
  it("enabled + 无导读 → 触发一次 generate，guide 更新后不再触发（防循环）", () => {
    const generate = vi.fn();
    const onStart = vi.fn();
    const { rerender } = renderHook(
      (props: Parameters<typeof useAutoGenerate>[0]) => useAutoGenerate(props),
      {
        initialProps: {
          enabled: true,
          isLoading: false,
          guide: null,
          generate,
          onStart,
        },
      },
    );

    expect(generate).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledTimes(1);

    // 生成完成 → 缓存失效重取 → guide 变化，effect 重跑但不再触发
    rerender({ enabled: true, isLoading: false, guide: CACHED, generate, onStart });
    expect(generate).toHaveBeenCalledTimes(1);
    rerender({ enabled: true, isLoading: false, guide: CACHED, generate, onStart });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("enabled + stale 导读 → 触发生成", () => {
    const generate = vi.fn();
    renderHook(
      (props: Parameters<typeof useAutoGenerate>[0]) => useAutoGenerate(props),
      {
        initialProps: {
          enabled: true,
          isLoading: false,
          guide: STALE,
          generate,
        },
      },
    );
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("enabled + 新鲜缓存 → 不触发", () => {
    const generate = vi.fn();
    renderHook(
      (props: Parameters<typeof useAutoGenerate>[0]) => useAutoGenerate(props),
      {
        initialProps: {
          enabled: true,
          isLoading: false,
          guide: CACHED,
          generate,
        },
      },
    );
    expect(generate).not.toHaveBeenCalled();
  });

  it("缓存查询加载中 → 等加载完再决策", () => {
    const generate = vi.fn();
    const { rerender } = renderHook(
      (props: Parameters<typeof useAutoGenerate>[0]) => useAutoGenerate(props),
      {
        initialProps: {
          enabled: true,
          isLoading: true,
          guide: null,
          generate,
        },
      },
    );
    expect(generate).not.toHaveBeenCalled();

    rerender({ enabled: true, isLoading: false, guide: null, generate });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("enabled=false → 不触发", () => {
    const generate = vi.fn();
    renderHook(
      (props: Parameters<typeof useAutoGenerate>[0]) => useAutoGenerate(props),
      {
        initialProps: {
          enabled: false,
          isLoading: false,
          guide: null,
          generate,
        },
      },
    );
    expect(generate).not.toHaveBeenCalled();
  });

  it("生成失败后不自动重试（只触发一次）", () => {
    const generate = vi.fn();
    const { rerender } = renderHook(
      (props: Parameters<typeof useAutoGenerate>[0]) => useAutoGenerate(props),
      {
        initialProps: {
          enabled: true,
          isLoading: false,
          guide: null,
          generate,
        },
      },
    );
    expect(generate).toHaveBeenCalledTimes(1);
    // 失败后状态刷新（guide 仍为 null）→ 不得再次触发
    rerender({ enabled: true, isLoading: false, guide: null, generate });
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
