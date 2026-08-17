/**
 * CodeMirror 阅读高亮：语法着色、当前行、跳转行、可点击调用点。
 *
 * 颜色走 CSS 变量，跟随 :root / prefers-color-scheme。
 */

import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";
import type { CallOut } from "@/api/types";

/** Python 语法高亮（关键字 / 字符串 / 注释 / 函数名等）。 */
export const pythonHighlightStyle = HighlightStyle.define([
  { tag: t.comment, color: "var(--cm-comment)", fontStyle: "italic" },
  { tag: t.lineComment, color: "var(--cm-comment)", fontStyle: "italic" },
  { tag: t.keyword, color: "var(--cm-keyword)", fontWeight: "600" },
  { tag: t.controlKeyword, color: "var(--cm-keyword)", fontWeight: "600" },
  { tag: t.definitionKeyword, color: "var(--cm-keyword)", fontWeight: "600" },
  { tag: t.moduleKeyword, color: "var(--cm-keyword)", fontWeight: "600" },
  { tag: t.operatorKeyword, color: "var(--cm-keyword)" },
  { tag: t.self, color: "var(--cm-keyword)", fontStyle: "italic" },
  { tag: t.bool, color: "var(--cm-number)" },
  { tag: t.null, color: "var(--cm-number)" },
  { tag: t.string, color: "var(--cm-string)" },
  { tag: t.special(t.string), color: "var(--cm-string)" },
  { tag: t.number, color: "var(--cm-number)" },
  { tag: t.function(t.variableName), color: "var(--cm-function)" },
  {
    tag: t.function(t.definition(t.variableName)),
    color: "var(--cm-function)",
  },
  { tag: t.definition(t.variableName), color: "var(--cm-function)" },
  { tag: t.className, color: "var(--cm-class)" },
  { tag: t.definition(t.className), color: "var(--cm-class)" },
  { tag: t.typeName, color: "var(--cm-type)" },
  { tag: t.attributeName, color: "var(--cm-decorator)" },
  { tag: t.meta, color: "var(--cm-decorator)" },
  { tag: t.processingInstruction, color: "var(--cm-decorator)" },
  { tag: t.operator, color: "var(--cm-operator)" },
  { tag: t.punctuation, color: "var(--cm-operator)" },
  { tag: t.propertyName, color: "var(--cm-function)" },
  { tag: t.variableName, color: "var(--cm-variable)" },
  { tag: t.invalid, color: "var(--cm-invalid)" },
]);

/** 编辑器外观：与应用背景/字体对齐，去掉默认白底灰字。 */
export const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--code-bg)",
    color: "var(--text-h)",
  },
  ".cm-content": {
    caretColor: "var(--text-h)",
    fontFamily: "var(--mono)",
    fontSize: "14px",
    lineHeight: "1.55",
    padding: "8px 0",
  },
  ".cm-gutters": {
    backgroundColor: "var(--code-bg)",
    color: "var(--text)",
    borderRight: "1px solid var(--border)",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 8px 0 12px",
    minWidth: "3ch",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--cm-active-line)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--cm-active-line)",
    color: "var(--text-h)",
  },
  ".cm-jump-line": {
    backgroundColor: "var(--cm-jumped-line)",
  },
  ".cm-call-mark": {
    cursor: "pointer",
    borderRadius: "2px",
  },
  ".cm-call-mark:hover": {
    backgroundColor: "var(--accent-bg)",
  },
  "&.cm-focused": {
    outline: "none",
  },
});

export const setJumpLine = StateEffect.define<number | null>();

/** 跳转到定义/大纲后高亮目标行。 */
export const jumpLineField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setJumpLine)) {
        const lineNo = e.value;
        if (lineNo === null) return Decoration.none;
        const clamped = Math.max(1, Math.min(lineNo, tr.state.doc.lines));
        const line = tr.state.doc.line(clamped);
        return Decoration.set([
          Decoration.line({ class: "cm-jump-line" }).range(line.from),
        ]);
      }
    }
    return deco.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const callMark = Decoration.mark({ class: "cm-call-mark" });

/** 给调用点加可点击标记（hover 才显底色，避免满屏下划线）。 */
export function buildCallMarks(
  docLines: number,
  lineLength: (line: number) => { from: number; to: number },
  calls: CallOut[],
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const sorted = [...calls].sort((a, b) => a.line - b.line || a.col - b.col);
  for (const call of sorted) {
    if (call.line < 1 || call.line > docLines) continue;
    const line = lineLength(call.line);
    const from = line.from + Math.max(0, call.col);
    const to = Math.min(line.to, from + call.callee_name.length);
    if (to > from) builder.add(from, to, callMark);
  }
  return builder.finish();
}

export function callMarkExtension(
  calls: CallOut[],
): ReturnType<typeof EditorView.decorations.of> {
  return EditorView.decorations.of((view) =>
    buildCallMarks(
      view.state.doc.lines,
      (line) => view.state.doc.line(line),
      calls,
    ),
  );
}

export const syntaxExtensions = [
  syntaxHighlighting(pythonHighlightStyle, { fallback: true }),
  editorTheme,
  jumpLineField,
];
