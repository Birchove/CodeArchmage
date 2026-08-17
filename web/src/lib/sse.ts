/**
 * SSE 流解析工具（循环 10）。
 *
 * 防御性行为：
 * - 非 `data: ` 开头行跳过（心跳/注释）
 * - `data: [DONE]` 终止迭代
 * - JSON 解析失败跳过（不崩溃）
 * - 空 choices / 空 delta.content 跳过
 * - 兼容厂商差异：DeepSeek 空 choices / Ollama finish_reason 差异
 */

export interface SSEDelta {
  delta?: string;
  error?: string;
}

/**
 * 将 fetch Response 解析为异步迭代器，yield SSEDelta。
 * 在收到 [DONE] 或流关闭时终止。
 */
export async function* parseSSEStream(
  response: Response,
): AsyncGenerator<SSEDelta> {
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // 保留最后一行（可能未完整）
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const result = parseSSELine(line.trim());
        if (result === null) return; // [DONE] → 终止生成器
        if (result !== undefined) yield result;
      }
    }
    // 处理 buffer 剩余（流已关闭）
    if (buffer.trim()) {
      const result = parseSSELine(buffer.trim());
      if (result !== null && result !== undefined) yield result;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * 解析单行 SSE 数据。
 * - 返回 SSEDelta：有效数据
 * - 返回 undefined：跳过（非 JSON / 空 delta）
 * - 返回 null：[DONE]，调用方应终止
 */
export function parseSSELine(line: string): SSEDelta | undefined | null {
  if (!line.startsWith("data: ")) return undefined;

  const payload = line.slice("data: ".length).trim();
  if (payload === "[DONE]") return null;

  let data: unknown;
  try {
    data = JSON.parse(payload);
  } catch {
    return undefined; // 非 JSON，跳过
  }

  if (typeof data !== "object" || data === null) return undefined;

  // 处理我们自己的 SSE 格式（后端 llm_routes.py）
  const d = data as Record<string, unknown>;
  if (typeof d["error"] === "string") {
    return { error: d["error"] };
  }
  if (typeof d["delta"] === "string") {
    return d["delta"] ? { delta: d["delta"] } : undefined;
  }

  // 兼容 OpenAI 原始格式（透传场景）
  const choices = d["choices"];
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const delta = (choices[0] as Record<string, unknown>)["delta"];
  if (!delta || typeof delta !== "object") return undefined;
  const content = (delta as Record<string, unknown>)["content"];
  if (typeof content !== "string" || !content) return undefined;
  return { delta: content };
}
