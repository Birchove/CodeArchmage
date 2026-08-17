/**
 * MessageBubble（循环 12）。
 *
 * 单条对话消息渲染——用户消息纯文本，assistant 消息 Markdown 渲染。
 * react-markdown 默认转义 HTML（不渲染 raw HTML），防 XSS。
 */
import { type JSX } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "@/api/types";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps): JSX.Element {
  const isUser = message.role === "user";

  return (
    <div className={isUser ? "chat-msg chat-msg-user" : "chat-msg chat-msg-assistant"}>
      <div className="chat-msg-role">{isUser ? "你" : "AI"}</div>
      <div className="chat-msg-content">
        {isUser ? (
          <p className="chat-msg-text">{message.content}</p>
        ) : message.content ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
        ) : (
          <span className="chat-msg-typing">…</span>
        )}
      </div>
    </div>
  );
}
