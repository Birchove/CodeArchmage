/**
 * tests/unit/lib/guideBlocks.test.ts – Stage 7b：前端导读块解析（流式用）。
 */
import { describe, it, expect } from "vitest";
import { parseStreamingBlocks } from "@/lib/guideBlocks";

describe("parseStreamingBlocks", () => {
  it("纯文本 → 单个 text 块", () => {
    expect(parseStreamingBlocks("讲解。")).toEqual([
      { type: "text", text: "讲解。" },
    ]);
  });

  it("text + 完整 code 围栏", () => {
    const md = "先讲。\n\n```code file=a.py lines=1-3\n```\n\n再讲。";
    const blocks = parseStreamingBlocks(md);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({ type: "text", text: "先讲。" });
    expect(blocks[1]).toMatchObject({
      type: "code",
      file_path: "a.py",
      start_line: 1,
      end_line: 3,
      closed: true,
    });
    expect(blocks[2]).toEqual({ type: "text", text: "再讲。" });
  });

  it("流式中途：code 围栏未闭合 → 仍产出 code 块（closed=false）", () => {
    const md = "讲。\n\n```code file=a.py lines=5-9";
    const blocks = parseStreamingBlocks(md);
    const code = blocks.find((b) => b.type === "code");
    expect(code).toMatchObject({
      type: "code",
      file_path: "a.py",
      start_line: 5,
      end_line: 9,
      closed: false,
    });
  });

  it("普通 ```python 围栏归入 text", () => {
    const md = "示意：\n```python\nx = 1\n```\n完。";
    const blocks = parseStreamingBlocks(md);
    expect(blocks.every((b) => b.type === "text")).toBe(true);
    const joined = blocks
      .filter(
        (b): b is Extract<typeof b, { type: "text" }> => b.type === "text",
      )
      .map((b) => b.text)
      .join("");
    expect(joined).toContain("x = 1");
  });

  it("属性畸形的 code 围栏 → 归入 text", () => {
    const md = "```code lines=1-2\n```";
    const blocks = parseStreamingBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("text");
  });
});
