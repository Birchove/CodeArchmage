/**
 * tests/unit/hooks/useGuide.test.ts – Stage 7b：导读数据 hooks。
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClientWrapper } from "@/test/test-utils";
import { useGuide, useGuideTree } from "@/hooks/useGuide";
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
