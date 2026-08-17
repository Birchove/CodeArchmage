/**
 * tests/unit/lib/sse.test.ts – 循环 10：SSE 解析防御性测试。
 */
import { describe, expect, it } from "vitest";
import { parseSSELine, parseSSEStream } from "@/lib/sse";

describe("parseSSELine", () => {
  it("returns undefined for non-data lines", () => {
    expect(parseSSELine(": heartbeat")).toBeUndefined();
    expect(parseSSELine("")).toBeUndefined();
    expect(parseSSELine("event: ping")).toBeUndefined();
  });

  it("returns null for [DONE]", () => {
    expect(parseSSELine("data: [DONE]")).toBeNull();
  });

  it("returns delta for valid our-format line", () => {
    const line = `data: ${JSON.stringify({ delta: "你好" })}`;
    expect(parseSSELine(line)).toEqual({ delta: "你好" });
  });

  it("returns error for error line", () => {
    const line = `data: ${JSON.stringify({ error: "LLM 未配置" })}`;
    expect(parseSSELine(line)).toEqual({ error: "LLM 未配置" });
  });

  it("returns undefined for empty delta string", () => {
    const line = `data: ${JSON.stringify({ delta: "" })}`;
    expect(parseSSELine(line)).toBeUndefined();
  });

  it("returns undefined for invalid JSON", () => {
    expect(parseSSELine("data: not-json")).toBeUndefined();
  });

  it("returns undefined for empty OpenAI choices array", () => {
    const line = `data: ${JSON.stringify({ choices: [] })}`;
    expect(parseSSELine(line)).toBeUndefined();
  });

  it("parses OpenAI raw format", () => {
    const line = `data: ${JSON.stringify({
      choices: [{ delta: { content: "hi" }, finish_reason: null }],
    })}`;
    expect(parseSSELine(line)).toEqual({ delta: "hi" });
  });

  it("skips OpenAI raw format with empty content", () => {
    const line = `data: ${JSON.stringify({
      choices: [{ delta: { content: "" }, finish_reason: null }],
    })}`;
    expect(parseSSELine(line)).toBeUndefined();
  });
});

describe("parseSSEStream", () => {
  function makeStream(text: string): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(text));
        controller.close();
      },
    });
    return new Response(stream);
  }

  it("yields deltas from stream", async () => {
    const sse = [
      `data: ${JSON.stringify({ delta: "A" })}`,
      `data: ${JSON.stringify({ delta: "B" })}`,
      "data: [DONE]",
    ].join("\n");

    const results: string[] = [];
    for await (const chunk of parseSSEStream(makeStream(sse))) {
      if (chunk.delta) results.push(chunk.delta);
    }
    expect(results).toEqual(["A", "B"]);
  });

  it("skips heartbeat lines", async () => {
    const sse = [
      ": heartbeat",
      `data: ${JSON.stringify({ delta: "OK" })}`,
      "data: [DONE]",
    ].join("\n");

    const results: string[] = [];
    for await (const chunk of parseSSEStream(makeStream(sse))) {
      if (chunk.delta) results.push(chunk.delta);
    }
    expect(results).toEqual(["OK"]);
  });

  it("yields error event", async () => {
    const sse = [
      `data: ${JSON.stringify({ error: "超时" })}`,
      "data: [DONE]",
    ].join("\n");

    const errors: string[] = [];
    for await (const chunk of parseSSEStream(makeStream(sse))) {
      if (chunk.error) errors.push(chunk.error);
    }
    expect(errors).toEqual(["超时"]);
  });

  it("handles empty body gracefully", async () => {
    const results: unknown[] = [];
    for await (const chunk of parseSSEStream(new Response(""))) {
      results.push(chunk);
    }
    expect(results).toHaveLength(0);
  });
});
