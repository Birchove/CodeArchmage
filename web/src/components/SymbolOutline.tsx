/**
 * 符号大纲（当前文件的符号列表）。
 *
 * 点击符号 → 滚动代码视图到对应行（由父组件处理）。
 * 可点击项用 <button type="button">（a11y O-6）。
 */

import { type JSX } from "react";
import type { SymbolOut } from "@/api/types";

interface SymbolOutlineProps {
  symbols: SymbolOut[];
  onSelect: (sym: SymbolOut) => void;
}

/** kind → 显示标签。 */
function kindLabel(kind: string): string {
  return kind;
}

export function SymbolOutline({
  symbols,
  onSelect,
}: SymbolOutlineProps): JSX.Element {
  if (symbols.length === 0) {
    return <p className="symbol-outline-empty">无符号</p>;
  }

  const sorted = [...symbols].sort((a, b) => a.line - b.line);

  return (
    <ul className="symbol-outline" role="list">
      {sorted.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            className="symbol-item"
            onClick={() => onSelect(s)}
          >
            <span className="symbol-kind">{kindLabel(s.kind)}</span>
            <span className="symbol-name">{s.name}</span>
            <span className="symbol-line">:{s.line}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
