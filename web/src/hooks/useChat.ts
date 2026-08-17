/**
 * useChat hook（循环 11）。
 *
 * 管理消息列表 + 流式接收 + AbortController 取消。
 * 状态提升：由 App 层持有并通过 props 传入 ChatPanel（纯展示）。
 * 本 hook 应在 App 层调用，不在 ChatPanel 内部调用。
 */

import { useCallback, useRef, useState } from "react";
import { fetchChat } from "@/api/endpoints";
import { parseSSEStream } from "@/lib/sse";
import type { ChatMessage } from "@/api/types";

export interface UseChatReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  send: (text: string, symbolId: number | null) => void;
  retry: (symbolId: number | null) => void;
  clear: () => void;
  abort: () => void;
}

export function useChat(): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const clear = useCallback(() => {
    abort();
    setMessages([]);
    setError(null);
  }, [abort]);

  /**
   * 启动流式请求（send 和 retry 共用）。
   * R-1：空闲超时——每收到 chunk 重置 15s 计时器，而非固定 15s 总时长。
   */
  const startStream = useCallback(
    (
      text: string,
      symbolId: number | null,
      history: { role: string; content: string }[],
    ) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);
      setError(null);

      let timeout: ReturnType<typeof setTimeout> | null = null;
      const resetIdleTimer = () => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
          if (abortRef.current === controller) {
            controller.abort();
          }
        }, 15_000);
      };
      resetIdleTimer();

      const run = async () => {
        try {
          const resp = await fetchChat(
            text,
            symbolId,
            history,
            controller.signal,
          );
          if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
          }
          for await (const chunk of parseSSEStream(resp)) {
            if (controller.signal.aborted) break;
            resetIdleTimer();
            if (chunk.error) {
              setError(chunk.error);
              break;
            }
            if (chunk.delta) {
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.role === "assistant") {
                  next[next.length - 1] = {
                    ...last,
                    content: last.content + chunk.delta,
                  };
                }
                return next;
              });
            }
          }
        } catch (err) {
          if (!controller.signal.aborted) {
            setError(err instanceof Error ? err.message : "未知错误");
          }
        } finally {
          if (timeout) clearTimeout(timeout);
          setIsStreaming(false);
          abortRef.current = null;
        }
      };

      void run();
    },
    [],
  );

  const send = useCallback(
    (text: string, symbolId: number | null) => {
      if (isStreaming) return;

      const history = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const userMsg: ChatMessage = { role: "user", content: text };
      const assistantMsg: ChatMessage = { role: "assistant", content: "" };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      startStream(text, symbolId, history);
    },
    [isStreaming, messages, startStream],
  );

  const retry = useCallback(
    (symbolId: number | null) => {
      if (isStreaming) return;

      // 找到最后一条用户消息
      let lastUserIdx = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          lastUserIdx = i;
          break;
        }
      }
      if (lastUserIdx < 0) return;

      const text = messages[lastUserIdx].content;
      const history = messages
        .slice(0, lastUserIdx)
        .map((m) => ({ role: m.role, content: m.content }));

      // 保留到最后一条用户消息，替换 assistant 占位
      const assistantMsg: ChatMessage = { role: "assistant", content: "" };
      setMessages((prev) => [...prev.slice(0, lastUserIdx + 1), assistantMsg]);

      startStream(text, symbolId, history);
    },
    [isStreaming, messages, startStream],
  );

  return { messages, isStreaming, error, send, retry, clear, abort };
}
