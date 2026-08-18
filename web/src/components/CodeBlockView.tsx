/**
 * 导读代码块（Stage 7b）。
 *
 * 渲染 ```code file=... lines=a-b``` 引用：引擎切片保证内容真实。
 * 只读 CodeMirror（复用阅读视图的高亮主题），行号显示真实文件行号；
 * 点击定位头跳回阅读模式。
 */
import { useEffect, useRef, type JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { python } from "@codemirror/lang-python";
import { getFileContent } from "@/api/endpoints";
import { syntaxExtensions } from "@/lib/highlight";

/** 单个代码块最多渲染的行数（超长截断，引导跳转看全文）。 */
const MAX_BLOCK_LINES = 80;

interface CodeBlockViewProps {
  filePath: string;
  startLine: number;
  endLine: number;
  onJump?: (filePath: string, line: number) => void;
}

export function CodeBlockView({
  filePath,
  startLine,
  endLine,
  onJump,
}: CodeBlockViewProps): JSX.Element {
  const fileQuery = useQuery({
    queryKey: ["fileContent", filePath],
    queryFn: () => getFileContent(filePath),
  });

  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  const content = fileQuery.data?.content ?? null;
  const allLines = content?.split("\n") ?? [];
  const clampedEnd = Math.min(endLine, allLines.length);
  const slice = allLines.slice(startLine - 1, clampedEnd);
  const truncated = slice.length > MAX_BLOCK_LINES;
  const shown = truncated ? slice.slice(0, MAX_BLOCK_LINES) : slice;
  const doc = shown.join("\n");

  useEffect(() => {
    if (!hostRef.current || doc === "") return;
    const state = EditorState.create({
      doc,
      extensions: [
        python(),
        ...syntaxExtensions,
        // 行号显示真实文件行号（不是块内序号）
        lineNumbers({ formatNumber: (n) => String(startLine + n - 1) }),
        EditorState.readOnly.of(true),
      ],
    });
    viewRef.current = new EditorView({ state, parent: hostRef.current });
    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [doc, startLine]);

  const locLabel = `${filePath}:${startLine}-${clampedEnd}`;

  return (
    <div className="guide-code-block">
      <button
        type="button"
        className="guide-code-loc"
        onClick={() => onJump?.(filePath, startLine)}
        title="跳回阅读模式查看完整上下文"
      >
        📍 {locLabel}
      </button>
      {fileQuery.isError ? (
        <p className="guide-code-error">文件读取失败：{filePath}</p>
      ) : content === null ? (
        <p className="guide-code-loading">加载代码…</p>
      ) : (
        <>
          <div ref={hostRef} className="guide-code-view" />
          {truncated && (
            <p className="guide-code-note">
              …还有 {slice.length - MAX_BLOCK_LINES} 行，点击定位查看全文
            </p>
          )}
        </>
      )}
    </div>
  );
}
