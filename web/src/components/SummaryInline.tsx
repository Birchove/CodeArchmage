/**
 * SummaryInline（循环 15）。
 *
 * 内联摘要组件——显示「生成摘要」按钮 + 摘要内容。
 * 可放置在符号大纲、剥洋葱等任意位置。
 * 有缓存时直接显示，无缓存时显示按钮。
 */
import { type JSX } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSummary } from "@/hooks/useSummary";
import { Spinner } from "@/components/Spinner";

interface SummaryInlineProps {
  symbolId: number;
}

export function SummaryInline({ symbolId }: SummaryInlineProps): JSX.Element {
  const {
    summary,
    isLoading,
    isGenerating,
    generate,
    generateError,
  } = useSummary(symbolId);

  if (isLoading || isGenerating) {
    return (
      <div className="summary-inline">
        <Spinner />
        <span className="summary-loading-text">
          {isGenerating ? "正在生成摘要…" : "加载摘要…"}
        </span>
      </div>
    );
  }

  if (summary) {
    return (
      <div className="summary-inline summary-content">
        <div className="summary-header">
          <span className="summary-cached">
            {summary.cached ? "缓存" : "新生成"} · {summary.model}
          </span>
          <button
            type="button"
            className="summary-regenerate-btn"
            onClick={() => generate()}
            disabled={isGenerating}
          >
            重新生成
          </button>
        </div>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {summary.summary_text}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <div className="summary-inline">
      <button
        type="button"
        className="summary-generate-btn"
        onClick={() => generate()}
        disabled={isGenerating}
      >
        生成摘要
      </button>
      {generateError && (
        <span className="summary-error">{generateError}</span>
      )}
    </div>
  );
}
