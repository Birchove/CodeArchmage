/**
 * 只读代码视图（CodeMirror 6）。
 *
 * - 只读模式（EditorState.readOnly）
 * - Python 语法高亮
 * - 大文件护栏（>2 万行 / >1MB 降级截断，O-4）
 * - ref 暴露 scrollToLine（实际滚动效果由 E2E 验证）
 * - 点击反查：coordsAtPos → {line, col} → onSymbolClick（决策 10，实际效果由 E2E 验证）
 */

import {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  type JSX,
} from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { python } from "@codemirror/lang-python";

/** 大文件护栏阈值（O-4）。 */
const MAX_LINES = 20000;
const MAX_BYTES = 1024 * 1024; // 1 MB

export interface CodeViewProps {
  content: string;
  /** 点击代码区域时触发（line 1-based, col 0-based）。 */
  onSymbolClick?: (line: number, col: number) => void;
}

export interface CodeViewHandle {
  /** 滚动到指定行（1-based）。实际效果由 E2E 验证。 */
  scrollToLine: (line: number) => void;
}

/** 判断内容是否超过护栏阈值。 */
export function isTooLarge(content: string): boolean {
  if (content.length > MAX_BYTES) return true;
  // 数换行符（比 split 高效）
  let lines = 1;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) {
      lines++;
      if (lines > MAX_LINES) return true;
    }
  }
  return lines > MAX_LINES;
}

export const CodeView = forwardRef<CodeViewHandle, CodeViewProps>(
  function CodeView({ content, onSymbolClick }, ref): JSX.Element {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    // 用 ref 存最新的 onSymbolClick，避免 useEffect 依赖它导致 CM 重建
    const clickCbRef = useRef(onSymbolClick);
    clickCbRef.current = onSymbolClick;

    useEffect(() => {
      if (!hostRef.current) return;
      const state = EditorState.create({
        doc: content,
        extensions: [
          python(),
          EditorState.readOnly.of(true),
          EditorView.lineWrapping,
        ],
      });
      viewRef.current = new EditorView({ state, parent: hostRef.current });

      // 点击反查（决策 10）：coordsAtPos → {line, col} → onSymbolClick
      const handleClick = (event: MouseEvent): void => {
        const view = viewRef.current;
        const cb = clickCbRef.current;
        if (!view || !cb) return;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return;
        const line = view.state.doc.lineAt(pos);
        cb(line.number, pos - line.from); // 1-based line, 0-based col
      };
      viewRef.current.dom.addEventListener("click", handleClick);

      return () => {
        viewRef.current?.dom.removeEventListener("click", handleClick);
        viewRef.current?.destroy();
        viewRef.current = null;
      };
      // content 变化时重建（切换文件）
    }, [content]);

    useImperativeHandle(ref, () => ({
      scrollToLine: (line: number) => {
        const view = viewRef.current;
        if (!view) return;
        // 将 1-based 行号转为文档位置
        const docLine = Math.max(0, line - 1);
        const lineInfo = view.state.doc.line(
          Math.min(docLine + 1, view.state.doc.lines),
        );
        view.dispatch({
          effects: EditorView.scrollIntoView(lineInfo.from, { y: "center" }),
        });
      },
    }));

    if (isTooLarge(content)) {
      const lines = content.split("\n").length;
      const truncated = content.split("\n").slice(0, MAX_LINES).join("\n");
      return (
        <div className="code-view-truncated">
          <p>
            文件过大（{lines.toLocaleString()} 行），已截断显示前{" "}
            {MAX_LINES.toLocaleString()} 行。
          </p>
          <pre className="code-view-truncated-pre">{truncated}</pre>
        </div>
      );
    }

    return <div ref={hostRef} className="code-view" />;
  },
);
