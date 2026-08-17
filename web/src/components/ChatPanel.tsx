/**
 * ChatPanel（循环 13）。
 *
 * 纯展示组件——消息列表 + 输入框 + 上下文提示 + 清空 + 发送。
 * 状态由 props 传入（useChat hook 在 App 层调用）。
 * Enter 发送，Shift+Enter 换行。
 * 草稿保活：输入框值由 props.draft + onDraftChange 控制（切换标签不丢失）。
 */
import { type JSX, useEffect, useRef } from "react";
import { MessageBubble } from "@/components/MessageBubble";
import type { ChatMessage } from "@/api/types";

interface ChatPanelProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  draft: string;
  symbolName: string | null;
  llmConfigured: boolean;
  configMessage?: string | null;
  configLoading?: boolean;
  onDraftChange: (text: string) => void;
  onSend: () => void;
  onRetry: () => void;
  onClear: () => void;
  onAbort: () => void;
}

export function ChatPanel({
  messages,
  isStreaming,
  error,
  draft,
  symbolName,
  llmConfigured,
  configMessage = null,
  configLoading = false,
  onDraftChange,
  onSend,
  onRetry,
  onClear,
  onAbort,
}: ChatPanelProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);

  // 新消息时自动滚到底
  useEffect(() => {
    const el = scrollRef.current;
    if (el && typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight });
    }
  }, [messages]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="chat-panel">
      {symbolName ? (
        <div className="chat-context-hint">
          📎 已附加：<code>{symbolName}</code>
        </div>
      ) : (
        <div className="chat-context-hint">无上下文</div>
      )}
      {!configLoading && !llmConfigured && (
        <div className="chat-config-warning">
          {configMessage ??
            "未找到 .env。请把 .env.example 复制到本工具仓库根目录（与 engine/、web/ 同级），填写 LLM_API_KEY、LLM_BASE_URL、LLM_MODEL 后重启引擎。"}
        </div>
      )}
      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 ? (
          <p className="chat-empty">选中符号后开始对话</p>
        ) : (
          messages.map((msg, i) => <MessageBubble key={i} message={msg} />)
        )}
      </div>
      {error && (
        <div className="chat-error">
          <span className="chat-error-text">{error}</span>
          <button
            type="button"
            className="chat-btn chat-btn-retry"
            onClick={onRetry}
            disabled={isStreaming || !llmConfigured}
          >
            重试
          </button>
        </div>
      )}
      <div className="chat-input-row">
        <textarea
          className="chat-input"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="问点什么…（Enter 发送，Shift+Enter 换行）"
          rows={2}
          disabled={!llmConfigured}
        />
        <div className="chat-actions">
          {isStreaming ? (
            <button
              type="button"
              className="chat-btn chat-btn-abort"
              onClick={onAbort}
            >
              停止
            </button>
          ) : (
            <button
              type="button"
              className="chat-btn chat-btn-send"
              onClick={onSend}
              disabled={!draft.trim() || !llmConfigured}
            >
              发送
            </button>
          )}
          <button
            type="button"
            className="chat-btn chat-btn-clear"
            onClick={onClear}
            disabled={messages.length === 0}
          >
            清空
          </button>
        </div>
      </div>
    </div>
  );
}
