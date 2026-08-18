/**
 * useChat hook（循环 11；Stage 7a A-2 重写为按符号保留对话）。
 *
 * 每个符号一份会话（Map<symbolId, ChatMessage[]>），切换符号不丢历史：
 * - 当前符号 id 变化 → 视图切到对应会话，后台流式继续写回原会话
 * - clear 只清当前符号；retry 只作用于当前符号的最后一条用户消息
 * - symbolId=null 用全局会话 key（无上下文提问）
 *
 * 状态提升：由 App 层持有并通过 props 传入 ChatPanel（纯展示）。
 * 本 hook 应在 App 层调用，不在 ChatPanel 内部调用。
 */

import { useCallback, useRef, useState } from "react";
import { fetchChat } from "@/api/endpoints";
import { parseSSEStream } from "@/lib/sse";
import type { ChatMessage } from "@/api/types";

/** 会话 key：符号 id；无上下文提问用全局哨兵（不与真实 id 冲突）。 */
const GLOBAL_KEY = "global";
type SessionKey = number | typeof GLOBAL_KEY;

function sessionKey(symbolId: number | null): SessionKey {
  return symbolId ?? GLOBAL_KEY;
}

export interface UseChatReturn {
  /** 当前符号的会话消息。 */
  messages: ChatMessage[];
  /** 当前符号是否正在流式接收。 */
  isStreaming: boolean;
  /** 当前符号会话的最近错误。 */
  error: string | null;
  /** 发送消息（写入当前符号会话）。 */
  send: (text: string) => void;
  /** 重试当前符号会话的最后一条用户消息。 */
  retry: () => void;
  /** 清空当前符号会话（其他符号不受影响）。 */
  clear: () => void;
  /** 中止当前符号的流式请求。 */
  abort: () => void;
}

export function useChat(symbolId: number | null): UseChatReturn {
  const key = sessionKey(symbolId);

  const [sessions, setSessions] = useState<Map<SessionKey, ChatMessage[]>>(
    () => new Map(),
  );
  // 每个会话独立的流式状态与错误
  const [streaming, setStreaming] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  // 会话历史镜像：回调里读最新值，避免闭包陈旧
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const abortMap = useRef(new Map<SessionKey, AbortController>());

  /** 追加/更新某会话末尾的 assistant 消息（流式增量用）。 */
  const patchLastAssistant = useCallback(
    (target: SessionKey, delta: string) => {
      setSessions((prev) => {
        const msgs = prev.get(target);
        if (!msgs || msgs.length === 0) return prev;
        const last = msgs[msgs.length - 1];
        if (last.role !== "assistant") return prev;
        const next = new Map(prev);
        next.set(target, [
          ...msgs.slice(0, -1),
          { ...last, content: last.content + delta },
        ]);
        return next;
      });
    },
    [],
  );

  /**
   * 启动流式请求（send 和 retry 共用）。
   * R-1：空闲超时——每收到 chunk 重置 15s 计时器，而非固定 15s 总时长。
   * A-2：所有写入都定向到 target 会话，用户中途切换符号不打断。
   */
  const startStream = useCallback(
    (
      target: SessionKey,
      targetSymbolId: number | null,
      text: string,
      history: { role: string; content: string }[],
    ) => {
      const controller = new AbortController();
      abortMap.current.set(target, controller);
      setStreaming((prev) => ({ ...prev, [String(target)]: true }));
      setErrors((prev) => ({ ...prev, [String(target)]: null }));

      let timeout: ReturnType<typeof setTimeout> | null = null;
      const resetIdleTimer = () => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
          if (abortMap.current.get(target) === controller) {
            controller.abort();
          }
        }, 15_000);
      };
      resetIdleTimer();

      const run = async () => {
        try {
          const resp = await fetchChat(
            text,
            targetSymbolId,
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
              const errMsg = chunk.error;
              setErrors((prev) => ({ ...prev, [String(target)]: errMsg }));
              break;
            }
            if (chunk.delta) {
              patchLastAssistant(target, chunk.delta);
            }
          }
        } catch (err) {
          if (!controller.signal.aborted) {
            setErrors((prev) => ({
              ...prev,
              [String(target)]: err instanceof Error ? err.message : "未知错误",
            }));
          }
        } finally {
          if (timeout) clearTimeout(timeout);
          setStreaming((prev) => ({ ...prev, [String(target)]: false }));
          if (abortMap.current.get(target) === controller) {
            abortMap.current.delete(target);
          }
        }
      };

      void run();
    },
    [patchLastAssistant],
  );

  const send = useCallback(
    (text: string) => {
      const target = key;
      if (streaming[String(target)]) return;

      const msgs = sessionsRef.current.get(target) ?? [];
      const history = msgs.map((m) => ({ role: m.role, content: m.content }));
      const userMsg: ChatMessage = { role: "user", content: text };
      const assistantMsg: ChatMessage = { role: "assistant", content: "" };

      setSessions((prev) => {
        const next = new Map(prev);
        next.set(target, [...(prev.get(target) ?? []), userMsg, assistantMsg]);
        return next;
      });

      startStream(target, symbolId, text, history);
    },
    [key, symbolId, streaming, startStream],
  );

  const retry = useCallback(() => {
    const target = key;
    if (streaming[String(target)]) return;

    const msgs = sessionsRef.current.get(target) ?? [];
    // 找到最后一条用户消息
    let lastUserIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx < 0) return;

    const text = msgs[lastUserIdx].content;
    const history = msgs
      .slice(0, lastUserIdx)
      .map((m) => ({ role: m.role, content: m.content }));

    // 保留到最后一条用户消息，替换 assistant 占位
    const assistantMsg: ChatMessage = { role: "assistant", content: "" };
    setSessions((prev) => {
      const next = new Map(prev);
      next.set(target, [...msgs.slice(0, lastUserIdx + 1), assistantMsg]);
      return next;
    });

    startStream(target, symbolId, text, history);
  }, [key, symbolId, streaming, startStream]);

  const abort = useCallback(() => {
    abortMap.current.get(key)?.abort();
    abortMap.current.delete(key);
    setStreaming((prev) => ({ ...prev, [String(key)]: false }));
  }, [key]);

  const clear = useCallback(() => {
    abort();
    setSessions((prev) => {
      const next = new Map(prev);
      next.set(key, []);
      return next;
    });
    setErrors((prev) => ({ ...prev, [String(key)]: null }));
  }, [key, abort]);

  return {
    messages: sessions.get(key) ?? [],
    isStreaming: streaming[String(key)] ?? false,
    error: errors[String(key)] ?? null,
    send,
    retry,
    clear,
    abort,
  };
}
